'use strict';

/**
 * Discord voice UDP 도달성 단독 테스트.
 *
 * 봇 코드, @discordjs/voice 등을 모두 우회하고 Node 기본 dgram 으로
 * Discord 가 알려준 UDP 엔드포인트에 IP 발견 패킷을 보내본다.
 *
 * 사용법: node scripts/udp-discord-test.js [ip] [port]
 *   기본 IP/포트는 직전 실패한 세션의 값 사용.
 *
 * 응답이 오면 → 네트워크는 OK. 봇 코드/암호화 쪽 문제.
 * 응답이 없으면 → 방화벽/안티바이러스/VPN/라우터 등 UDP 차단.
 */

const dgram = require('dgram');

const ip   = process.argv[2] ?? '35.216.82.138';
const port = parseInt(process.argv[3] ?? '50008', 10);
const ssrc = 3188;

const socket = dgram.createSocket('udp4');

// Discord IP 발견 패킷: 74 bytes
//   bytes 0-1   : type     (0x0001 request)
//   bytes 2-3   : length   (70)
//   bytes 4-7   : ssrc
//   bytes 8-71  : address (zero-padded)
//   bytes 72-73 : port
const packet = Buffer.alloc(74);
packet.writeUInt16BE(0x1, 0);
packet.writeUInt16BE(70, 2);
packet.writeUInt32BE(ssrc, 4);

let received = false;

socket.on('message', (msg, rinfo) => {
  received = true;
  console.log(`✅ 응답 수신: from ${rinfo.address}:${rinfo.port}, ${msg.length} bytes`);
  try {
    // bytes 8-71 의 NUL 종료 문자열에 봇의 public IP, bytes 72-73 에 public port
    const addr = msg.subarray(8, 72).toString('utf8').replace(/\0/g, '');
    const pubPort = msg.readUInt16BE(72);
    console.log(`   봇 public 주소: ${addr}:${pubPort}`);
  } catch (e) {
    console.log(`   응답 파싱 실패: ${e.message}`);
  }
  socket.close();
});

socket.on('error', (err) => {
  console.error('❌ socket 오류:', err);
  socket.close();
});

socket.on('listening', () => {
  const addr = socket.address();
  console.log(`📡 로컬 바인딩: ${addr.address}:${addr.port}`);
});

socket.bind(0, () => {
  console.log(`▶  ${ip}:${port} 로 IP 발견 패킷 전송 (${packet.length} bytes, ssrc=${ssrc})`);
  socket.send(packet, port, ip, (err) => {
    if (err) console.error('❌ 전송 실패:', err);
    else console.log('   전송 완료, 응답 대기...');
  });
});

setTimeout(() => {
  if (!received) {
    console.log('⏱  10초간 응답 없음 → UDP 가 차단되었거나 라우팅이 막힘');
    console.log('   확인:');
    console.log('   1) Windows Defender 방화벽 → 아웃바운드 규칙에서 node.exe 허용');
    console.log('   2) 안티바이러스 (V3, 알약 등) 의 네트워크 보호 일시 해제');
    console.log('   3) VPN/프록시 사용 중이면 해제');
    console.log('   4) 모바일 핫스팟으로 네트워크 바꿔 재시도');
    socket.close();
  }
}, 10_000);
