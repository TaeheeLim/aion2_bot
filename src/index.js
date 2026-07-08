'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { initDatabase } = require('./database');
// const { handleBuildInteraction }     = require('./commands/build'); // 빌드 기능 비활성화
const { handleScheduleInteraction }  = require('./commands/schedule');
const { handleTtsInteraction }       = require('./commands/tts');
const { handleDiceInteraction }      = require('./commands/dice');
const { handleCalendarInteraction }  = require('./commands/calendar');
const { handleInventoryInteraction } = require('./commands/inventory');
const { handleEnhanceCalcInteraction } = require('./commands/enhanceCalc');
const { handleRankingInteraction }   = require('./commands/ranking');
const { handleRsvpInteraction, handleRsvpButton } = require('./commands/rsvp');
const { handleHomeworkInteraction, handleHomeworkButton } = require('./commands/homework');
const { startScheduleChecker }       = require('./services/scheduleChecker');

// ──────────────────────────────────────────────────────────
// 환경변수 검증
// ──────────────────────────────────────────────────────────
const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  console.error('[ERROR] .env 파일에 DISCORD_TOKEN이 설정되어 있지 않습니다.');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────
// DB 초기화
// ──────────────────────────────────────────────────────────
initDatabase();

// ──────────────────────────────────────────────────────────
// Discord 클라이언트 생성
// ──────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ──────────────────────────────────────────────────────────
// 이벤트: 봇 준비 완료
// ──────────────────────────────────────────────────────────
client.once(Events.ClientReady, (readyClient) => {
  console.log(`[봇 시작] ${readyClient.user.tag} 로 로그인되었습니다.`);
  console.log(`[봇 시작] 서버 수: ${readyClient.guilds.cache.size}개`);

  // 일정 알림 서비스 시작
  startScheduleChecker(client);
});

// ──────────────────────────────────────────────────────────
// 이벤트: 슬래시 명령어 처리
// ──────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  // 버튼 인터랙션 (일정 참가 RSVP, 숙제 체크 등)
  if (interaction.isButton()) {
    try {
      if (await handleRsvpButton(interaction)) return;
      if (await handleHomeworkButton(interaction)) return;
    } catch (err) {
      console.error('[버튼 오류]', err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 처리 중 오류가 발생했습니다.', ephemeral: true });
        }
      } catch { /* 무시 */ }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  console.log(`[명령어] /${commandName} — 사용자: ${interaction.user.tag} (${interaction.guildId})`);

  try {
    // 빌드 관련 명령어 (비활성화)
    // const handledByBuild = await handleBuildInteraction(interaction);
    // if (handledByBuild) return;

    // 일정 관련 명령어
    const handledBySchedule = await handleScheduleInteraction(interaction);
    if (handledBySchedule) return;

    // TTS 관련 명령어 (디버그/테스트)
    const handledByTts = await handleTtsInteraction(interaction);
    if (handledByTts) return;

    // 주사위
    const handledByDice = await handleDiceInteraction(interaction);
    if (handledByDice) return;

    // 달력
    const handledByCalendar = await handleCalendarInteraction(interaction);
    if (handledByCalendar) return;

    // 인벤토리 / 강화 / 돌파
    const handledByInventory = await handleInventoryInteraction(interaction);
    if (handledByInventory) return;

    // 강화 계산기 / 시뮬
    const handledByEnhanceCalc = await handleEnhanceCalcInteraction(interaction);
    if (handledByEnhanceCalc) return;

    // 강화 랭킹
    const handledByRanking = await handleRankingInteraction(interaction);
    if (handledByRanking) return;

    // 일정 참여율
    const handledByRsvp = await handleRsvpInteraction(interaction);
    if (handledByRsvp) return;

    // 주간 숙제 체크리스트
    const handledByHomework = await handleHomeworkInteraction(interaction);
    if (handledByHomework) return;

    // 알 수 없는 명령어
    await interaction.reply({
      content: '❓ 알 수 없는 명령어입니다.',
      ephemeral: true,
    });
  } catch (err) {
    console.error(`[명령어 오류] /${commandName}:`, err);

    const errorMsg = { content: '❌ 명령어 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(errorMsg);
      } else {
        await interaction.reply(errorMsg);
      }
    } catch {
      // 응답 실패 시 무시
    }
  }
});

// ──────────────────────────────────────────────────────────
// 프로세스 예외 처리
// ──────────────────────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('[미처리 오류]', err);
});

process.on('uncaughtException', (err) => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});

// ──────────────────────────────────────────────────────────
// 봇 로그인
// ──────────────────────────────────────────────────────────
client.login(DISCORD_TOKEN).catch((err) => {
  console.error('[로그인 실패]', err.message);
  process.exit(1);
});
