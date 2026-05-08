'use strict';

const https = require('https');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  StreamType,
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

  const url = googleTTS.getAudioUrl(text, { lang: 'ko', slow: false });
  const stream = await fetchAudioStream(url);
  const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

  const player = createAudioPlayer();
  connection.subscribe(player);
  player.play(resource);

  await entersState(player, AudioPlayerStatus.Idle, 60_000);
  connection.destroy();
}

/**
 * TTS URL에서 오디오 스트림 취득
 * @param {string} url
 * @returns {Promise<import('http').IncomingMessage>}
 */
function fetchAudioStream(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`TTS 스트림 취득 실패: HTTP ${res.statusCode}`));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

module.exports = { playTTSInChannel };
