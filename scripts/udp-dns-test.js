'use strict';

/**
 * Outbound UDP 도달성 기본 테스트.
 *
 * Google DNS (8.8.8.8:53) 와 Cloudflare DNS (1.1.1.1:53) 양쪽에
 * DNS 쿼리를 UDP 로 던져 응답이 오는지 본다.
 *
 *   둘 다 응답 → outbound UDP 는 정상. Discord 쪽 문제로 좁혀짐.
 *   둘 다 무응답 → outbound UDP 가 차단됨 (방화벽/안티바이러스/VPN).
 *
 * 사용법: node scripts/udp-dns-test.js
 */

const dgram = require('dgram');

// 최소 DNS query 패킷: example.com 의 A 레코드
// header (12B) + qname + qtype(2) + qclass(2)
function buildDnsQuery(domain, txnId = 0x1234) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(txnId, 0);   // ID
  header.writeUInt16BE(0x0100, 2);  // flags: standard query, RD=1
  header.writeUInt16BE(1, 4);       // QDCOUNT
  header.writeUInt16BE(0, 6);       // ANCOUNT
  header.writeUInt16BE(0, 8);       // NSCOUNT
  header.writeUInt16BE(0, 10);      // ARCOUNT

  const labels = domain.split('.');
  let qname = Buffer.alloc(0);
  for (const label of labels) {
    qname = Buffer.concat([qname, Buffer.from([label.length]), Buffer.from(label, 'ascii')]);
  }
  qname = Buffer.concat([qname, Buffer.from([0])]); // root

  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(1, 0); // QTYPE A
  tail.writeUInt16BE(1, 2); // QCLASS IN

  return Buffer.concat([header, qname, tail]);
}

function testDns(serverIp, label) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const query  = buildDnsQuery('example.com', Math.floor(Math.random() * 0xffff));
    const startedAt = Date.now();
    let resolved = false;

    socket.on('message', (msg, rinfo) => {
      if (resolved) return;
      resolved = true;
      const ms = Date.now() - startedAt;
      console.log(`✅ ${label} (${serverIp}) 응답 ${ms}ms, ${msg.length} bytes`);
      socket.close();
      resolve(true);
    });

    socket.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      console.error(`❌ ${label} (${serverIp}) socket 오류:`, err.message);
      socket.close();
      resolve(false);
    });

    socket.send(query, 53, serverIp, (err) => {
      if (err) {
        if (resolved) return;
        resolved = true;
        console.error(`❌ ${label} (${serverIp}) 전송 실패:`, err.message);
        socket.close();
        resolve(false);
        return;
      }
      console.log(`▶  ${label} (${serverIp}:53) 로 DNS 쿼리 전송`);
    });

    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      console.log(`⏱  ${label} (${serverIp}) 5초 무응답`);
      socket.close();
      resolve(false);
    }, 5_000);
  });
}

(async () => {
  console.log('=== outbound UDP 기본 도달성 테스트 ===\n');
  const g = await testDns('8.8.8.8', 'Google DNS');
  const c = await testDns('1.1.1.1', 'Cloudflare DNS');

  console.log('\n=== 결과 ===');
  if (g || c) {
    console.log('✅ outbound UDP 동작함 → Discord 측 (만료된 endpoint 또는 voice 서버 차단) 문제');
    console.log('   다음: 봇 실행 후 새 세션 IP/포트를 잡아서 그쪽으로 udp-discord-test 재실행');
  } else {
    console.log('❌ outbound UDP 가 전혀 안 됨 → Windows 방화벽/안티바이러스/VPN 차단 확정');
    console.log('   - Windows Defender 방화벽 → 인바운드/아웃바운드 규칙에서 node.exe 허용');
    console.log('   - 안티바이러스의 "네트워크 보호" 일시 해제');
    console.log('   - VPN/프록시 끄기');
    console.log('   - 모바일 핫스팟으로 바꿔 재시도');
  }
})();
