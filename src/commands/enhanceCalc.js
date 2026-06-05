'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  expectedHeroEnhance,
  expectedHeroBreakthrough,
  simulateMany,
  getRuneEnhanceStep,
  MAX_HERO_ENHANCE,
  MAX_HERO_BREAKTHROUGH,
  MAX_RUNE_ENHANCE,
} = require('../data/enhanceData');

const SIM_MAX_TRIALS = 100000;
const SIM_DEFAULT_TRIALS = 10000;

function fmt(n) {
  return Number(Math.round(n)).toLocaleString('ko-KR');
}

// ──────────────────────────────────────────────────────────
// 슬래시 명령어 정의
// ──────────────────────────────────────────────────────────

const enhanceCalcCommands = [
  // /강화계산
  new SlashCommandBuilder()
    .setName('강화계산')
    .setDescription('목표 등급까지의 기대 비용(평균 시도·키나·재료)을 계산합니다.')
    .addStringOption(opt =>
      opt.setName('종류').setDescription('아이템 종류').setRequired(true)
        .addChoices({ name: '영웅', value: '영웅' }, { name: '전념의룬', value: '전념의룬' }))
    .addIntegerOption(opt =>
      opt.setName('목표강화').setDescription('목표 강화 등급 (영웅 2~20 / 전념의룬 2~10)')
        .setRequired(true).setMinValue(2).setMaxValue(20))
    .addIntegerOption(opt =>
      opt.setName('목표돌파').setDescription('목표 돌파 등급 (영웅 전용, 1~5). 지정 시 강화는 20강 기준')
        .setRequired(false).setMinValue(1).setMaxValue(5)),

  // /강화시뮬
  new SlashCommandBuilder()
    .setName('강화시뮬')
    .setDescription('몬테카를로 시뮬레이션으로 목표까지 비용 분포(최소/평균/최악)를 확인합니다.')
    .addStringOption(opt =>
      opt.setName('종류').setDescription('아이템 종류').setRequired(true)
        .addChoices({ name: '영웅', value: '영웅' }, { name: '전념의룬', value: '전념의룬' }))
    .addIntegerOption(opt =>
      opt.setName('목표강화').setDescription('목표 강화 등급 (영웅 2~20 / 전념의룬 2~10)')
        .setRequired(true).setMinValue(2).setMaxValue(20))
    .addIntegerOption(opt =>
      opt.setName('목표돌파').setDescription('목표 돌파 등급 (영웅 전용, 1~5)')
        .setRequired(false).setMinValue(1).setMaxValue(5))
    .addIntegerOption(opt =>
      opt.setName('횟수').setDescription(`시뮬 횟수 (기본 ${SIM_DEFAULT_TRIALS}, 최대 ${SIM_MAX_TRIALS})`)
        .setRequired(false).setMinValue(100).setMaxValue(SIM_MAX_TRIALS)),
];

// ──────────────────────────────────────────────────────────
// 입력 정규화/검증 공통
// ──────────────────────────────────────────────────────────

function resolveTargets(type, targetEnhance, targetBreakthrough) {
  if (type === '전념의룬') {
    if (targetEnhance < 2 || targetEnhance > MAX_RUNE_ENHANCE) {
      return { error: `❌ 전념의룬 목표 강화는 2~${MAX_RUNE_ENHANCE} 사이여야 합니다.` };
    }
    return { type, targetEnhance, targetBreakthrough: 0 };
  }
  // 영웅
  if (targetEnhance < 2 || targetEnhance > MAX_HERO_ENHANCE) {
    return { error: `❌ 영웅 목표 강화는 2~${MAX_HERO_ENHANCE} 사이여야 합니다.` };
  }
  let be = targetEnhance;
  if (targetBreakthrough && targetBreakthrough > 0) {
    be = MAX_HERO_ENHANCE; // 돌파하려면 20강이 전제
  }
  return { type, targetEnhance: be, targetBreakthrough: targetBreakthrough ?? 0 };
}

// ──────────────────────────────────────────────────────────
// /강화계산
// ──────────────────────────────────────────────────────────

