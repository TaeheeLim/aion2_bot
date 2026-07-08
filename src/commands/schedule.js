'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { getDb } = require('../database');
const {
  parseKST,
  formatKST,
  todayKSTRange,
  isValidDate,
  isValidTime,
} = require('../utils/dateUtils');
const { buildRsvpButtons } = require('./rsvp');

// ──────────────────────────────────────────────────────────
// 슬래시 명령어 정의
// ──────────────────────────────────────────────────────────

const scheduleCommands = [
  // /일정등록
  new SlashCommandBuilder()
    .setName('일정등록')
    .setDescription('레기온 일정을 등록하고 자동 알림을 설정합니다.')
    .addStringOption(opt =>
      opt.setName('제목')
        .setDescription('일정 제목 (예: 레기온 공성)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('날짜')
        .setDescription('일정 날짜 (YYYY-MM-DD, 예: 2026-05-10)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('시간')
        .setDescription('일정 시간 KST (HH:mm, 예: 21:00)')
        .setRequired(true)
    )
    .addChannelOption(opt =>
      opt.setName('알림채널')
        .setDescription('알림을 보낼 채널')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('설명')
        .setDescription('일정 설명')
        .setRequired(false)
    )
    .addRoleOption(opt =>
      opt.setName('멘션역할')
        .setDescription('알림 시 멘션할 역할 (없으면 생략)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('60분전알림')
        .setDescription('60분 전 알림 여부')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('30분전알림')
        .setDescription('30분 전 알림 여부')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('10분전알림')
        .setDescription('10분 전 알림 여부')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('3분전알림')
        .setDescription('3분 전 알림 여부')
        .setRequired(false)
    )
    .addChannelOption(opt =>
      opt.setName('음성채널')
        .setDescription('알림 시 TTS를 재생할 음성 채널 (선택)')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(false)
    ),

  // /일정목록
  new SlashCommandBuilder()
    .setName('일정목록')
    .setDescription('앞으로 예정된 레기온 일정을 날짜순으로 보여줍니다.'),

  // /오늘일정
  new SlashCommandBuilder()
    .setName('오늘일정')
    .setDescription('오늘 예정된 레기온 일정을 보여줍니다.'),

  // /일정삭제
  new SlashCommandBuilder()
    .setName('일정삭제')
    .setDescription('레기온 일정을 삭제합니다. (본인 또는 관리자)')
    .addIntegerOption(opt =>
      opt.setName('일정id')
        .setDescription('삭제할 일정 ID (/일정목록에서 확인)')
        .setRequired(true)
    ),
];

// ──────────────────────────────────────────────────────────
// 핸들러
// ──────────────────────────────────────────────────────────

/**
 * /일정등록 처리
 */
async function handleScheduleRegister(interaction) {
  await interaction.deferReply({ ephemeral: false });

  const db      = getDb();
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;

  const title   = interaction.options.getString('제목').trim();
  const rawDate = interaction.options.getString('날짜').trim();
  const timeStr = interaction.options.getString('시간').trim();

  // '오늘' 입력 시 KST 기준 오늘 날짜로 자동 변환
  const dateStr = (rawDate === '오늘')
    ? formatKST(new Date(), 'yyyy-MM-dd')
    : rawDate;
  const channel      = interaction.options.getChannel('알림채널');
  const desc         = interaction.options.getString('설명')    ?? '';
  const role         = interaction.options.getRole('멘션역할');
  const n60          = interaction.options.getBoolean('60분전알림') ?? false;
  const n30          = interaction.options.getBoolean('30분전알림') ?? false;
  const n10          = interaction.options.getBoolean('10분전알림') ?? false;
  const n3           = interaction.options.getBoolean('3분전알림')  ?? false;
  const voiceChannel = interaction.options.getChannel('음성채널')   ?? null;

  // 날짜/시간 유효성 검사
  if (!isValidDate(dateStr)) {
    return interaction.editReply({ content: '❌ 날짜 형식이 올바르지 않습니다. `YYYY-MM-DD` 형식으로 입력해주세요.\n예시: `2026-05-10`' });
  }
  if (!isValidTime(timeStr)) {
    return interaction.editReply({ content: '❌ 시간 형식이 올바르지 않습니다. `HH:mm` 형식으로 입력해주세요.\n예시: `21:00`' });
  }

  const scheduledAt = parseKST(dateStr, timeStr);
  if (!scheduledAt) {
    return interaction.editReply({ content: '❌ 날짜/시간 변환에 실패했습니다. 다시 확인해주세요.' });
  }

  // 과거 일정 등록 방지
  if (scheduledAt <= new Date()) {
    return interaction.editReply({ content: '❌ 과거 일정은 등록할 수 없습니다. 미래 날짜를 입력해주세요.' });
  }

  if (!n60 && !n30 && !n10 && !n3) {
    return interaction.editReply({ content: '⚠️ 60분 전, 30분 전, 10분 전, 3분 전 알림 중 하나 이상을 설정해주세요.' });
  }

  const now = new Date().toISOString();

  try {
    const stmt = db.prepare(`
      INSERT INTO schedules
        (guild_id, title, scheduled_at, description, channel_id, role_id,
         notify_60, notify_30, notify_10, notify_3,
         notified_60, notified_30, notified_10, notified_3,
         voice_channel_id, author_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      guildId, title, scheduledAt.toISOString(), desc,
      channel.id, role?.id ?? null,
      n60 ? 1 : 0, n30 ? 1 : 0, n10 ? 1 : 0, n3 ? 1 : 0,
      voiceChannel?.id ?? null,
      userId, now, now
    );

    const notifyList = [n60 && '60분 전', n30 && '30분 전', n10 && '10분 전', n3 && '3분 전']
      .filter(Boolean).join(', ');

    const embed = new EmbedBuilder()
      .setColor(0x06d6a0)
      .setTitle('📅 일정 등록 완료!')
      .addFields(
        { name: '🆔 일정 ID',  value: `#${result.lastInsertRowid}`, inline: true },
        { name: '📌 제목',     value: title,                         inline: true },
        { name: '🕐 일시',     value: `${dateStr} ${timeStr} (KST)`, inline: true },
        { name: '📢 알림 채널', value: `<#${channel.id}>`,           inline: true },
        { name: '⏰ 알림 시점', value: notifyList,                   inline: true },
        ...(role         ? [{ name: '📣 멘션 역할', value: `<@&${role.id}>`,                   inline: true }] : []),
        ...(voiceChannel ? [{ name: '🔊 TTS 음성채널', value: `<#${voiceChannel.id}>`, inline: true }] : []),
        ...(desc ? [{ name: '📝 설명', value: desc }] : []),
        { name: '🙋 참가 현황', value: `${'✅ 참가 **0**  ·  ❌ 불참 **0**  ·  🤔 보류 **0**'}\n_아래 버튼으로 참가 여부를 알려주세요._` },
      )
      .setFooter({ text: `등록자: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [buildRsvpButtons(result.lastInsertRowid)],
    });
  } catch (err) {
    console.error('[일정등록] DB 오류:', err);
    await interaction.editReply({ content: '❌ 일정 등록 중 오류가 발생했습니다.' });
  }
}

/**
 * /일정목록 처리
 */
async function handleScheduleList(interaction) {
  await interaction.deferReply();

  const db      = getDb();
  const guildId = interaction.guildId;
  const now     = new Date().toISOString();

  try {
    const rows = db.prepare(`
      SELECT * FROM schedules
      WHERE guild_id = ? AND scheduled_at > ?
      ORDER BY scheduled_at ASC
      LIMIT 15
    `).all(guildId, now);

    if (rows.length === 0) {
      return interaction.editReply({ content: '📭 예정된 일정이 없습니다.' });
    }

    const embeds = rows.map(row => scheduleRowToEmbed(row));
    await interaction.editReply({
      content: `📋 **예정된 일정 ${rows.length}건**`,
      embeds: embeds.slice(0, 10),
    });
  } catch (err) {
    console.error('[일정목록] DB 오류:', err);
    await interaction.editReply({ content: '❌ 일정 조회 중 오류가 발생했습니다.' });
  }
}

/**
 * /오늘일정 처리
 */
async function handleTodaySchedule(interaction) {
  await interaction.deferReply();

  const db      = getDb();
  const guildId = interaction.guildId;
  const { start, end } = todayKSTRange();

  try {
    const rows = db.prepare(`
      SELECT * FROM schedules
      WHERE guild_id = ?
        AND scheduled_at >= ?
        AND scheduled_at <= ?
      ORDER BY scheduled_at ASC
    `).all(guildId, start, end);

    if (rows.length === 0) {
      return interaction.editReply({ content: '📭 오늘 예정된 일정이 없습니다.' });
    }

    const embeds = rows.map(row => scheduleRowToEmbed(row));
    await interaction.editReply({
      content: `☀️ **오늘의 레기온 일정 ${rows.length}건**`,
      embeds: embeds.slice(0, 10),
    });
  } catch (err) {
    console.error('[오늘일정] DB 오류:', err);
    await interaction.editReply({ content: '❌ 일정 조회 중 오류가 발생했습니다.' });
  }
}

/**
 * /일정삭제 처리
 */
async function handleScheduleDelete(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const db         = getDb();
  const guildId    = interaction.guildId;
  const scheduleId = interaction.options.getInteger('일정id');
  const userId     = interaction.user.id;
  const isAdmin    = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

  try {
    const row = db.prepare(`
      SELECT * FROM schedules WHERE id = ? AND guild_id = ?
    `).get(scheduleId, guildId);

    if (!row) {
      return interaction.editReply({ content: `❌ 일정 ID \`#${scheduleId}\` 를 찾을 수 없습니다.` });
    }

    if (row.author_id !== userId && !isAdmin) {
      return interaction.editReply({ content: '⛔ 본인이 등록한 일정만 삭제할 수 있습니다.' });
    }

    db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);

    await interaction.editReply({
      content: `🗑️ 일정 **#${scheduleId} ${row.title}** (${formatKST(row.scheduled_at)}) 이(가) 삭제되었습니다.`,
    });
  } catch (err) {
    console.error('[일정삭제] DB 오류:', err);
    await interaction.editReply({ content: '❌ 삭제 중 오류가 발생했습니다.' });
  }
}

// ──────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────

/**
 * DB 일정 row → Discord Embed 변환
 * @param {object} row
 * @returns {EmbedBuilder}
 */
function scheduleRowToEmbed(row) {
  const notifyParts = [
    row.notify_60 ? '60분 전' : null,
    row.notify_30 ? '30분 전' : null,
    row.notify_10 ? '10분 전' : null,
    row.notify_3  ? '3분 전'  : null,
  ].filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(0x118ab2)
    .setTitle(`📅 #${row.id} ${row.title}`)
    .addFields(
      { name: '🕐 일시',     value: formatKST(row.scheduled_at) + ' (KST)', inline: true },
      { name: '📢 알림 채널', value: `<#${row.channel_id}>`,                 inline: true },
      { name: '⏰ 알림 설정', value: notifyParts.length ? notifyParts.join(', ') : '없음', inline: true },
      { name: '👤 등록자',   value: `<@${row.author_id}>`, inline: true },
    );

  if (row.role_id)     embed.addFields({ name: '📣 멘션 역할', value: `<@&${row.role_id}>`, inline: true });
  if (row.description) embed.addFields({ name: '📝 설명', value: row.description });

  return embed;
}

// ──────────────────────────────────────────────────────────
// interaction 라우팅
// ──────────────────────────────────────────────────────────

/**
 * 일정 관련 interaction 처리
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<boolean>} 처리 여부
 */
async function handleScheduleInteraction(interaction) {
  switch (interaction.commandName) {
    case '일정등록': await handleScheduleRegister(interaction); return true;
    case '일정목록': await handleScheduleList(interaction);     return true;
    case '오늘일정': await handleTodaySchedule(interaction);    return true;
    case '일정삭제': await handleScheduleDelete(interaction);   return true;
    default: return false;
  }
}

module.exports = { scheduleCommands, handleScheduleInteraction };
