'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');
const { getDb } = require('../database');
const {
  getHeroEnhanceStep,
  getHeroBreakthroughStep,
  getRuneEnhanceStep,
  MAX_HERO_ENHANCE,
  MAX_HERO_BREAKTHROUGH,
  MAX_RUNE_ENHANCE,
} = require('../data/enhanceData');

const ITEM_TYPES = ['영웅', '전념의룬'];

// ──────────────────────────────────────────────────────────
// 슬래시 명령어 정의
// ──────────────────────────────────────────────────────────

const inventoryCommands = [
  // /장비생성
  new SlashCommandBuilder()
    .setName('장비생성')
    .setDescription('새 장비를 생성합니다 (강화 1강 / 돌파 0 상태).')
    .addStringOption(opt =>
      opt.setName('종류')
        .setDescription('아이템 종류')
        .setRequired(true)
        .addChoices(
          { name: '영웅',     value: '영웅'     },
          { name: '전념의룬', value: '전념의룬' },
        )
    )
    .addStringOption(opt =>
      opt.setName('이름')
        .setDescription('내가 부를 장비 이름 (예: 엑스칼리버)')
        .setRequired(true)
        .setMaxLength(30)
    ),

  // /장비목록
  new SlashCommandBuilder()
    .setName('장비목록')
    .setDescription('내 장비 인벤토리를 ASCII 형태로 보여줍니다.'),

  // /장비삭제
  new SlashCommandBuilder()
    .setName('장비삭제')
    .setDescription('내 인벤토리에서 장비를 삭제합니다.')
    .addIntegerOption(opt =>
      opt.setName('장비id')
        .setDescription('삭제할 장비 ID (/장비목록 에서 확인)')
        .setRequired(true)
    ),

  // /강화
  new SlashCommandBuilder()
    .setName('강화')
    .setDescription('장비를 1회 강화 시도합니다.')
    .addIntegerOption(opt =>
      opt.setName('장비id')
        .setDescription('강화할 장비 ID')
        .setRequired(true)
    ),

  // /돌파
  new SlashCommandBuilder()
    .setName('돌파')
    .setDescription('영웅 장비를 1회 돌파 시도합니다. (강화 20강 도달 후 가능)')
    .addIntegerOption(opt =>
      opt.setName('장비id')
        .setDescription('돌파할 장비 ID')
        .setRequired(true)
    ),
];

// ──────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────

function getItem(db, id, guildId) {
  return db.prepare(`SELECT * FROM inventory WHERE id = ? AND guild_id = ?`).get(id, guildId);
}

function formatNumber(n) {
  return Number(n).toLocaleString('ko-KR');
}

function rollSuccess(probPercent) {
  return Math.random() * 100 < probPercent;
}

function itemStatusLabel(item) {
  if (item.destroyed) return '💀 파괴';
  if (item.item_type === '영웅' && item.enhance_level >= MAX_HERO_ENHANCE && item.breakthrough_level >= MAX_HERO_BREAKTHROUGH) return '🏆 만렙';
  if (item.item_type === '전념의룬' && item.enhance_level >= MAX_RUNE_ENHANCE) return '🏆 만렙';
  return '✅ 정상';
}

/**
 * 사용자 인벤토리를 ASCII 텍스트 블록으로 렌더링.
 * 한글은 모노스페이스에서 2칸이라 박스 정렬이 어렵기 때문에,
 * 정렬 의존도가 낮은 트리 형식을 사용한다.
 */
function renderInventoryAscii(items, totals) {
  if (items.length === 0) {
    return '_인벤토리가 비어있습니다._\n`/장비생성` 으로 새 장비를 만들어 보세요.';
  }
  const lines = [];
  lines.push('═════════════════════════════════════════');
  for (const it of items) {
    const status   = itemStatusLabel(it);
    const failInfo = [];
    if (it.item_type === '영웅' && it.enhance_fail_streak > 0)        failInfo.push(`강화 실패 ${it.enhance_fail_streak}회`);
    if (it.item_type === '영웅' && it.breakthrough_fail_streak > 0)   failInfo.push(`돌파 실패 ${it.breakthrough_fail_streak}회`);
    const levelInfo = it.item_type === '영웅'
      ? `강화 ${it.enhance_level}강 / 돌파 ${it.breakthrough_level}`
      : `강화 ${it.enhance_level}강`;

    lines.push(`#${it.id}  [${it.item_type}]  ${it.item_name}   ${status}`);
    lines.push(`  └─ ${levelInfo}`);
    if (failInfo.length) lines.push(`  └─ ${failInfo.join(' · ')}`);
    if (it.destroyed && it.destroyed_reason) lines.push(`  └─ 사유: ${it.destroyed_reason}`);
    lines.push(`  └─ 누적 키나 ${formatNumber(it.total_kinah_used)} / 강화석 ${formatNumber(it.total_enhance_stones_used)} / 돌파석 ${formatNumber(it.total_breakthrough_stones_used)}`);
    lines.push('─────────────────────────────────────────');
  }
  lines.push('');
  lines.push('💰 사용자 전체 누적');
  lines.push(`   ⊙ 키나   : ${formatNumber(totals.kinah)}`);
  lines.push(`   ⊙ 강화석 : ${formatNumber(totals.enhanceStones)} 개`);
  lines.push(`   ⊙ 돌파석 : ${formatNumber(totals.breakthroughStones)} 개`);
  return '```\n' + lines.join('\n') + '\n```';
}

