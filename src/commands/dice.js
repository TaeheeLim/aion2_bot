'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// ──────────────────────────────────────────────────────────
// 슬래시 명령어 정의
// ──────────────────────────────────────────────────────────

const diceCommands = [
  new SlashCommandBuilder()
    .setName('주사위')
    .setDescription('1부터 입력한 숫자 사이의 랜덤 정수를 출력합니다.')
    .addIntegerOption(opt =>
      opt.setName('최대값')
        .setDescription('주사위 최대 숫자 (예: 20 → 1~20 사이)')
        .setMinValue(2)
        .setMaxValue(1000000)
        .setRequired(true)
    ),
];

// ──────────────────────────────────────────────────────────
// 핸들러
// ──────────────────────────────────────────────────────────

async function handleDiceRoll(interaction) {
  const max = interaction.options.getInteger('최대값');
  const roll = Math.floor(Math.random() * max) + 1;

  const embed = new EmbedBuilder()
    .setColor(0xf4a261)
    .setTitle(`🎲 ${interaction.user.username} 님의 주사위`)
    .setDescription(`**1 ~ ${max}** 사이 → **${roll}**`)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// ──────────────────────────────────────────────────────────
// interaction 라우팅
// ──────────────────────────────────────────────────────────

async function handleDiceInteraction(interaction) {
  switch (interaction.commandName) {
    case '주사위': await handleDiceRoll(interaction); return true;
    default: return false;
  }
}

module.exports = { diceCommands, handleDiceInteraction };
