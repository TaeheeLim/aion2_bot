'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { getDb } = require('../database');

// 참가 상태 정의
const STATUSES = ['참가', '불참', '보류'];
const STATUS_EMOJI = { 참가: '✅', 불참: '❌', 보류: '🤔' };
const BTN_PREFIX = 'rsvp'; // customId 형식: rsvp:<scheduleId>:<status>

// ──────────────────────────────────────────────────────────
// 슬래시 명령어 (/참여율)
// ──────────────────────────────────────────────────────────

const rsvpCommands = [
  new SlashCommandBuilder()
    .setName('참여율')
    .setDescription('멤버별 일정 참여율(참가 신청 기준) 랭킹을 보여줍니다.'),
];

// ──────────────────────────────────────────────────────────
// 공통 헬퍼 — 다른 모듈(schedule, scheduleChecker)에서 재사용
// ──────────────────────────────────────────────────────────

/**
 * 일정 등록/알림 메시지에 붙일 참가 버튼 행.
 * @param {number|string} scheduleId
 * @returns {ActionRowBuilder}
 */
function buildRsvpButtons(scheduleId) {
  const styles = { 참가: ButtonStyle.Success, 불참: ButtonStyle.Danger, 보류: ButtonStyle.Secondary };
  const row = new ActionRowBuilder();
  for (const s of STATUSES) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${BTN_PREFIX}:${scheduleId}:${s}`)
        .setLabel(s)
        .setEmoji(STATUS_EMOJI[s])
        .setStyle(styles[s]),
    );
  }
  return row;
}

/**
 * 특정 일정의 현재 참가 집계 텍스트.
 * @returns {string}
 */
function rsvpSummary(scheduleId) {
  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare(`SELECT user_id, status FROM schedule_rsvp WHERE schedule_id = ?`).all(scheduleId);
  } catch { /* 테이블 미생성 등 — 빈 요약 */ }

  const grouped = { 참가: [], 불참: [], 보류: [] };
  for (const r of rows) (grouped[r.status] ?? (grouped[r.status] = [])).push(r.user_id);

  const headline = STATUSES.map(s => `${STATUS_EMOJI[s]} ${s} **${grouped[s].length}**`).join('  ·  ');
  const goingList = grouped['참가'].length
    ? '\n참가: ' + grouped['참가'].slice(0, 20).map(u => `<@${u}>`).join(' ') + (grouped['참가'].length > 20 ? ` 외 ${grouped['참가'].length - 20}명` : '')
    : '';
  return headline + goingList;
}

// ──────────────────────────────────────────────────────────
// 버튼 인터랙션 처리 (index.js 에서 호출)
// ──────────────────────────────────────────────────────────

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} 이 모듈이 처리했는지
 */
async function handleRsvpButton(interaction) {
  if (!interaction.customId?.startsWith(`${BTN_PREFIX}:`)) return false;

  const [, scheduleIdStr, status] = interaction.customId.split(':');
  const scheduleId = Number(scheduleIdStr);

  if (!STATUSES.includes(status) || !Number.isInteger(scheduleId)) {
    await interaction.reply({ content: '❌ 잘못된 버튼입니다.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const db = getDb();

  // 일정 존재 확인 (해당 길드)
  const sched = db.prepare(`SELECT id, title FROM schedules WHERE id = ? AND guild_id = ?`)
    .get(scheduleId, interaction.guildId);
  if (!sched) {
    await interaction.reply({ content: '❌ 이미 삭제되었거나 만료된 일정입니다.', flags: MessageFlags.Ephemeral });
    return true;
  }

  try {
    db.prepare(`
      INSERT INTO schedule_rsvp (schedule_id, guild_id, user_id, status, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(schedule_id, user_id)
      DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(scheduleId, interaction.guildId, interaction.user.id, status, new Date().toISOString());
  } catch (err) {
    console.error('[RSVP] 저장 오류:', err);
    await interaction.reply({ content: '❌ 처리 중 오류가 발생했습니다.', flags: MessageFlags.Ephemeral });
    return true;
  }

  // 원본 메시지의 참가 현황 필드 갱신 (있으면)
  try {
    const msg = interaction.message;
    const baseEmbed = msg.embeds?.[0] ? EmbedBuilder.from(msg.embeds[0]) : new EmbedBuilder().setTitle(`📅 #${scheduleId} ${sched.title}`);
    const data = baseEmbed.toJSON();
    const fields = (data.fields ?? []).filter(f => f.name !== '🙋 참가 현황');
    fields.push({ name: '🙋 참가 현황', value: rsvpSummary(scheduleId) });
    baseEmbed.setFields(fields);
    await msg.edit({ embeds: [baseEmbed] });
  } catch (err) {
    console.warn('[RSVP] 메시지 갱신 실패(무시):', err.message);
  }

  await interaction.reply({
    content: `${STATUS_EMOJI[status]} **${sched.title}** 일정에 **${status}** (으)로 등록되었습니다.`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

// ──────────────────────────────────────────────────────────
// /참여율
// ──────────────────────────────────────────────────────────

async function handleAttendanceRate(interaction) {
  await interaction.deferReply();
  const db = getDb();
  const guildId = interaction.guildId;

  let totalSchedules, rows;
  try {
    // 분모: 이 서버에서 등록된(또는 RSVP가 달린) 일정 수.
    // 지난 일정은 정리될 수 있으므로 "RSVP가 존재했던 일정 수"를 분모로 사용.
    const distinct = db.prepare(`SELECT COUNT(DISTINCT schedule_id) AS c FROM schedule_rsvp WHERE guild_id = ?`).get(guildId);
    totalSchedules = distinct.c;

    rows = db.prepare(`
      SELECT user_id,
             SUM(CASE WHEN status='참가' THEN 1 ELSE 0 END) AS going,
             COUNT(*) AS responded
      FROM schedule_rsvp WHERE guild_id = ?
      GROUP BY user_id
      ORDER BY going DESC, responded DESC
      LIMIT 15
    `).all(guildId);
  } catch (err) {
    console.error('[참여율] DB 오류:', err);
    return interaction.editReply({ content: '❌ 참여율 집계 중 오류가 발생했습니다.' });
  }

  if (!totalSchedules || !rows.length) {
    return interaction.editReply({ content: '📭 아직 참가 신청 데이터가 없습니다. `/일정등록` 후 멤버들이 참가 버튼을 누르면 집계됩니다.' });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => {
    const rate = ((r.going / totalSchedules) * 100).toFixed(0);
    const tag = medals[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``;
    return `${tag} <@${r.user_id}> — 참가 **${r.going}/${totalSchedules}** (${rate}%) · 응답 ${r.responded}회`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x00cec9)
    .setTitle(`📊 ${interaction.guild?.name ?? '서버'} 일정 참여율`)
    .setDescription(`집계 대상 일정 **${totalSchedules}건** 기준 (참가 버튼 응답 기록)`)
    .addFields({ name: '🏅 참여 랭킹', value: lines.join('\n') })
    .setFooter({ text: '참가 = ✅ 응답 수 / 전체 일정 수' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ──────────────────────────────────────────────────────────
// interaction 라우팅 (슬래시)
// ──────────────────────────────────────────────────────────

async function handleRsvpInteraction(interaction) {
  switch (interaction.commandName) {
    case '참여율': await handleAttendanceRate(interaction); return true;
    default: return false;
  }
}

module.exports = {
  rsvpCommands,
  handleRsvpInteraction,
  handleRsvpButton,
  buildRsvpButtons,
  rsvpSummary,
};