function computeTotals(items) {
  return items.reduce((acc, it) => {
    acc.kinah              += it.total_kinah_used;
    acc.enhanceStones      += it.total_enhance_stones_used;
    acc.breakthroughStones += it.total_breakthrough_stones_used;
    return acc;
  }, { kinah: 0, enhanceStones: 0, breakthroughStones: 0 });
}

// ──────────────────────────────────────────────────────────
// /장비생성
// ──────────────────────────────────────────────────────────

async function handleItemCreate(interaction) {
  await interaction.deferReply({ ephemeral: false });

  const db      = getDb();
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;
  const type    = interaction.options.getString('종류');
  const name    = interaction.options.getString('이름').trim();

  if (!ITEM_TYPES.includes(type)) {
    return interaction.editReply({ content: '❌ 알 수 없는 종류입니다.' });
  }
  if (!name) {
    return interaction.editReply({ content: '❌ 이름을 입력해주세요.' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO inventory (guild_id, user_id, item_name, item_type)
      VALUES (?, ?, ?, ?)
    `).run(guildId, userId, name, type);

    const embed = new EmbedBuilder()
      .setColor(0x06d6a0)
      .setTitle('🛠️ 장비 생성 완료')
      .addFields(
        { name: '🆔 장비 ID',  value: `#${result.lastInsertRowid}`, inline: true },
        { name: '🏷️ 종류',    value: type,                           inline: true },
        { name: '📛 이름',     value: name,                           inline: true },
        { name: '⚒️ 강화',    value: '1강',                           inline: true },
        { name: '💥 돌파',    value: type === '영웅' ? '0' : '—',     inline: true },
      )
      .setFooter({ text: `소유자: ${interaction.user.tag}` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[장비생성] DB 오류:', err);
    await interaction.editReply({ content: '❌ 장비 생성 중 오류가 발생했습니다.' });
  }
}

// ──────────────────────────────────────────────────────────
// /장비목록
// ──────────────────────────────────────────────────────────

async function handleItemList(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const db      = getDb();
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;

  try {
    const items = db.prepare(`
      SELECT * FROM inventory
      WHERE guild_id = ? AND user_id = ?
      ORDER BY destroyed ASC, id ASC
      LIMIT 30
    `).all(guildId, userId);

    const totals = computeTotals(items);
    const text   = renderInventoryAscii(items, totals);

    const embed = new EmbedBuilder()
      .setColor(0x48cae4)
      .setTitle(`🎒 ${interaction.user.username} 님의 인벤토리`)
      .setDescription(text)
      .setFooter({ text: `총 ${items.length}개 장비` });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[장비목록] DB 오류:', err);
    await interaction.editReply({ content: '❌ 장비 조회 중 오류가 발생했습니다.' });
  }
}

// ──────────────────────────────────────────────────────────
// /장비삭제
// ──────────────────────────────────────────────────────────

async function handleItemDelete(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const db       = getDb();
  const guildId  = interaction.guildId;
  const userId   = interaction.user.id;
  const itemId   = interaction.options.getInteger('장비id');

  try {
    const item = getItem(db, itemId, guildId);
    if (!item) return interaction.editReply({ content: `❌ 장비 #${itemId} 를 찾을 수 없습니다.` });
    if (item.user_id !== userId) {
      return interaction.editReply({ content: '⛔ 본인 소유의 장비만 삭제할 수 있습니다.' });
    }

    db.prepare('DELETE FROM inventory WHERE id = ?').run(itemId);
    await interaction.editReply({
      content: `🗑️ 장비 **#${itemId} [${item.item_type}] ${item.item_name}** 이(가) 삭제되었습니다.`,
    });
  } catch (err) {
    console.error('[장비삭제] DB 오류:', err);
    await interaction.editReply({ content: '❌ 삭제 중 오류가 발생했습니다.' });
  }
}

// ──────────────────────────────────────────────────────────
// /강화
// ──────────────────────────────────────────────────────────

async function handleEnhance(interaction) {
  await interaction.deferReply({ ephemeral: false });

  const db      = getDb();
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;
  const itemId  = interaction.options.getInteger('장비id');

  const item = getItem(db, itemId, guildId);
  if (!item)                  return interaction.editReply({ content: `❌ 장비 #${itemId} 를 찾을 수 없습니다.` });
  if (item.user_id !== userId) return interaction.editReply({ content: '⛔ 본인 소유의 장비만 강화할 수 있습니다.' });
  if (item.destroyed)          return interaction.editReply({ content: `💀 파괴된 장비입니다. (#${item.id} ${item.item_name})` });

  // 최대치 도달 체크
  if (item.item_type === '영웅' && item.enhance_level >= MAX_HERO_ENHANCE) {
    return interaction.editReply({
      content: `🏆 이미 강화 ${MAX_HERO_ENHANCE}강 만렙입니다. \`/돌파 장비id:${item.id}\` 로 돌파를 시도해보세요.`,
    });
  }
  if (item.item_type === '전념의룬' && item.enhance_level >= MAX_RUNE_ENHANCE) {
    return interaction.editReply({
      content: `🏆 이미 전념의룬 ${MAX_RUNE_ENHANCE}강 만렙입니다!`,
    });
  }

  // step 조회
  const step = item.item_type === '영웅'
    ? getHeroEnhanceStep(item.enhance_level)
    : getRuneEnhanceStep(item.enhance_level);

  if (!step) return interaction.editReply({ content: '❌ 강화 데이터를 찾을 수 없습니다.' });

  // 보정 적용 (영웅만 fail_boost 사용)
  const failBoost = step.fail_boost ?? 0;
  const effectiveProb = Math.min(100, step.prob + (item.enhance_fail_streak * failBoost));

  // 확률 굴림
  const success = rollSuccess(effectiveProb);

  // DB 업데이트
  const now = new Date().toISOString();
  let newLevel       = item.enhance_level;
  let newFailStreak  = item.enhance_fail_streak;
  let newDestroyed   = item.destroyed;
  let destroyedReason = item.destroyed_reason;

  if (success) {
    newLevel = item.enhance_level + 1;
    newFailStreak = 0;
  } else {
    if (item.item_type === '전념의룬') {
      newDestroyed = 1;
      destroyedReason = `강화 ${item.enhance_level} → ${item.enhance_level + 1} 실패`;
    } else {
      newFailStreak = item.enhance_fail_streak + 1;
    }
  }

  try {
    db.prepare(`
      UPDATE inventory
      SET enhance_level = ?,
          enhance_fail_streak = ?,
          destroyed = ?,
          destroyed_reason = ?,
          total_kinah_used = total_kinah_used + ?,
          total_enhance_stones_used = total_enhance_stones_used + ?,
          updated_at = ?
      WHERE id = ?
    `).run(newLevel, newFailStreak, newDestroyed, destroyedReason, step.kinah, step.stones, now, item.id);
  } catch (err) {
    console.error('[강화] DB 오류:', err);
    return interaction.editReply({ content: '❌ 강화 처리 중 오류가 발생했습니다.' });
  }

  // 응답 임베드
  const isRune = item.item_type === '전념의룬';
  const embed = new EmbedBuilder()
    .setColor(success ? 0x00b894 : 0xd63031)
    .setTitle(success
      ? `✨ 강화 성공! [${item.item_type}] ${item.item_name}`
      : (isRune ? `💥 강화 실패 — 장비 파괴 [${item.item_type}] ${item.item_name}`
                : `❌ 강화 실패 [${item.item_type}] ${item.item_name}`))
    .addFields(
      { name: '🆔 장비',         value: `#${item.id}`,                                  inline: true },
      { name: '⚒️ 강화 등급',   value: `${item.enhance_level} → **${newLevel}**`,      inline: true },
      { name: '🎯 적용 확률',    value: `${effectiveProb.toFixed(2)}%`,                  inline: true },
      { name: '💰 이번 사용 키나', value: `${formatNumber(step.kinah)}`,                inline: true },
      { name: '💎 이번 사용 강화석', value: `${formatNumber(step.stones)} 개`,          inline: true },
    );

  if (!success && !isRune) {
    embed.addFields({
      name: '📈 누적 보정',
      value: `실패 ${newFailStreak}회 → 다음 시도 시 +${(failBoost * newFailStreak).toFixed(2)}%p`,
      inline: false,
    });
  }
  if (newDestroyed) {
    embed.addFields({ name: '💀 상태', value: '장비가 파괴되어 더 이상 사용할 수 없습니다.', inline: false });
  }
  if (success && item.item_type === '영웅' && newLevel >= MAX_HERO_ENHANCE) {
    embed.addFields({ name: '🎊 만렙 도달!', value: '강화 20강 도달! 이제 `/돌파` 로 진행하세요.', inline: false });
  }

  embed.setFooter({ text: `소유자: ${interaction.user.tag}` }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

// ──────────────────────────────────────────────────────────
// /돌파
// ──────────────────────────────────────────────────────────

async function handleBreakthrough(interaction) {
  await interaction.deferReply({ ephemeral: false });

  const db      = getDb();
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;
  const itemId  = interaction.options.getInteger('장비id');

  const item = getItem(db, itemId, guildId);
  if (!item)                   return interaction.editReply({ content: `❌ 장비 #${itemId} 를 찾을 수 없습니다.` });
  if (item.user_id !== userId)  return interaction.editReply({ content: '⛔ 본인 소유의 장비만 돌파할 수 있습니다.' });
  if (item.destroyed)           return interaction.editReply({ content: `💀 파괴된 장비입니다. (#${item.id} ${item.item_name})` });

  if (item.item_type !== '영웅') {
    return interaction.editReply({ content: '❌ 돌파는 영웅 장비만 가능합니다. (전념의룬은 돌파 없음)' });
  }
  if (item.enhance_level < MAX_HERO_ENHANCE) {
    return interaction.editReply({
      content: `❌ 강화 ${MAX_HERO_ENHANCE}강 도달 후에만 돌파 가능합니다. (현재 강화 ${item.enhance_level}강)`,
    });
  }
  if (item.breakthrough_level >= MAX_HERO_BREAKTHROUGH) {
    return interaction.editReply({
      content: `🏆 이미 돌파 ${MAX_HERO_BREAKTHROUGH} 만렙입니다!`,
    });
  }

  const step = getHeroBreakthroughStep(item.breakthrough_level);
  if (!step) return interaction.editReply({ content: '❌ 돌파 데이터를 찾을 수 없습니다.' });

  const failBoost = step.fail_boost ?? 0;
  const effectiveProb = Math.min(100, step.prob + (item.breakthrough_fail_streak * failBoost));
  const success = rollSuccess(effectiveProb);

  const now = new Date().toISOString();
  let newLevel       = item.breakthrough_level;
  let newFailStreak  = item.breakthrough_fail_streak;

  if (success) {
    newLevel = item.breakthrough_level + 1;
    newFailStreak = 0;
  } else {
    newFailStreak = item.breakthrough_fail_streak + 1;
    // 영웅 장비는 돌파 실패해도 파괴되지 않음 (사용자 요구사항)
  }

  try {
    db.prepare(`
      UPDATE inventory
      SET breakthrough_level = ?,
          breakthrough_fail_streak = ?,
          total_kinah_used = total_kinah_used + ?,
          total_breakthrough_stones_used = total_breakthrough_stones_used + ?,
          updated_at = ?
      WHERE id = ?
    `).run(newLevel, newFailStreak, step.kinah, step.stones, now, item.id);
  } catch (err) {
    console.error('[돌파] DB 오류:', err);
    return interaction.editReply({ content: '❌ 돌파 처리 중 오류가 발생했습니다.' });
  }

  const embed = new EmbedBuilder()
    .setColor(success ? 0xfdcb6e : 0xd63031)
    .setTitle(success
      ? `🌟 돌파 성공! [영웅] ${item.item_name}`
      : `❌ 돌파 실패 [영웅] ${item.item_name}`)
    .addFields(
      { name: '🆔 장비',          value: `#${item.id}`,                                inline: true },
      { name: '💥 돌파 등급',     value: `${item.breakthrough_level} → **${newLevel}**`, inline: true },
      { name: '🎯 적용 확률',     value: `${effectiveProb.toFixed(2)}%`,                inline: true },
      { name: '💰 이번 사용 키나',   value: `${formatNumber(step.kinah)}`,            inline: true },
      { name: '💎 이번 사용 돌파석', value: `${formatNumber(step.stones)} 개`,        inline: true },
    );

  if (!success) {
    embed.addFields({
      name: '📈 누적 보정',
      value: `실패 ${newFailStreak}회 → 다음 시도 시 +${(failBoost * newFailStreak).toFixed(2)}%p`,
      inline: false,
    });
  }
  if (success && newLevel >= MAX_HERO_BREAKTHROUGH) {
    embed.addFields({ name: '🎊 만렙 도달!', value: '돌파 5 완성! 축하합니다!', inline: false });
  }

  embed.setFooter({ text: `소유자: ${interaction.user.tag}` }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

// ──────────────────────────────────────────────────────────
// interaction 라우팅
// ──────────────────────────────────────────────────────────

async function handleInventoryInteraction(interaction) {
  switch (interaction.commandName) {
    case '장비생성': await handleItemCreate(interaction);   return true;
    case '장비목록': await handleItemList(interaction);     return true;
    case '장비삭제': await handleItemDelete(interaction);   return true;
    case '강화':     await handleEnhance(interaction);      return true;
    case '돌파':     await handleBreakthrough(interaction); return true;
    default: return false;
  }
}

module.exports = { inventoryCommands, handleInventoryInteraction };
