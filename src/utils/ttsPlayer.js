'use strict';

// ffmpeg-static 경로 등록 — prism-media 가 ffmpeg 를 찾을 수 있도록
process.env.FFMPEG_PATH = require('ffmpeg-static');

const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const dgram = require('dgram');
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
 * 음성 채널에 입장하여 TTS 재생 후 퇴장
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {string} text - 읽어줄 텍스트
 */
async function playTTSInChannel(voiceChannel, text) {
  const { id: channelId, guild } = voiceChannel;
  const startedAt = Date.now();
  const t = () => `+${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  const log  = (msg) => console.log(`[TTS ${t()}] ${msg}`);
  const warn = (msg) => console.warn(`[TTS ${t()}] ⚠️ ${msg}`);
  const err  = (msg, e) => console.error(`[TTS ${t()}] ❌ ${msg}`, e ?? '');

  log(`재생 요청: 길드="${guild.name}", 채널="${voiceChannel.name}" (${channelId}), 텍스트="${text}"`);

  // ── 권한 사전 점검 (실패해도 진행은 하되 경고) ──────────
  try {
    const me = await guild.members.fetchMe();
    const perms = voiceChannel.permissionsFor(me);
    const need = [
      { flag: PermissionsBitField.Flags.ViewChannel, name: 'ViewChannel' },
      { flag: PermissionsBitField.Flags.Connect,     name: 'Connect' },
      { flag: PermissionsBitField.Flags.Speak,       name: 'Speak' },
    ];
    const missing = need.filter(p => !perms?.has(p.flag)).map(p => p.name);
    if (missing.length) warn(`누락된 권한: ${missing.join(', ')}`);
    else log(`권한 OK: View/Connect/Speak`);
  } catch (e) {
    warn(`권한 확인 실패: ${e.message}`);
  }

  // ── 기존 연결 재사용 or 새로 입장 ────────────────────────
  let connection = getVoiceConnection(guild.id);
  if (!connection || connection.joinConfig.channelId !== channelId) {
    if (connection) {
      log(`기존 연결 destroy (다른 채널 또는 잔여 연결)`);
      connection.destroy();
      await new Promise(r => setTimeout(r, 300));
    }
    log(`joinVoiceChannel 호출`);
    connection = joinVoiceChannel({
      channelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      debug: true,
    });
  } else {
    log(`기존 연결 재사용`);
  }

  // networking 서브상태 코드 (0=OpeningWs 1=Identifying 2=UdpHandshaking 3=SelectingProtocol 4=Ready 5=Resuming 6=Closed)
  const NET_CODE = { 0: 'OpeningWs', 1: 'Identifying', 2: 'UdpHandshaking', 3: 'SelectingProtocol', 4: 'Ready', 5: 'Resuming', 6: 'Closed' };
  const attachNetLogger = (networking) => {
    if (!networking || networking.__loggerAttached) return;
    networking.__loggerAttached = true;
    log(`networking 시작 (code=${networking.state?.code} ${NET_CODE[networking.state?.code] ?? '?'})`);
    networking.on('stateChange', (oldN, newN) => {
      log(`networking: ${NET_CODE[oldN.code] ?? oldN.code} → ${NET_CODE[newN.code] ?? newN.code}`);
    });
    networking.on('error', (e) => err(`networking 오류:`, e));
    networking.on('close', (code) => warn(`networking close (code=${code})`));
  };

  connection.on('stateChange', (oldS, newS) => {
    log(`연결 상태: ${oldS.status} → ${newS.status}`);
    attachNetLogger(newS.networking);
  });
  connection.on('error', (e) => err(`연결 오류:`, e));
  let parallelTestStarted = false;
  connection.on('debug', (m) => {
    console.log(`[TTS ${t()}] debug: ${m}`);
    // SELECT_PROTOCOL 응답(op=2)에 ip/port/ssrc 가 들어있음 — 라이브 endpoint 잡아서 raw UDP 병렬 테스트
    if (parallelTestStarted) return;
    const wsRecv = /\[WS\] << (\{.+\})\s*$/.exec(m);
    if (!wsRecv) return;
    try {
      const obj = JSON.parse(wsRecv[1]);
      if (obj.op === 2 && obj.d?.ip && obj.d?.port && obj.d?.ssrc) {
        parallelTestStarted = true;
        const { ip, port, ssrc } = obj.d;
        log(`>>> 라이브 endpoint 감지 ${ip}:${port} (ssrc=${ssrc}) — raw dgram 으로 병렬 IP 발견 시도`);
        rawIpDiscovery(ip, port, ssrc).then(r => {
          if (r.ok) log(`>>> ✅ raw UDP 응답: ${r.publicAddr} (${r.bytes} bytes, ${r.ms}ms) → @discordjs/voice 측 이슈`);
          else      err(`>>> ❌ raw UDP 무응답: ${r.detail} → endpoint 자체 unreachable`);
        });
      }
    } catch { /* not JSON, ignore */ }
  });
  attachNetLogger(connection.state?.networking);

  // ⭐ Ready 진입 대기 — 이게 빠지면 UDP 핸드셰이크 완료 전에 패킷이 송신되어 무음이 됨
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (e) {
    err(`Ready 진입 실패 (30초 timeout, 현재 상태=${connection.state.status})`, e);
    connection.destroy();
    throw e;
  }
  log(`연결 Ready`);

  // 봇의 음성 상태 (server-mute/deaf 여부)
  try {
    const meVoice = guild.members.me?.voice;
    if (meVoice) {
      log(`봇 voice: serverMute=${meVoice.serverMute}, serverDeaf=${meVoice.serverDeaf}, selfMute=${meVoice.selfMute}, suppress=${meVoice.suppress}`);
      if (meVoice.serverMute) warn(`봇이 서버에서 mute 됨 → 소리가 안 나갑니다. 서버 설정에서 mute 해제 필요.`);
      if (meVoice.suppress)   warn(`봇이 suppress 상태(스테이지 채널?) → 발언 권한 필요.`);
    } else {
      warn(`봇 voice 상태를 가져오지 못함 (캐시 미스 가능)`);
    }
  } catch (e) {
    warn(`봇 voice 상태 확인 실패: ${e.message}`);
  }

  // 사용 중인 암호화 모드 (디버깅용)
  try {
    const encMode = connection.state?.networking?.state?.connectionData?.encryptionMode;
    if (encMode) log(`암호화 모드: ${encMode}`);
  } catch { /* ignore */ }

  // ── TTS MP3 다운로드 → 임시 파일 ─────────────────────────
  let tmpFile = null;
  try {
    const base64Audio = await googleTTS.getAudioBase64(text, { lang: 'ko', slow: false });
    const buffer      = Buffer.from(base64Audio, 'base64');
    if (buffer.length < 500) {
      warn(`오디오 버퍼가 의심스럽게 작음: ${buffer.length} bytes (TTS 다운로드 실패 가능)`);
    } else {
      log(`오디오 다운로드: ${buffer.length} bytes`);
    }
    tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
    fs.writeFileSync(tmpFile, buffer);

    const resource = createAudioResource(tmpFile);
    const player   = createAudioPlayer();

    player.on('error', (e) => {
      err(`플레이어 오류:`, e);
    });

    player.on('stateChange', (oldS, newS) => {
      log(`플레이어 상태: ${oldS.status} → ${newS.status}`);
    });

    // 리소스 내부 스트림 에러도 노출 (ffmpeg/prism 실패)
    if (resource.playStream && typeof resource.playStream.on === 'function') {
      resource.playStream.on('error', (e) => err(`스트림 오류:`, e));
    }

    connection.subscribe(player);
    player.play(resource);
    log(`player.play() 호출됨`);

    await Promise.race([
      entersState(player, AudioPlayerStatus.Idle,       60_000),
      entersState(player, AudioPlayerStatus.AutoPaused, 60_000),
    ]);

    log(`재생 종료 (player status=${player.state.status})`);
  } finally {
    if (tmpFile) fs.unlink(tmpFile, () => {});
    connection.destroy();
    log(`연결 destroy 완료`);
  }
}

/**
 * Discord 가 알려준 ip/port/ssrc 에 대해 vanilla dgram 으로 IP 발견 패킷을 보내본다.
 * @discordjs/voice 의 UDP 구현을 우회한 raw 테스트.
 */
function rawIpDiscovery(ip, port, ssrc, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const startedAt = Date.now();
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      try { sock.close(); } catch { /* already closed */ }
      resolve(result);
    };

    sock.on('message', (msg) => {
      let publicAddr = '?';
      try {
        const addr = msg.subarray(8, 72).toString('utf8').replace(/\0/g, '');
        const pubPort = msg.readUInt16BE(72);
        publicAddr = `${addr}:${pubPort}`;
      } catch { /* parse fail */ }
      finish({ ok: true, bytes: msg.length, publicAddr, ms: Date.now() - startedAt });
    });

    sock.on('error', (e) => finish({ ok: false, detail: `socket error: ${e.message}` }));

    const packet = Buffer.alloc(74);
    packet.writeUInt16BE(0x1, 0);
    packet.writeUInt16BE(70, 2);
    packet.writeUInt32BE(ssrc, 4);

    sock.bind(0, () => {
      sock.send(packet, port, ip, (sendErr) => {
        if (sendErr) finish({ ok: false, detail: `send error: ${sendErr.message}` });
      });
    });

    setTimeout(() => finish({ ok: false, detail: `${timeoutMs/1000}s 무응답` }), timeoutMs);
  });
}

module.exports = { playTTSInChannel };
