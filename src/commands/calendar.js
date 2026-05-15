'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../database');
const {
  formatKST,
  monthKSTRange,
  currentKSTYearMonth,
  kstDayOfMonth,
} = require('../utils/dateUtils');

// ──────────────────────────────────────────────────────────
// 슬래시 명령어 정의
// ──────────────────────────────────────────────────────────

const calendarCommands = [
  new SlashCommandBuilder()
    .setName('달력')
    .setDescription('등록된 레기온 일정을 월간 달력으로 보여줍니다. (기본: 이번 달 KST)')
    .addIntegerOption(opt =>
      opt.setName('연도')
        .setDescription('연도 (생략 시 이번 해)')
        .setMinValue(2024)
        .setMaxValue(2099)
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('월')
        .setDescription('월 (1~12, 생략 시 이번 달)')
        .setMinValue(1)
        .setMaxValue(12)
        .setRequired(false)
    ),
];

// ──────────────────────────────────────────────────────────
// ANSI 달력 빌더 (Discord ```ansi 코드블록)
// ──────────────────────────────────────────────────────────

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ANSI 헬퍼 — Discord ansi 코드블록 색상 코드
const ESC   = '\x1b';
const RESET = `${ESC}[0m`;
const C = (code, text) => `${ESC}[${code}m${text}${RESET}`;

const C_TITLE     = '1;36';   // bold cyan
const C_SUNDAY    = '31';     // red
const C_SATURDAY  = '34';     // blue
const C_SCHEDULE  = '1;33';   // bold yellow — 일정 있는 날
const C_TODAY_BG  = '1;30;43';// bold + black text + yellow bg — 오늘
const C_BORDER    = '36';     // cyan

/**
 * 한 셀(가시 폭 4) 렌더링. ANSI 코드가 들어가도 모노스페이스 가시폭은 4 유지.
 */
function renderCell(d, hasSchedule, isToday, weekday) {
  const dStr = String(d).padStart(2, ' ');         // 2글자
  if (isToday)       return C(C_TODAY_BG, `▸${dStr}◂`);  // 4글자 강조
  if (hasSchedule)   return ` ${C(C_SCHEDULE, dStr)}●`;  // 4글자 + ● 마커
  if (weekday === 0) return ` ${C(C_SUNDAY,   dStr)} `;
  if (weekday === 6) return ` ${C(C_SATURDAY, dStr)} `;
  return ` ${dStr} `;
}

/**
 * 월간 달력을 ANSI 가 입혀진 텍스트 블록으로 렌더.
 *
 * 가시 폭 설계:
 *   - 셀: 4 visual columns (한글 폭 고려 안 해도 됨 — 셀은 ASCII만)
 *   - 요일 헤더: ` 일 ` 처럼 한글(2폭) 양옆 공백 1자 → 4 visual columns
 *   - 7열 × 4 = 28 visual columns
 *
 * @param {number} year
 * @param {number} month
 * @param {Set<number>} markedDays
 * @param {number|null} todayDay - 같은 달일 때만 강조
 */
function renderAnsiCalendar(year, month, markedDays, todayDay) {
  const firstDay  = new Date(year, month - 1, 1);
  const startWday = firstDay.getDay();
  const lastDate  = new Date(year, month, 0).getDate();

  // 박스 폭(가시) = 28 + 좌우 보더 2 = 30
  const top    = C(C_BORDER, '╔════════════════════════════╗');
  const mid    = C(C_BORDER, '╠════════════════════════════╣');
  const bottom = C(C_BORDER, '╚════════════════════════════╝');
  const border = C(C_BORDER, '║');

  // 제목 — 박스 내 28-width 중앙정렬
  const titleText = `${year}년 ${month}월`;
  // titleText 가시 폭: 한글(2) × 2 + " " + 숫자/월 = 가변. 그냥 padEnd 로 대충 맞추되 표시에 큰 문제 없음.
  // 여기서는 단순히 양옆 공백으로 채워 28폭에 가깝게.
  const titlePadded = padCenterVisual(titleText, 28);
  const titleLine   = `${border}${C(C_TITLE, titlePadded)}${border}`;

  // 요일 헤더
  const wdayCells = WEEKDAYS.map((w, i) => {
    const cell = ` ${w} `; // 1공백 + 한글(2폭) + 1공백 = 4 visual width
    if (i === 0) return C(C_SUNDAY,   cell);
    if (i === 6) return C(C_SATURDAY, cell);
    return cell;
  }).join('');
  const wdayLine = `${border}${wdayCells}${border}`;

  // 본문(주 단위)
  const rows = [];
  let row = '';

  // 첫 주 앞 빈 셀
  for (let i = 0; i < startWday; i++) row += '    ';

  for (let d = 1; d <= lastDate; d++) {
    const weekday = (startWday + d - 1) % 7;
    const cell = renderCell(d, markedDays.has(d), d === todayDay, weekday);
    row += cell;

    if (weekday === 6) {
      rows.push(`${border}${row}${border}`);
      row = '';
    }
  }
  if (row.trim()) {
    // 마지막 줄 끝까지 패딩 (남은 빈 셀 채우기)
    const lastWday = (startWday + lastDate - 1) % 7;
    for (let i = lastWday + 1; i < 7; i++) row += '    ';
    rows.push(`${border}${row}${border}`);
  }

  return [top, titleLine, mid, wdayLine, mid, ...rows, bottom].join('\n');
}

