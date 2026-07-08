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
const { homeworkWeekRange } = require('../utils/dateUtils');

// customId 형식: hw:<taskId>:<weekKey>
const BTN_PREFIX = 'hw';

// 길드에서 숙제 기능을 처음 쓸 때 자동 시드되는 기본 항목
const DEFAULT_TASKS = [
  { name: '시공공격',     required_count: 1 },
  { name: '시공방어',     required_count: 1 },
  { name: '전장',         required_count: 3 },
  { name: '은공물질변환', required_count: 1 },
];

const MAX_BUTTONS = 25; // Discord 한 메시지 최대 버튼 수 (5행 × 5열)

// ──────────────────────────────────────────────────────────
// 슬래시 명령어 정의
// ──────────────────────────────────────────────────────────

const homeworkCommands = [
  // /숙제 — 내 이번 주 체크리스트
  new SlashCommandBuilder()
    .setName('숙제')
    .setDescription('이번 주 내 숙제 체크리스트를 보고 버튼으로 체크합니다.'),

  // /숙제현황 — 서버 멤버별 완료 현황
  new SlashCommandBuilder()
    .setName('숙제현황')
    .setDescription('이번 주 서버 멤버들의 숙제 완료 현황을 보여줍니다.'),

  // /숙제설정 — 숙제 항목 관리 (관리자)
  new SlashCommandBuilder()
    .setName('숙제설정')
    .setDescription('숙제 항목을 관리합니다.')
    .addSubcommand(sub =>
      sub.setName('목록').setDescription('현재 등록된 숙제 항목을 봅니다.'))
    .addSubcommand(sub =>
      sub.setName('추가').setDescription('숙제 항목을 추가합니다.')
        .addStringOption(o =>
          o.setName('이름').setDescription('숙제 이름 (예: 시공공격)').setRequired(true).setMaxLength(40))
        .addIntegerOption(o =>
          o.setName('횟수').setDescription('주간 반복 횟수 (예: 전장 3). 생략 시 1')
            .setRequired(false).setMinValue(1).setMaxValue(99)))
    .addSubcommand(sub =>
      sub.setName('삭제').setDescription('숙제 항목을 삭제합니다.')
        .addIntegerOption(o =>
          o.setName('항목id').setDescription('삭제할 항목 ID (/숙제설정 목록 에서 확인)').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('수정').setDescription('숙제 항목을 수정합니다.')
        .addIntegerOption(o =>
          o.setName('항목id').setDescription('수정할 항목 ID').setRequired(true))
        .addStringOption(o =>
          o.setName('이름').setDescription('새 이름').setRequired(false).setMaxLength(40))
        .addIntegerOption(o =>
          o.setName('횟수').setDescription('새 반복 횟수').setRequired(false).setMinValue(1).setMaxValue(99))
        .addIntegerOption(o =>
          o.setName('순서').setDescription('표시 순서 (작을수록 위)').setRequired(false).setMinValue(0).setMaxValue(999))),
];

// ──────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────

function isDone(task, count) {
  return count >= task.required_count;
}

/** 길드에 기본 숙제 항목을 시드 (처음 1회). */
function seedDefaultTasks(db, guildId) {
  const insert = db.prepare(
    `INSERT INTO homework_tasks (guild_id, name, required_count, sort_order) VALUES (?, ?, ?, ?)`
  );
  db.transaction(() => {
    DEFAULT_TASKS.forEach((t, i) => insert.run(guildId, t.name, t.required_count, i));
  })();
}

/**
 * 길드의 활성 숙제 항목을 정렬 순으로 반환.
 * 한 번도 항목이 없던 길드면 기본 항목을 시드한 뒤 반환한다.
 */
function getActiveTasks(db, guildId) {
  const query = `SELECT * FROM homework_tasks WHERE guild_id = ? AND active = 1 ORDER BY sort_order ASC, id ASC`;
  let tasks = db.prepare(query).all(guildId);
  if (tasks.length === 0) {
    const total = db.prepare(`SELECT COUNT(*) AS c FROM homework_tasks WHERE guild_id = ?`).get(guildId).c;
    if (total === 0) {
      seedDefaultTasks(db, guildId);
      tasks = db.prepare(query).all(guildId);
    }
  }
  return tasks;
}

/** (사용자 × 주차) 진행도를 task_id → count 맵으로 반환. */
function getProgressMap(db, guildId, userId, weekKey) {
  const rows = db.prepare(
    `SELECT task_id, count FROM homework_progress WHERE guild_id = ? AND user_id = ? AND week_key = ?`
  ).all(guildId, userId, weekKey);
  const map = new Map();
  for (const r of rows) map.set(r.task_id, r.count);
  return map;
}

/** 체크리스트 Embed 구성. */
function renderChecklistEmbed(user, tasks, progressMap, range) {
  const lines = tasks.map(t => {
    const c    = progressMap.get(t.id) ?? 0;
    const done = isDone(t, c);
    const prog = t.required_count > 1 ? ` (${Math.min(c, t.required_count)}/${t.required_count})` : '';
    return `${done ? '✅' : '⬜'} **${t.name}**${prog}`;
  });

  const doneCount = tasks.filter(t => isDone(t, progressMap.get(t.id) ?? 0)).length;
  const allDone   = tasks.length > 0 && doneCount === tasks.length;

  return new EmbedBuilder()
    .setColor(allDone ? 0x06d6a0 : 0x48cae4)
    .setTitle(`📋 ${user.username} 님의 주간 숙제`)
    .setDescription(lines.length
      ? lines.join('\n')
      : '_등록된 숙제 항목이 없습니다. `/숙제설정 추가` 로 항목을 추가할 수 있습니다._')
    .addFields({ name: '진행도', value: `완료 **${doneCount}/${tasks.length}**${allDone ? '  🎉 전부 완료!' : ''}` })
    .setFooter({ text: `이번 주기: ${range.label} (KST) · 버튼을 눌러 체크하세요` });
}

/** 항목별 체크 버튼 행(최대 25개) 구성. */
function buildHomeworkButtons(tasks, weekKey, progressMap) {
  const rows = [];
  const capped = tasks.slice(0, MAX_BUTTONS);
  for (let i = 0; i < capped.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const t of capped.slice(i, i + 5)) {
      const c     = progressMap.get(t.id) ?? 0;
      const done  = isDone(t, c);
      const label = t.required_count > 1
        ? `${t.name} ${Math.min(c, t.required_count)}/${t.required_count}`
        : t.name;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${BTN_PREFIX}:${t.id}:${weekKey}`)
          .setLabel(label.slice(0, 80))
          .setStyle(done ? ButtonStyle.Success : ButtonStyle.Secondary),
      );
    }
    rows.push(row);
  }
  return rows;
}

// ──────────────────────────────────────────────────────────
// /숙제 — 내 체크리스트 (ephemeral)
// ──────────────────────────────────────────────────────────

async function handleMyHomework(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const db      = getDb();
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;

  try {
    const tasks       = getActiveTasks(db, guildId);
    const range       = homeworkWeekRange();
    const progressMap = getProgressMap(db, guildId, userId, range.weekKey);

    await interaction.editReply({
      embeds: [renderChecklistEmbed(interaction.user, tasks, progressMap, range)],
      components: buildHomeworkButtons(tasks, range.weekKey, progressMap),
    });
  } catch (err) {
    console.error('[숙제] DB 오류:', err);
    await interaction.editReply({ content: '❌ 숙제 조회 중 오류가 발생했습니다.' });
  }
}

// ──────────────────────────────────────────────────────────
// /숙제현황 — 서버 멤버별 완료 현황 (public)
// ──────────────────────────────────────────────────────────

async function handleHomeworkStatus(interaction) {
  await interaction.deferReply();

  const db      = getDb();
  const guildId = interaction.guildId;
  const range   = homeworkWeekRange();

  let tasks, rows;
  try {
    tasks = getActiveTasks(db, guildId);
    if (!tasks.length) {
      return interaction.editReply({ content: '📭 등록된 숙제 항목이 없습니다. `/숙제설정 추가` 로 항목을 추가하세요.' });
    }
    rows = db.prepare(
      `SELECT user_id, task_id, count FROM homework_progress WHERE guild_id = ? AND week_key = ?`
    ).all(guildId, range.weekKey);
  } catch (err) {
    console.error('[숙제현황] DB 오류:', err);
    return interaction.editReply({ content: '❌ 현황 집계 중 오류가 발생했습니다.' });
  }

  const requiredById = new Map(tasks.map(t => [t.id, t.required_count]));
  const totalTasks   = tasks.length;

  // 진행 기록이 있는 멤버별 완료 항목 수 집계 (활성 항목만)
  const doneByUser = new Map();
  for (const r of rows) {
    if (!doneByUser.has(r.user_id)) doneByUser.set(r.user_id, 0);
    const req = requiredById.get(r.task_id);
    if (req != null && r.count >= req) {
      doneByUser.set(r.user_id, doneByUser.get(r.user_id) + 1);
    }
  }

  if (doneByUser.size === 0) {
    return interaction.editReply({ content: `📭 이번 주기(${range.label}) 아직 숙제를 진행한 멤버가 없습니다.` });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const sorted = [...doneByUser.entries()].sort((a, b) => b[1] - a[1]);
  const lines  = sorted.slice(0, 20).map(([uid, done], i) => {
    const full = done === totalTasks;
    const tag  = full ? '🏆' : (medals[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``);
    return `${tag} <@${uid}> — **${done}/${totalTasks}**${full ? ' 완료!' : ''}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x00cec9)
    .setTitle(`📊 ${interaction.guild?.name ?? '서버'} 주간 숙제 현황`)
    .setDescription(`이번 주기: **${range.label}** (KST)\n전체 숙제 **${totalTasks}종** 기준`)
    .addFields({ name: '🏅 멤버별 완료', value: lines.join('\n') })
    .setFooter({ text: '숙제를 한 번이라도 진행한 멤버만 표시됩니다' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ──────────────────────────────────────────────────────────
// /숙제설정 — 항목 관리 (서브커맨드)
// ──────────────────────────────────────────────────────────

async function handleHomeworkConfig(interaction) {
  const sub     = interaction.options.getSubcommand();
  const db      = getDb();
  const guildId = interaction.guildId;

  // 목록: 누구나 조회 가능 (읽기 전용)
  if (sub === '목록') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const tasks = getActiveTasks(db, guildId);
    if (!tasks.length) {
      return interaction.editReply({ content: '📭 등록된 숙제 항목이 없습니다. `/숙제설정 추가` 로 추가하세요.' });
    }
    const lines = tasks.map(t =>
      `\`#${t.id}\` **${t.name}** — ${t.required_count > 1 ? `${t.required_count}회` : '1회'} · 순서 ${t.sort_order}`
    );
    const embed = new EmbedBuilder()
      .setColor(0x48cae4)
      .setTitle('🧾 숙제 항목 목록')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `총 ${tasks.length}개` });
    return interaction.editReply({ embeds: [embed] });
  }

  // 추가/삭제/수정: 모든 멤버 가능
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (sub === '추가') {
      const name  = interaction.options.getString('이름').trim();
      const count = interaction.options.getInteger('횟수') ?? 1;
      if (!name) return interaction.editReply({ content: '❌ 이름을 입력해주세요.' });

      const maxOrder = db.prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m FROM homework_tasks WHERE guild_id = ?`
      ).get(guildId).m;
      const res = db.prepare(
        `INSERT INTO homework_tasks (guild_id, name, required_count, sort_order) VALUES (?, ?, ?, ?)`
      ).run(guildId, name, count, maxOrder + 1);
      return interaction.editReply({ content: `✅ 숙제 **${name}** (${count}회) 추가 완료. (ID #${res.lastInsertRowid})` });
    }

    if (sub === '삭제') {
      const id = interaction.options.getInteger('항목id');
      const t  = db.prepare(`SELECT * FROM homework_tasks WHERE id = ? AND guild_id = ?`).get(id, guildId);
      if (!t) return interaction.editReply({ content: `❌ 항목 #${id} 를 찾을 수 없습니다.` });
      db.prepare(`DELETE FROM homework_tasks WHERE id = ?`).run(id);
      return interaction.editReply({ content: `🗑️ 숙제 **#${id} ${t.name}** 삭제 완료.` });
    }

    if (sub === '수정') {
      const id    = interaction.options.getInteger('항목id');
      const name  = interaction.options.getString('이름');
      const count = interaction.options.getInteger('횟수');
      const order = interaction.options.getInteger('순서');
      const t     = db.prepare(`SELECT * FROM homework_tasks WHERE id = ? AND guild_id = ?`).get(id, guildId);
      if (!t) return interaction.editReply({ content: `❌ 항목 #${id} 를 찾을 수 없습니다.` });
      if (name == null && count == null && order == null) {
        return interaction.editReply({ content: '❌ 변경할 값(이름/횟수/순서) 중 하나 이상을 입력하세요.' });
      }
      const newName  = name  != null ? name.trim() : t.name;
      const newCount = count != null ? count       : t.required_count;
      const newOrder = order != null ? order       : t.sort_order;
      db.prepare(`UPDATE homework_tasks SET name = ?, required_count = ?, sort_order = ? WHERE id = ?`)
        .run(newName, newCount, newOrder, id);
      return interaction.editReply({ content: `✏️ 숙제 **#${id}** 수정 완료 → **${newName}** (${newCount}회, 순서 ${newOrder})` });
    }
  } catch (err) {
    console.error('[숙제설정] DB 오류:', err);
    return interaction.editReply({ content: '❌ 숙제 항목 처리 중 오류가 발생했습니다.' });
  }
}

// ──────────────────────────────────────────────────────────
// 버튼 인터랙션 (index.js 에서 호출)
// ──────────────────────────────────────────────────────────

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} 이 모듈이 처리했는지
 */