async function handleEnhanceCalc(interaction) {
  await interaction.deferReply();

  const type = interaction.options.getString('종류');
  const t = resolveTargets(type, interaction.options.getInteger('목표강화'), interaction.options.getInteger('목표돌파'));
  if (t.error) return interaction.editReply({ content: t.error });

  if (type === '전념의룬') {
    // 파괴 메커니즘 때문에 EV(기대 비용)는 정의가 모호 → 도달 확률을 계산해 안내
    let prob = 1;
    for (let lv = 1; lv < t.targetEnhance; lv++) prob *= getRuneEnhanceStep(lv).prob / 100;
    const sim = simulateMany('전념의룬', t.targetEnhance, 0, 20000);

    const embed = new EmbedBuilder()
      .setColor(0xa29bfe)
      .setTitle(`📐 강화 계산 — [전념의룬] 목표 ${t.targetEnhance}강`)
      .setDescription('전념의룬은 **실패 시 즉시 파괴**되어 기대 비용이 정의되지 않습니다. 대신 도달 확률을 표시합니다.')
      .addFields(
        { name: '🎯 1회차 도달 확률', value: `**${(prob * 100).toFixed(4)}%**`, inline: true },
        { name: '🧪 시뮬 도달률(2만회)', value: `**${(sim.successRate * 100).toFixed(2)}%**`, inline: true },
        { name: '💀 파괴율', value: `${(sim.destroyedRate * 100).toFixed(2)}%`, inline: true },
        { name: '💡 참고', value: '실제 평균 소모 재료는 `/강화시뮬` 로 분포까지 확인하세요.' },
      )
      .setFooter({ text: `요청: ${interaction.user.tag}` })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  }

  // 영웅
  const enh = expectedHeroEnhance(t.targetEnhance);
  const brk = t.targetBreakthrough > 0 ? expectedHeroBreakthrough(t.targetBreakthrough) : { attempts: 0, kinah: 0, stones: 0 };
  const totalKinah = enh.kinah + brk.kinah;

  const targetLabel = t.targetBreakthrough > 0
    ? `강화 ${MAX_HERO_ENHANCE}강 + 돌파 ${t.targetBreakthrough}`
    : `강화 ${t.targetEnhance}강`;

  const embed = new EmbedBuilder()
    .setColor(0x74b9ff)
    .setTitle(`📐 강화 기대 비용 — [영웅] ${targetLabel}`)
    .setDescription('1강/돌파0 부터 목표까지 도달하는 데 필요한 **평균(기댓값)** 입니다. 보정(실패 누적) 효과가 반영되어 있습니다.')
    .addFields(
      { name: '⚒️ 강화 기대 시도', value: `**${enh.attempts.toFixed(1)}회**`, inline: true },
      { name: '💰 강화 기대 키나', value: fmt(enh.kinah), inline: true },
      { name: '💎 강화 기대 강화석', value: `${fmt(enh.stones)} 개`, inline: true },
    );

  if (t.targetBreakthrough > 0) {
    embed.addFields(
      { name: '💥 돌파 기대 시도', value: `**${brk.attempts.toFixed(1)}회**`, inline: true },
      { name: '💰 돌파 기대 키나', value: fmt(brk.kinah), inline: true },
      { name: '💠 돌파 기대 돌파석', value: `${fmt(brk.stones)} 개`, inline: true },
    );
  }

  embed.addFields({ name: '🧮 총 기대 키나', value: `**${fmt(totalKinah)}**`, inline: false });
  embed.addFields({ name: '💡 참고', value: '평균값입니다. 운에 따른 편차(최악/최선)는 `/강화시뮬` 로 확인하세요.' });
  embed.setFooter({ text: `요청: ${interaction.user.tag}` }).setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ──────────────────────────────────────────────────────────
// /강화시뮬
// ──────────────────────────────────────────────────────────

async function handleEnhanceSim(interaction) {
  await interaction.deferReply();

  const type = interaction.options.getString('종류');
  const t = resolveTargets(type, interaction.options.getInteger('목표강화'), interaction.options.getInteger('목표돌파'));
  if (t.error) return interaction.editReply({ content: t.error });

  const trials = interaction.options.getInteger('횟수') ?? SIM_DEFAULT_TRIALS;
  const sim = simulateMany(t.type, t.targetEnhance, t.targetBreakthrough, trials);

  const targetLabel = (type === '영웅' && t.targetBreakthrough > 0)
    ? `강화 ${MAX_HERO_ENHANCE}강 + 돌파 ${t.targetBreakthrough}`
    : `강화 ${t.targetEnhance}강`;

  const embed = new EmbedBuilder()
    .setColor(0x55efc4)
    .setTitle(`🧪 강화 시뮬 — [${type}] ${targetLabel}`)
    .setDescription(`1강/돌파0 부터 목표까지 **${fmt(trials)}회** 시뮬레이션한 결과입니다.`)
    .addFields(
      { name: '🎲 평균 시도', value: `${sim.avgAttempts.toFixed(1)}회`, inline: true },
      { name: '💰 평균 소모 키나', value: fmt(sim.avg.kinah), inline: true },
      { name: '💎 평균 강화석', value: `${fmt(sim.avg.enhanceStones)} 개`, inline: true },
    );

  if (type === '영웅') {
    if (t.targetBreakthrough > 0) {
      embed.addFields({ name: '💠 평균 돌파석', value: `${fmt(sim.avg.breakthroughStones)} 개`, inline: true });
    }
    if (sim.success) {
      embed.addFields(
        { name: '🍀 최선(최소 키나)', value: fmt(sim.success.minKinah), inline: true },
        { name: '📊 중앙값 키나', value: fmt(sim.success.medianKinah), inline: true },
        { name: '😱 상위 5% (불운)', value: fmt(sim.success.p95Kinah), inline: true },
        { name: '💀 최악(최대 키나)', value: fmt(sim.success.maxKinah), inline: true },
      );
    }
  } else {
    // 전념의룬: 파괴 통계가 핵심
    embed.addFields(
      { name: '✅ 목표 도달률', value: `**${(sim.successRate * 100).toFixed(2)}%**`, inline: true },
      { name: '💀 파괴율', value: `${(sim.destroyedRate * 100).toFixed(2)}%`, inline: true },
    );
    if (sim.success) {
      embed.addFields(
        { name: '🍀 성공 시 최소 키나', value: fmt(sim.success.minKinah), inline: true },
        { name: '📊 성공 시 중앙값', value: fmt(sim.success.medianKinah), inline: true },
      );
    } else {
      embed.addFields({ name: '⚠️ 결과', value: '시뮬 동안 목표 도달 사례가 없을 만큼 확률이 낮습니다. 목표를 낮춰보세요.' });
    }
  }

  embed.setFooter({ text: `요청: ${interaction.user.tag} · 결과는 매번 달라질 수 있습니다` }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

// ──────────────────────────────────────────────────────────
// interaction 라우팅
// ──────────────────────────────────────────────────────────

async function handleEnhanceCalcInteraction(interaction) {
  switch (interaction.commandName) {
    case '강화계산': await handleEnhanceCalc(interaction); return true;
    case '강화시뮬': await handleEnhanceSim(interaction);  return true;
    default: return false;
  }
}

module.exports = { enhanceCalcCommands, handleEnhanceCalcInteraction };
