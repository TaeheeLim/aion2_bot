'use strict';

/**
 * 슬래시 명령어 Discord API 등록 스크립트
 *
 * 실행: npm run deploy
 *
 * GUILD_ID가 설정된 경우: 해당 서버에만 즉시 등록 (개발 추천, 즉시 반영)
 * GUILD_ID가 없는 경우:   전체 글로벌 등록 (최대 1시간 반영 지연)
 */

require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { buildCommands }    = require('./commands/build');
const { scheduleCommands } = require('./commands/schedule');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

// 필수 환경변수 검증
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('[ERROR] .env 파일에 DISCORD_TOKEN, CLIENT_ID가 필요합니다.');
  process.exit(1);
}

// 모든 명령어 JSON 변환
const commands = [
  ...buildCommands,
  ...scheduleCommands,
].map(cmd => cmd.toJSON());

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`[배포] 슬래시 명령어 ${commands.length}개 등록 중...`);
    console.log('[배포] 명령어 목록:', commands.map(c => `/${c.name}`).join(', '));

    let data;
    if (GUILD_ID) {
      // 특정 서버에만 등록 (개발 환경 권장)
      data = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log(`[배포 완료] 서버(${GUILD_ID})에 ${data.length}개 명령어 등록 완료.`);
    } else {
      // 글로벌 등록 (배포 환경)
      data = await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );
      console.log(`[배포 완료] 글로벌에 ${data.length}개 명령어 등록 완료. (반영까지 최대 1시간)`);
    }
  } catch (err) {
    console.error('[배포 실패]', err);
    process.exit(1);
  }
})();
