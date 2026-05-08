'use strict';

const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../database');
const { formatKST } = require('../utils/dateUtils');
const { playTTSInChannel } = require('../utils/ttsPlayer');

/**
 * 레기온 일정 알림 서비스
 *
 * 동작 방식:
 *  - node-cron으로 1분마다 DB를 조회합니다.
 *  - 현재 시각 기준 ±30초 오차를 허용하여
 *    60분 전, 30분 전, 10분 전에 해당하는 일정을 찾습니다.
 *  - notified_XX = 0 인 항목만 발송하고 즉시 notified_XX = 1 로 업데이트합니다.
 *    (중복 발송 방지)
 */

const CHECK_WINDOW_SEC = 30; // ±30초 오차 허용

/**
 * 알림 체크 및 발송
 * @param {import('discord.js').Client} client
 */
async function checkAndNotify(client) {
  const db  = getDb();
  const now = Date.now(); // ms

  const checks = [
    { minutes: 60, notifyCol: 'notify_60', notifiedCol: 'notified_60' },
    { minutes: 30, notifyCol: 'notify_30', notifiedCol: 'notified_30' },
    { minutes: 10, notifyCol: 'notify_10', notifiedCol: 'notified_10' },
    { minutes:  3, notifyCol: 'notify_3',  notifiedCol: 'notified_3'  },
  ];

  for (const { minutes, notifyCol, notifiedCol } of checks) {
    // 목표 시각: now + minutes
    const targetMs  = now + minutes * 60 * 1000;
    const windowMs  = CHECK_WINDOW_SEC * 1000;

    const lowerBound = new Date(targetMs - windowMs).toISOString();
    const upperBound = new Date(targetMs + windowMs).toISOString();

    let rows;
    try {
      rows = db.prepare(`
        SELECT * FROM schedules
        WHERE ${notifyCol} = 1
          AND ${notifiedCol} = 0
          AND scheduled_at >= ?
          AND scheduled_at <= ?
      `).all(lowerBound, upperBound);
    } catch (err) {
      console.error(`[scheduleChecker] DB 조회 오류 (${minutes}분):`, err);
      continue;
    }

    for (const row of rows) {
      try {
        await sendNotification(client, row, minutes);

        // 발송 완료 처리 (중복 방지)
        db.prepare(`
          UPDATE schedules
          SET ${notifiedCol} = 1, updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), row.id);

        console.log(`[scheduleChecker] 알림 발송 완료 — #${row.id} "${row.title}" (${minutes}분 전)`);
      } catch (err) {
        console.error(`[scheduleChecker] 알림 발송 실패 — #${row.id} (${minutes}분 전):`, err);
      }
    }
  }
}

/**
 * 디스코드 채널에 알림 메시지 발송
 * @param {import('discord.js').Client} client
 * @param {object} row - schedules DB row
 * @param {number} minutes - 몇 분 전 알림인지
 */
async function sendNotification(client, row, minutes) {
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[scheduleChecker] 채널을 찾을 수 없음: ${row.channel_id}`);
    return;
  }

  const mentionText = row.role_id ? `<@&${row.role_id}> ` : '';

  const embed = new EmbedBuilder()
    .setColor(minutes <= 10 ? 0xff4444 : minutes <= 30 ? 0xff9f1c : 0xffd60a)
    .setTitle(`⏰ [${minutes}분 전 알림] ${row.title}`)
    .addFields(
      { name: '🕐 일시',  value: formatKST(row.scheduled_at) + ' (KST)', inline: true },
      { name: '⏱️ 남은 시간', value: `약 ${minutes}분 후`,                inline: true },
    );

  if (row.description) {
    embed.addFields({ name: '📝 설명', value: row.description });
  }

  embed
    .setFooter({ text: `일정 ID: #${row.id}` })
    .setTimestamp();

  await channel.send({
    content: mentionText + `**${row.title}** 일정이 **${minutes}분 후** 시작됩니다!`,
    embeds: [embed],
  });

  // 음성채널 TTS 알림
  if (row.voice_channel_id) {
    try {
      const voiceChannel = await client.channels.fetch(row.voice_channel_id).catch(() => null);
      if (voiceChannel) {
        const ttsText = `${row.title} 일정이 ${minutes}분 후 시작됩니다`;
        await playTTSInChannel(voiceChannel, ttsText);
        console.log(`[scheduleChecker] TTS 재생 완료 — #${row.id} "${row.title}" (${minutes}분 전)`);
      }
    } catch (err) {
      console.error(`[scheduleChecker] TTS 재생 실패 — #${row.id}:`, err.message);
    }
  }
}

/**
 * 스케줄 체커 시작
 * @param {import('discord.js').Client} client
 */
function startScheduleChecker(client) {
  // 매 1분마다 실행 (초 단위 지원 포함)
  cron.schedule('* * * * *', async () => {
    try {
      await checkAndNotify(client);
    } catch (err) {
      console.error('[scheduleChecker] 예기치 못한 오류:', err);
    }
  }, {
    timezone: 'Asia/Seoul',
  });

  console.log('[scheduleChecker] 일정 알림 서비스 시작됨 (1분 간격)');
}

module.exports = { startScheduleChecker };
