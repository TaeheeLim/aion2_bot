'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../database');
const { MAX_HERO_ENHANCE, MAX_HERO_BREAKTHROUGH } = require('../data/enhanceData');

function fmt(n) {
  return Number(n).toLocaleString('ko-KR');
}

const MEDALS = ['🥇', '🥈', '🥉'];
function medal(i) {
  return MEDALS[i] ?? `\`${i + 1}.\``;
}

const rankingCommands = [
  new SlashCommandBuilder()
    .setName('강화랭킹')
    .setDescription('이 서버의 강화 명예의 전당 — 키나왕 · 최고 강화 · 파괴왕을 보여줍니다.'),
];

// ──────────────────────────────────────────────────────────
// 핸들러
// ──────────────────────────────────────────────────────────

async function handleRankingShow(interaction) {
  await interaction.deferReply();

  const db = getDb();
  const guildId = interaction.guildId;

  let topKinah, topEnhance, topDestroyed, maxedHero, runeMax;
  try {
    // 1) 키나왕 — 사용자별 누적 키나 합계
    topKinah = db.prepare(`
      SELECT user_id, SUM(total_kinah_used) AS total
      FROM inventory WHERE guild_id = ?
      GROUP BY user_id HAVING total > 0
      ORDER BY total DESC LIMIT 5
    `).all(guildId);

    // 2) 최고 강화 장비 (영웅: 강화*100+돌파 가중치로 정렬, 룬: 강화)
    topEnhance = db.prepare(`
      SELECT user_id, item_name, item_type, enhance_level, breakthrough_level
      FROM inventory
      WHERE guild_id = ? AND destroyed = 0
      ORDER BY (CASE WHEN item_type='영웅' THEN enhance_level*100 + breakthrough_level*20 ELSE enhance_level*100 END) DESC,
               enhance_level DESC
      LIMIT 5
    `).all(guildId);

    // 3) 파괴왕 (불운왕) — 사용자별 파괴 장비 수
    topDestroyed = db.prepare(`
      SELECT user_id, COUNT(*) AS cnt
      FROM inventory WHERE guild_id = ? AND destroyed = 1
      GROUP BY user_id ORDER BY cnt DESC LIMIT 3
    `).all(guildId);

    // 4) 영웅 만렙(20강) 달성자 수 / 돌파5 달성 수
    maxedHero = db.prepare(`
      SELECT
        SUM(CASE WHEN item_type='영웅' AND enhance_level >= ? THEN 1 ELSE 0 END) AS maxEnh,
        SUM(CASE WHEN item_type='영웅' AND breakthrough_level >= ? THEN 1 ELSE 0 END) AS maxBrk
      FROM inventory WHERE guild_id = ? AND destroyed = 0
    `).get(MAX_HERO_ENHANCE, MAX_HERO_BREAKTHROUGH, guildId);

    runeMax = db.prepare(`
      SELECT COUNT(*) AS cnt FROM inventory
      WHERE guild_id = ? AND item_type='전념의룬' AND destroyed = 0 AND enhance_level >= 10
    `).get(guildId);
  } catch (err) {
    console.error('[강화랭킹] DB 오류:', err);
    return interaction.editReply({ content: '❌ 랭킹 집계 중 오류가 발생했습니다.' });
  }

  if (!topKinah.length && !topEnhance.length) {
    return interaction.editReply({ content: '📭 아직 강화 기록이 없습니다. `/장비생성` 후 `/강화` 로 도전해보세요!' });
  }

  const kinahText = topKinah.length
    ? topKinah.map((r, i) => `${medal(i)} <@${r.user_id}> — **${fmt(r.total)}** 키나`).join('\n')
    : '_기록 없음_';

  const enhanceText = topEnhance.length
    ? topEnhance.map((r, i) => {
        const lv = r.item_type === '영웅'
          ? `강화 ${r.enhance_level}강 / 돌파 ${r.breakthrough_level}`
          : `강화 ${r.enhance_level}강`;
        return `${medal(i)} <@${r.user_id}> · [${r.item_type}] ${r.item_name} — **${lv}**`;
      }).join('\n')
    : '_기록 없음_';

  const destroyedText = topDestroyed.length
    ? topDestroyed.map((r, i) => `${medal(i)} <@${r.user_id}> — 💀 ${r.cnt}개 파괴`).join('\n')
    : '_아직 파괴된 장비가 없습니다. 평화롭네요._';

  const achievements = [
    `🏆 영웅 20강 달성 장비: **${maxedHero?.maxEnh ?? 0}개**`,
    `🌟 돌파 ${MAX_HERO_BREAKTHROUGH} 달성 장비: **${maxedHero?.maxBrk ?? 0}개**`,
    `🔮 전념의룬 10강 달성: **${runeMax?.cnt ?? 0}개**`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xffd166)
    .setTitle(`🏛️ ${interaction.guild?.name ?? '서버'} 강화 명예의 전당`)
    .addFields(
      { name: '💰 키나왕 (누적 소모)', value: kinahText },
      { name: '⚔️ 최강 장비', value: enhanceText },
      { name: '💀 파괴왕 (불운왕)', value: destroyedText },
      { name: '🎖️ 달성 현황', value: achievements },
    )
    .setFooter({ text: '강화/돌파 시뮬레이터 누적 기록 기준' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ──────────────────────────────────────────────────────────
// interaction 라우팅
// ──────────────────────────────────────────────────────────

async function handleRankingInteraction(interaction) {
  switch (interaction.commandName) {
    case '강화랭킹': await handleRankingShow(interaction); return true;
    default: return false;
  }
}

module.exports = { rankingCommands, handleRankingInteraction };
