'use strict';

// ffmpeg-static 경로 등록 — prism-media 가 ffmpeg 를 찾을 수 있도록
process.env.FFMPEG_PATH = require('ffmpeg-static');

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} = require('@discordjs/voice');
const { PermissionsBitField } = require('discord.js');
const googleTTS = require('google-tts-api');

/**
 * 음성 채널에 입장하여 TTS 재생 후 퇴장 (내부 구현).
 * 길드당 단일 음성 연결을 공유하므로, 동시 호출 시 서로의 connection 을
 * destroy 하지 않도록 외부 래퍼(playTTSInChannel)가 길드 단위로 직렬화한다.
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {string} text - 읽어줄 텍스트
 */
async function _playTTSInChannel(voiceChannel, text) {
  const { id: channelId, guild } = voiceChannel;
  console.log(`[TTS] 재생 요청: 채널="${voiceChannel.name}", 텍스트="${text}"`);

  // 권한 점검
  try {
    const me = await guild.members.fetchMe();
    const perms = voiceChannel.permissionsFor(me);
    const need = [
      [PermissionsBitField.Flags.ViewChannel, 'ViewChannel'],
      [PermissionsBitField.Flags.Connect,     'Connect'],
      [PermissionsBitField.Flags.Speak,       'Speak'],
    ];
    const missing = need.filter(([f]) => !perms?.has(f)).map(([, n]) => n);
    if (missing.length) console.warn(`[TTS] ⚠️ 누락된 권한: ${missing.join(', ')}`);
  } catch (e) {
    console.warn(`[TTS] ⚠️ 권한 확인 실패: ${e.message}`);
  }

  // 기존 연결 재사용 or 새로 입장
  let connection = getVoiceConnection(guild.id);
  if (!connection || connection.joinConfig.channelId !== channelId) {
    if (connection) {
      connection.destroy();
      await new Promise(r => setTimeout(r, 300));
    }
    connection = joinVoiceChannel({
      channelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });
  }

  connection.on('error', (e) => console.error('[TTS] 연결 오류:', e.message));

  // Ready 진입 대기 — 빠지면 UDP 핸드셰이크 완료 전에 패킷 송신되어 무음이 됨
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (e) {
    console.error(`[TTS] ❌ Ready 진입 실패 (현재 상태=${connection.state.status}):`, e.message);
    connection.destroy();
    throw e;
  }

  // 봇이 server-mute / suppress 상태면 무음 원인이 됨
  const meVoice = guild.members.me?.voice;
  if (meVoice?.serverMute) console.warn('[TTS] ⚠️ 봇이 서버에서 mute 됨 → 소리 안 나갑니다');
  if (meVoice?.suppress)   console.warn('[TTS] ⚠️ 봇 suppress 상태 → 발언 권한 필요');

  // TTS MP3 다운로드 → 임시 파일
  let tmpFile = null;
  try {
    const base64Audio = await googleTTS.getAudioBase64(text, { lang: 'ko', slow: false });
    const buffer      = Buffer.from(base64Audio, 'base64');
    if (buffer.length < 500) {
      console.warn(`[TTS] ⚠️ 오디오 버퍼 작음: ${buffer.length} bytes — TTS 다운로드 실패 가능`);
    }
    tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
    fs.writeFileSync(tmpFile, buffer);

    const resource = createAudioResource(tmpFile);
    const player   = createAudioPlayer();

    player.on('error', (e) => console.error('[TTS] 플레이어 오류:', e.message));
    if (resource.playStream?.on) {
      resource.playStream.on('error', (e) => console.error('[TTS] 스트림 오류:', e.message));
    }

    connection.subscribe(player);
    player.play(resource);

    await Promise.race([
      entersState(player, AudioPlayerStatus.Idle,       60_000),
      entersState(player, AudioPlayerStatus.AutoPaused, 60_000),
    ]);
    console.log(`[TTS] 재생 완료 (${player.state.status})`);
  } finally {
    if (tmpFile) fs.unlink(tmpFile, () => {});
    connection.destroy();
  }
}

// ──────────────────────────────────────────────────────────
// 길드 단위 직렬화 큐
// 같은 길드의 TTS 재생을 순차 실행해, 진행 중인 재생을 다른 호출이
// connection.destroy() 로 끊어 무음/오류가 나는 충돌을 방지한다.
// ──────────────────────────────────────────────────────────
const guildTtsQueues = new Map(); // guildId -> 마지막 작업의 Promise

/**
 * 음성 채널에 입장하여 TTS 재생 후 퇴장.
 * 동일 길드 요청은 큐에 직렬화되어 이전 재생이 끝난 뒤 시작된다.
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {string} text - 읽어줄 텍스트
 * @returns {Promise<void>}
 */
function playTTSInChannel(voiceChannel, text) {
  const guildId = voiceChannel.guild.id;
  const prev = guildTtsQueues.get(guildId) ?? Promise.resolve();

  // 이전 작업의 성공/실패와 무관하게 다음 작업을 이어서 실행
  const next = prev
    .catch(() => {})
    .then(() => _playTTSInChannel(voiceChannel, text));

  // 큐 꼬리 갱신. 이 작업이 (현재 꼬리이면서) 끝나면 맵에서 정리해
  // Map 이 무한히 커지지 않게 한다.
  guildTtsQueues.set(guildId, next);
  next.catch(() => {}).finally(() => {
    if (guildTtsQueues.get(guildId) === next) guildTtsQueues.delete(guildId);
  });

  return next;
}

module.exports = { playTTSInChannel };
