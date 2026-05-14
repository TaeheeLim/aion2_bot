'use strict';

const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  PermissionsBitField,
} = require('discord.js');
const { playTTSInChannel } = require('../utils/ttsPlayer');

// ──────────────────────────────────────────────────────────
// 슬래시 명령어 정의
// ──────────────────────────────────────────────────────────

const ttsCommands = [
  new SlashCommandBuilder()
    .setName('tts테스트')
    .setDescription('현재 음성 채널에서 TTS를 즉시 재생하여 동작을 확인합니다.')
    .addStringOption(opt =>
      opt.setName('텍스트')
        .setDescription('읽어줄 텍스트 (생략 시 기본 문구)')
        .setRequired(false)
    )
    .addChannelOption(opt =>
      opt.setName('음성채널')
        .setDescription('재생할 음성 채널 (생략 시 내가 입장한 채널)')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(false)
    ),
];

// ──────────────────────────────────────────────────────────
// 핸들러
// ──────────────────────────────────────────────────────────

async function handleTtsTest(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const text = (interaction.options.getString('텍스트') ?? 'TTS 테스트입니다. 잘 들리시나요?').trim();

  const channelOpt = interaction.options.getChannel('음성채널');
  const userVoice  = interaction.member?.voice?.channel ?? null;
  const voiceChannel = channelOpt ?? userVoice;

  if (!voiceChannel) {
    return interaction.editReply({
      content: '❌ 음성 채널을 지정하거나, 먼저 음성 채널에 직접 입장해주세요.',
    });
  }

  // 권한 사전 점검
  const me = await voiceChannel.guild.members.fetchMe();
  const perms = voiceChannel.permissionsFor(me);
  const required = [
    { flag: PermissionsBitField.Flags.ViewChannel, name: '채널 보기' },
    { flag: PermissionsBitField.Flags.Connect,     name: '연결' },
    { flag: PermissionsBitField.Flags.Speak,       name: '말하기' },
  ];
  const missing = required.filter(r => !perms?.has(r.flag)).map(r => r.name);
  if (missing.length) {
    return interaction.editReply({
      content: `❌ 봇 권한 부족 (${voiceChannel.name}): **${missing.join(', ')}**`,
    });
  }

  await interaction.editReply({
    content: `🔊 <#${voiceChannel.id}> 에서 TTS 재생 시도 중...\n📝 "${text}"`,
  });

  try {
    await playTTSInChannel(voiceChannel, text);
    await interaction.editReply({
      content: `✅ <#${voiceChannel.id}> 재생 완료\n📝 "${text}"\n(소리가 안 들렸다면 콘솔 로그의 [TTS] 항목을 확인하세요.)`,
    });
  } catch (err) {
    console.error('[tts테스트] 실패:', err);
    await interaction.editReply({
      content: `❌ TTS 재생 실패: \`${err.message ?? err}\``,
    });
  }
}

// ──────────────────────────────────────────────────────────
// interaction 라우팅
// ──────────────────────────────────────────────────────────

async function handleTtsInteraction(interaction) {
  switch (interaction.commandName) {
    case 'tts테스트': await handleTtsTest(interaction); return true;
    default: return false;
  }
}

module.exports = { ttsCommands, handleTtsInteraction };