async function handleHomeworkButton(interaction) {
  if (!interaction.customId?.startsWith(`${BTN_PREFIX}:`)) return false;

  const [, taskIdStr, weekKey] = interaction.customId.split(':');
  const taskId = Number(taskIdStr);
  if (!Number.isInteger(taskId)) {
    await interaction.reply({ content: '❌ 잘못된 버튼입니다.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const db      = getDb();
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;
  const range   = homeworkWeekRange();

  // 주가 바뀐 체크리스트의 버튼이면 과거 주에 기록되지 않도록 차단
  if (weekKey !== range.weekKey) {
    await interaction.reply({
      content: '🔄 새로운 주가 시작되어 이 체크리스트는 만료되었습니다. `/숙제` 를 다시 실행해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const task = db.prepare(`SELECT * FROM homework_tasks WHERE id = ? AND guild_id = ? AND active = 1`).get(taskId, guildId);
  if (!task) {
    await interaction.reply({
      content: '❌ 삭제되었거나 비활성화된 숙제 항목입니다. `/숙제` 를 다시 실행해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  try {
    const cur   = db.prepare(
      `SELECT count FROM homework_progress WHERE guild_id = ? AND user_id = ? AND week_key = ? AND task_id = ?`
    ).get(guildId, userId, range.weekKey, taskId);
    const count = cur?.count ?? 0;

    let newCount;
    if (task.required_count > 1) {
      newCount = count + 1;
      if (newCount > task.required_count) newCount = 0; // 초과 시 0으로 리셋 (오클릭 복구)
    } else {
      newCount = count >= 1 ? 0 : 1;                    // 토글
    }

    db.prepare(`
      INSERT INTO homework_progress (guild_id, user_id, week_key, task_id, count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id, week_key, task_id)
      DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at
    `).run(guildId, userId, range.weekKey, taskId, newCount, new Date().toISOString());
  } catch (err) {
    console.error('[숙제] 버튼 저장 오류:', err);
    await interaction.reply({ content: '❌ 처리 중 오류가 발생했습니다.', flags: MessageFlags.Ephemeral });
    return true;
  }

  // 갱신된 체크리스트로 메시지 업데이트
  try {
    const tasks       = getActiveTasks(db, guildId);
    const progressMap = getProgressMap(db, guildId, userId, range.weekKey);
    await interaction.update({
      embeds: [renderChecklistEmbed(interaction.user, tasks, progressMap, range)],
      components: buildHomeworkButtons(tasks, range.weekKey, progressMap),
    });
  } catch (err) {
    console.warn('[숙제] 메시지 갱신 실패(무시):', err.message);
  }
  return true;
}

// ──────────────────────────────────────────────────────────
// interaction 라우팅 (슬래시)
// ──────────────────────────────────────────────────────────

async function handleHomeworkInteraction(interaction) {
  switch (interaction.commandName) {
    case '숙제':     await handleMyHomework(interaction);    return true;
    case '숙제현황': await handleHomeworkStatus(interaction); return true;
    case '숙제설정': await handleHomeworkConfig(interaction); return true;
    default: return false;
  }
}

module.exports = {
  homeworkCommands,
  handleHomeworkInteraction,
  handleHomeworkButton,
};
