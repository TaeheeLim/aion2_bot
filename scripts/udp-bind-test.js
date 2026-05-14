'use strict';

/**
 * UDP 소켓을 특정 로컬 IP 에 바인딩했을 때 동작 비교.
 *
 * 일반(0.0.0.0) 바인딩 vs Wi-Fi IP 명시 바인딩 각각으로
 * Google DNS 에 쿼리를 던지고 응답 시간을 비교.
 *
 * 둘 다 응답 → 둘 다 동작 (라우팅 정상)
 * 둘 중 하나만 응답 → OS 의 인터페이스 선택이 영향을 줌
 */

const dgram = require('dgram');
const os    = require('os');

function buildDnsQuery() {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(Math.floor(Math.random() * 0xffff), 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  const qname = Buffer.concat([Buffer.from([7]), Buffer.from('example'), Buffer.from([3]), Buffer.from('com'), Buffer.from([0])]);
  const tail  = Buffer.alloc(4);
  tail.writeUInt16BE(1, 0);
  tail.writeUInt16BE(1, 2);
  return Buffer.concat([header, qname, tail]);
}

function testWithBind(localAddr, label) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const startedAt = Date.now();
    let resolved = false;

    socket.on('message', (msg, rinfo) => {
      if (resolved) return; resolved = true;
      console.log(`✅ ${label} → 응답 ${Date.now()-startedAt}ms, ${msg.length} bytes (from ${rinfo.address})`);
      socket.close();
      resolve(true);
    });
    socket.on('error', (e) => {
      if (resolved) return; resolved = true;
      console.error(`❌ ${label} → socket 오류: ${e.message}`);
      socket.close();
      resolve(false);
    });

    const onBound = () => {
      const a = socket.address();
      console.log(`▶  ${label} (bound to ${a.address}:${a.port}) → 8.8.8.8:53 송신`);
      socket.send(buildDnsQuery(), 53, '8.8.8.8', (err) => {
        if (err && !resolved) {
          resolved = true;
          console.error(`❌ ${label} → 전송 실패: ${err.message}`);
          socket.close();
          resolve(false);
        }
      });
    };

    try {
      if (localAddr) socket.bind(0, localAddr, onBound);
      else           socket.bind(0, onBound);
    } catch (e) {
      console.error(`❌ ${label} → bind 실패: ${e.message}`);
      socket.close();
      resolve(false);
    }

    setTimeout(() => {
      if (resolved) return; resolved = true;
      console.log(`⏱  ${label} → 5초 무응답`);
      socket.close();
      resolve(false);
    }, 5_000);
  });
}

(async () => {
  console.log('=== 네트워크 인터페이스 목록 ===');
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  ${name.padEnd(40)} ${a.address}`);
      }
    }
  }
  console.log();

  console.log('=== 각 인터페이스에서 UDP DNS 시도 ===');
  await testWithBind(null, 'default (0.0.0.0)');

  // Wi-Fi 같은 물리 인터페이스 후보들
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        await testWithBind(a.address, name);
      }
    }
  }
})();
