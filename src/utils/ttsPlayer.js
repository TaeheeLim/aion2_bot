'use strict';

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
const googleTTS = require('google-tts-api');

/**
 * 음성 채널에 입장하여 TTS 재생 후 퇴장
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {string} text - 읽어줄 텍스트
 */
async function playTTSInChannel(voiceChannel, text) {
  const { id: channelId, guild } = voiceChannel;

  // 기존 연결 재사용 or 새로 입장
  let connection = getVoiceConnection(guild.id);
  if (!connection || connection.joinConfig.channelId !== channelId) {
    if (connection) connection.destroy();
    connection = joinVoiceChannel({
      channelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });
  }

  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  console.log('[TTS] 음성 채널 연결 완료');

  // MP3를 임시 파일로 저장
  const base64Audio = await googleTTS.getAudioBase64(text, { lang: 'ko', slow: false });
  const buffer      = Buffer.from(base64Audio, 'base64');
  const tmpFile     = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
  fs.writeFileSync(tmpFile, buffer);
  console.log('[TTS] 오디오 파일 준비 완료:', buffer.length, 'bytes');

  try {
    const resource = createAudioResource(tmpFile);
    const player   = createAudioPlayer();

    player.on('error', (err) => {
      console.error('[TTS] 플레이어 오류:', err.message);
    });

    player.on('stateChange', (oldState, newState) => {
      console.log(`[TTS] 상태 변화: ${oldState.status} → ${newState.status}`);
    });

    connection.subscribe(player);
    player.play(resource);

    // Idle 또는 AutoPaused(구독자 없을 때) 중 먼저 오는 것으로 완료 처리
    await Promise.race([
      entersState(player, AudioPlayerStatus.Idle,       60_000),
      entersState(player, AudioPlayerStatus.AutoPaused, 60_000),
    ]);

    console.log('[TTS] 재생 완료');
  } finally {
    fs.unlink(tmpFile, () => {});
    connection.destroy();
  }
}

module.exports = { playTTSInChannel };
