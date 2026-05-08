'use strict';

const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../database');
const { formatKST } = require('../utils/dateUtils');
const { playTTSInChannel } = require('../utils/ttsPlayer');

const CHECK_WINDOW_SEC = 30; // ±30초 오차 허용

async function checkAndNotify(client) {
  const db  = getDb();
  const now = Date.now();

  const checks = [
    { minutes: 60, notifyCol: 'notify_60', notifiedCol: 'notified_60' },
    { minutes: 30, notifyCol: 'notify_30', notifiedCol: 'notified_30' },
    { minutes: 10, notifyCol: 'notify_10', notifiedCol: 'notified_10' },
    { minutes:  3, notifyCol: 'notify_3',  notifiedCol: 'notified_3'  },
  ];

  for (const { minutes, notifyCol, notifiedCol } of checks) {
    const targetMs = now + minutes * 60 * 1000;
    const windowMs = CHECK_WINDOW_SEC * 1000;

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

        db.prepare(`
          UPDATE schedules SET ${notifiedCol} = 1, updated_at = ? WHERE id = ?
        `).run(new Date().toISOString(), row.id);

        console.log(`[scheduleChecker] 알림 발송 완료 — #${row.id} "${row.title}" (${minutes}분 전)`);
      } catch (err) {
        console.error(`[scheduleChecker] 알림 발송 실패 — #${row.id} (${minutes}분 전):`, err);
      }
    }
  }
}

async function sendNotification(client, row, minutes) {
  // ── 텍스트 알림 ──────────────────────────────────────
  try {
    const channel = await client.channels.fetch(row.channel_id);
    if (channel && channel.isTextBased()) {
      const mentionText = row.role_id ? `<@&${row.role_id}> ` : '';

      const embed = new EmbedBuilder()
        .setColor(minutes <= 3 ? 0xff0000 : minutes <= 10 ? 0xff4444 : minutes <= 30 ? 0xff9f1c : 0xffd60a)
        .setTitle(`⏰ [${minutes}분 전 알림] ${row.title}`)
        .addFields(
          { name: '🕐 일시',      value: formatKST(row.scheduled_at) + ' (KST)', inline: true },
          { name: '⏱️ 남은 시간', value: `약 ${minutes}분 후`,                    inline: true },
        );

      if (row.description) embed.addFields({ name: '📝 설명', value: row.description });
      embed.setFooter({ text: `일정 ID: #${row.id}` }).setTimestamp();

      await channel.send({
        content: mentionText + `**${row.title}** 일정이 **${minutes}분 후** 시작됩니다!`,
        embeds: [embed],
      });
      console.log(`[scheduleChecker] 텍스트 알림 발송 — #${row.id} (${minutes}분 전)`);
    } else {
      console.warn(`[scheduleChecker] 텍스트 채널 없음: ${row.channel_id}`);
    }
  } catch (err) {
    console.error(`[scheduleChecker] 텍스트 알림 실패 — #${row.id}:`, err.message);
  }

  // ── TTS 알림 (텍스트 실패와 무관하게 독립 실행) ──────
  if (!row.voice_channel_id) return;

  try {
    console.log(`[TTS] 채널 fetch 시도: ${row.voice_channel_id}`);
    const voiceChannel = await client.channels.fetch(row.voice_channel_id);
    console.log(`[TTS] 채널 확인: ${voiceChannel.name} (type: ${voiceChannel.type})`);

    const ttsText = `${row.title} 일정이 ${minutes}분 후 시작됩니다`;
    await playTTSInChannel(voiceChannel, ttsText);
    console.log(`[TTS] 재생 완료 — #${row.id} "${row.title}" (${minutes}분 전)`);
  } catch (err) {
    console.error(`[TTS] 실패 — #${row.id}:`, err.message);
  }
}

function startScheduleChecker(client) {
  cron.schedule('* * * * *', async () => {
    try {
      await checkAndNotify(client);
    } catch (err) {
      console.error('[scheduleChecker] 예기치 못한 오류:', err);
    }
  }, { timezone: 'Asia/Seoul' });

  console.log('[scheduleChecker] 일정 알림 서비스 시작됨 (1분 간격)');
}

module.exports = { startScheduleChecker };