/**
 * 한글 폭 2 가정해서 시각적으로 N칸에 맞춰 중앙정렬.
 */
function padCenterVisual(text, width) {
  const visualWidth = [...text].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);
  const space = Math.max(0, width - visualWidth);
  const left  = Math.floor(space / 2);
  const right = space - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

// ──────────────────────────────────────────────────────────
// 핸들러
// ──────────────────────────────────────────────────────────

async function handleCalendarShow(interaction) {
  await interaction.deferReply();

  const { year: curY, month: curM } = currentKSTYearMonth();
  const year  = interaction.options.getInteger('연도') ?? curY;
  const month = interaction.options.getInteger('월')   ?? curM;

  const db = getDb();
  const { start, end } = monthKSTRange(year, month);

  // 일정 목록: 최근 등록순(created_at DESC) — 가장 최신 등록 일정이 위로 옴
  let rows;
  try {
    rows = db.prepare(`
      SELECT id, title, scheduled_at, channel_id, role_id, description, created_at
      FROM schedules
      WHERE guild_id = ?
        AND scheduled_at >= ?
        AND scheduled_at < ?
      ORDER BY created_at DESC
    `).all(interaction.guildId, start, end);
  } catch (err) {
    console.error('[달력] DB 오류:', err);
    return interaction.editReply({ content: '❌ 달력 조회 중 오류가 발생했습니다.' });
  }

  const markedDays = new Set(rows.map(r => kstDayOfMonth(r.scheduled_at)));

  // 오늘 강조 — 표시 중인 (year, month) 가 KST 오늘과 같을 때만
  const todayDay = (year === curY && month === curM)
    ? Number(formatKST(new Date(), 'd'))
    : null;

  const calendar = renderAnsiCalendar(year, month, markedDays, todayDay);

  // 일정 리스트 (최근 등록순, 최대 15건)
  let scheduleListText;
  if (rows.length === 0) {
    scheduleListText = '_이번 달에 등록된 일정이 없습니다._';
  } else {
    const lines = rows.slice(0, 15).map(r => {
      const dt = formatKST(r.scheduled_at, 'MM/dd (E) HH:mm');
      return `\`#${r.id}\` **${r.title}** — \`${dt}\``;
    });
    if (rows.length > 15) lines.push(`_…외 ${rows.length - 15}건_`);
    scheduleListText = lines.join('\n');
  }

  // 범례
  const legend = '🟡 일정 있음 · 🟨 오늘 · 🔴 일요일 · 🔵 토요일';

  const embed = new EmbedBuilder()
    .setColor(0x118ab2)
    .setTitle(`📅 ${year}년 ${month}월 레기온 달력`)
    .setDescription('```ansi\n' + calendar + '\n```\n' + legend)
    .addFields({
      name: `📋 일정 — 최근 등록순 (${rows.length}건)`,
      value: scheduleListText,
    })
    .setFooter({ text: 'KST 기준 · 최근 등록 일정이 위로 표시됩니다' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ──────────────────────────────────────────────────────────
// interaction 라우팅
// ──────────────────────────────────────────────────────────

async function handleCalendarInteraction(interaction) {
  switch (interaction.commandName) {
    case '달력': await handleCalendarShow(interaction); return true;
    default: return false;
  }
}

module.exports = { calendarCommands, handleCalendarInteraction };
