'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { getDb } = require('../database');
const { formatKST } = require('../utils/dateUtils');

// ──────────────────────────────────────────────────────────
// 슬래시 명령어 정의
// ──────────────────────────────────────────────────────────

const buildCommands = [
  // /빌드등록
  new SlashCommandBuilder()
    .setName('빌드등록')
    .setDescription('아이온2 직업 빌드를 등록합니다.')
    .addStringOption(opt =>
      opt.setName('직업명')
        .setDescription('직업 이름 (예: 수호성, 강령사)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('빌드명')
        .setDescription('빌드 이름 (예: 탱킹70딜30)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('설명')
        .setDescription('빌드 설명')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('주요스탯')
        .setDescription('주요 스탯 (예: 생명력, 방어력 중심)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('스킬설명')
        .setDescription('스킬/특성 설명')
        .setRequired(false)
    ),

  // /빌드검색
  new SlashCommandBuilder()
    .setName('빌드검색')
    .setDescription('직업명 또는 키워드로 빌드를 검색합니다.')
    .addStringOption(opt =>
      opt.setName('키워드')
        .setDescription('검색할 직업명 또는 키워드')
        .setRequired(true)
    ),

  // /빌드목록
  new SlashCommandBuilder()
    .setName('빌드목록')
    .setDescription('등록된 빌드 목록을 최신순으로 보여줍니다.'),

  // /빌드삭제
  new SlashCommandBuilder()
    .setName('빌드삭제')
    .setDescription('등록된 빌드를 삭제합니다. (본인 또는 관리자)')
    .addIntegerOption(opt =>
      opt.setName('빌드id')
        .setDescription('삭제할 빌드 ID (/빌드목록에서 확인)')
        .setRequired(true)
    ),
];

// ──────────────────────────────────────────────────────────
// 핸들러
// ──────────────────────────────────────────────────────────

/**
 * /빌드등록 처리
 */
async function handleBuildRegister(interaction) {
  await interaction.deferReply({ ephemeral: false });

  const db       = getDb();
  const guildId  = interaction.guildId;
  const authorId = interaction.user.id;
  const jobName  = interaction.options.getString('직업명').trim();
  const buildName= interaction.options.getString('빌드명').trim();
  const desc     = interaction.options.getString('설명')   ?? '';
  const stats    = interaction.options.getString('주요스탯') ?? '';
  const skills   = interaction.options.getString('스킬설명') ?? '';
  const now      = new Date().toISOString();

  try {
    const stmt = db.prepare(`
      INSERT INTO builds (guild_id, job_name, build_name, description, stats, skills, author_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(guildId, jobName, buildName, desc, stats, skills, authorId, now, now);

    const embed = new EmbedBuilder()
      .setColor(0x00b4d8)
      .setTitle('✅ 빌드 등록 완료!')
      .addFields(
        { name: '🆔 빌드 ID', value: `#${result.lastInsertRowid}`, inline: true },
        { name: '⚔️ 직업',   value: jobName,   inline: true },
        { name: '📋 빌드명', value: buildName,  inline: true },
        ...(desc   ? [{ name: '📝 설명',     value: desc   }] : []),
        ...(stats  ? [{ name: '📊 주요 스탯', value: stats  }] : []),
        ...(skills ? [{ name: '🔮 스킬/특성', value: skills }] : []),
      )
      .setFooter({ text: `작성자: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[빌드등록] DB 오류:', err);
    await interaction.editReply({ content: '❌ 빌드 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
}

/**
 * /빌드검색 처리
 */
async function handleBuildSearch(interaction) {
  await interaction.deferReply();

  const db      = getDb();
  const guildId = interaction.guildId;
  const keyword = interaction.options.getString('키워드').trim();
  const like    = `%${keyword}%`;

  try {
    const rows = db.prepare(`
      SELECT * FROM builds
      WHERE guild_id = ?
        AND (job_name LIKE ? OR build_name LIKE ? OR description LIKE ?)
      ORDER BY created_at DESC
      LIMIT 10
    `).all(guildId, like, like, like);

    if (rows.length === 0) {
      return interaction.editReply({ content: `🔍 **"${keyword}"** 에 해당하는 빌드를 찾지 못했습니다.` });
    }

    const embeds = rows.map(row => buildRowToEmbed(row));
    await interaction.editReply({
      content: `🔍 **"${keyword}"** 검색 결과 ${rows.length}건`,
      embeds: embeds.slice(0, 10), // Discord 최대 10개
    });
  } catch (err) {
    console.error('[빌드검색] DB 오류:', err);
    await interaction.editReply({ content: '❌ 검색 중 오류가 발생했습니다.' });
  }
}

/**
 * /빌드목록 처리
 */
async function handleBuildList(interaction) {
  await interaction.deferReply();

  const db      = getDb();
  const guildId = interaction.guildId;

  try {
    const rows = db.prepare(`
      SELECT id, job_name, build_name, author_id, created_at
      FROM builds
      WHERE guild_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(guildId);

    if (rows.length === 0) {
      return interaction.editReply({ content: '📭 등록된 빌드가 없습니다.' });
    }

    const lines = rows.map(row =>
      `\`#${row.id}\` **[${row.job_name}]** ${row.build_name} — <@${row.author_id}> | ${formatKST(row.created_at, 'yyyy-MM-dd')}`
    );

    const embed = new EmbedBuilder()
      .setColor(0x48cae4)
      .setTitle('📚 빌드 목록 (최신순)')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `총 ${rows.length}개 표시 (최대 20개)` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[빌드목록] DB 오류:', err);
    await interaction.editReply({ content: '❌ 목록 조회 중 오류가 발생했습니다.' });
  }
}

/**
 * /빌드삭제 처리
 */
async function handleBuildDelete(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const db      = getDb();
  const guildId = interaction.guildId;
  const buildId = interaction.options.getInteger('빌드id');
  const userId  = interaction.user.id;
  const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ?? false;

  try {
    const row = db.prepare(`
      SELECT * FROM builds WHERE id = ? AND guild_id = ?
    `).get(buildId, guildId);

    if (!row) {
      return interaction.editReply({ content: `❌ 빌드 ID \`#${buildId}\` 를 찾을 수 없습니다.` });
    }

    if (row.author_id !== userId && !isAdmin) {
      return interaction.editReply({ content: '⛔ 본인이 등록한 빌드만 삭제할 수 있습니다.' });
    }

    db.prepare('DELETE FROM builds WHERE id = ?').run(buildId);

    await interaction.editReply({
      content: `🗑️ 빌드 **#${buildId} [${row.job_name}] ${row.build_name}** 이(가) 삭제되었습니다.`,
    });
  } catch (err) {
    console.error('[빌드삭제] DB 오류:', err);
    await interaction.editReply({ content: '❌ 삭제 중 오류가 발생했습니다.' });
  }
}

// ──────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────

/**
 * DB 빌드 row → Discord Embed 변환
 * @param {object} row
 * @returns {EmbedBuilder}
 */
function buildRowToEmbed(row) {
  const embed = new EmbedBuilder()
    .setColor(0x0096c7)
    .setTitle(`⚔️ [${row.job_name}] ${row.build_name}`)
    .addFields(
      { name: '🆔 빌드 ID', value: `#${row.id}`, inline: true },
      { name: '👤 작성자',  value: `<@${row.author_id}>`, inline: true },
      { name: '📅 등록일',  value: formatKST(row.created_at), inline: true },
    );

  if (row.description) embed.addFields({ name: '📝 설명', value: row.description });
  if (row.stats)       embed.addFields({ name: '📊 주요 스탯', value: row.stats });
  if (row.skills)      embed.addFields({ name: '🔮 스킬/특성', value: row.skills });

  return embed;
}

// ──────────────────────────────────────────────────────────
// interaction 라우팅
// ──────────────────────────────────────────────────────────

/**
 * 빌드 관련 interaction 처리
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<boolean>} 처리 여부
 */
async function handleBuildInteraction(interaction) {
  switch (interaction.commandName) {
    case '빌드등록': await handleBuildRegister(interaction); return true;
    case '빌드검색': await handleBuildSearch(interaction);   return true;
    case '빌드목록': await handleBuildList(interaction);     return true;
    case '빌드삭제': await handleBuildDelete(interaction);   return true;
    default: return false;
  }
}

module.exports = { buildCommands, handleBuildInteraction };
