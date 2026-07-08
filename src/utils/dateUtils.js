'use strict';

const { toZonedTime, fromZonedTime, format } = require('date-fns-tz');
const { parseISO, isValid } = require('date-fns');

const KST = 'Asia/Seoul';

// 주간 숙제 초기화 경계 — 매주 수요일 10:00 KST (점검 종료 직후 가정).
// 운영 중 점검 종료 시각이 바뀌면 이 두 상수만 조정하면 된다.
const RESET_WDAY = 3;   // 0=일 1=월 2=화 3=수 ...
const RESET_HOUR = 10;  // KST 기준 시(0~23)

/**
 * 날짜 문자열(YYYY-MM-DD)과 시간 문자열(HH:mm)을 받아
 * KST 기준 UTC Date 객체로 변환합니다.
 *
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} timeStr - 'HH:mm'
 * @returns {Date|null} UTC 기준 Date, 파싱 실패 시 null
 */
function parseKST(dateStr, timeStr) {
  try {
    const localStr = `${dateStr}T${timeStr}:00`;
    const utcDate = fromZonedTime(localStr, KST);
    if (!isValid(utcDate)) return null;
    return utcDate;
  } catch {
    return null;
  }
}

/**
 * ISO 문자열 또는 Date를 KST 포맷 문자열로 변환
 * @param {string|Date} dateInput
 * @param {string} [fmt='yyyy-MM-dd HH:mm']
 * @returns {string}
 */
function formatKST(dateInput, fmt = 'yyyy-MM-dd HH:mm') {
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    const kstDate = toZonedTime(date, KST);
    return format(kstDate, fmt, { timeZone: KST });
  } catch {
    return String(dateInput);
  }
}

/**
 * 오늘 KST 날짜 범위 (시작/끝 UTC ISO 문자열) 반환
 * @returns {{ start: string, end: string }}
 */
function todayKSTRange() {
  const now = toZonedTime(new Date(), KST);
  const startStr = format(now, 'yyyy-MM-dd', { timeZone: KST }) + 'T00:00:00';
  const endStr   = format(now, 'yyyy-MM-dd', { timeZone: KST }) + 'T23:59:59';
  return {
    start: fromZonedTime(startStr, KST).toISOString(),
    end:   fromZonedTime(endStr, KST).toISOString(),
  };
}

/**
 * 특정 (year, month) KST 월간 범위 반환.
 * @param {number} year  - 4자리 연도
 * @param {number} month - 1~12
 * @returns {{ start: string, end: string }}
 */
function monthKSTRange(year, month) {
  const mm = String(month).padStart(2, '0');
  const startStr = `${year}-${mm}-01T00:00:00`;
  // 다음달 1일 00:00 직전까지
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const nm = String(nextMonth).padStart(2, '0');
  const endStr = `${nextYear}-${nm}-01T00:00:00`;
  return {
    start: fromZonedTime(startStr, KST).toISOString(),
    end:   fromZonedTime(endStr,   KST).toISOString(),
  };
}

/**
 * 현재 KST 기준 연/월 반환.
 * @returns {{ year: number, month: number }}
 */
function currentKSTYearMonth() {
  const now = toZonedTime(new Date(), KST);
  return {
    year:  Number(format(now, 'yyyy', { timeZone: KST })),
    month: Number(format(now, 'M',    { timeZone: KST })),
  };
}

/**
 * UTC ISO 문자열에서 KST 기준 일자(1~31) 추출.
 * @param {string} iso
 * @returns {number}
 */
function kstDayOfMonth(iso) {
  return Number(format(toZonedTime(new Date(iso), KST), 'd', { timeZone: KST }));
}

/**
 * YYYY-MM-DD 형식 유효성 검사
 * @param {string} str
 * @returns {boolean}
 */
function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && isValid(parseISO(str));
}

/**
 * HH:mm 형식 + 범위(시 00~23, 분 00~59) 유효성 검사
 * @param {string} str
 * @returns {boolean}
 */
function isValidTime(str) {
  if (!/^\d{2}:\d{2}$/.test(str)) return false;
  const [h, m] = str.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * 현재 시각이 속한 "숙제 주차"의 시작 경계(직전 수요일 10:00 KST)를 계산.
 * @returns {{ weekKey: string, startISO: string }}
 *   weekKey  : 경계 수요일의 KST 날짜 'yyyy-MM-dd' (주차 식별자)
 *   startISO : 경계 instant의 UTC ISO 문자열
 */
function homeworkWeekStart() {
  // KST 벽시계 기준 연/월/일/시/분 추출 (format + timeZone 으로 안전하게)
  const nowKstStr = format(toZonedTime(new Date(), KST), 'yyyy-MM-dd HH:mm', { timeZone: KST });
  const [datePart, timePart] = nowKstStr.split(' ');
  const [Y, M, D] = datePart.split('-').map(Number);
  const [h, m]    = timePart.split(':').map(Number);

  // 달력 날짜의 요일은 시간대와 무관 → UTC 기준으로 계산
  const wday = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
  let daysSinceReset = (wday - RESET_WDAY + 7) % 7;
  // 오늘이 수요일이라도 아직 10:00 전이면 지난 주 수요일이 경계
  if (daysSinceReset === 0 && (h * 60 + m) < RESET_HOUR * 60) {
    daysSinceReset = 7;
  }

  const boundary = new Date(Date.UTC(Y, M - 1, D));
  boundary.setUTCDate(boundary.getUTCDate() - daysSinceReset);
  const by = boundary.getUTCFullYear();
  const bm = String(boundary.getUTCMonth() + 1).padStart(2, '0');
  const bd = String(boundary.getUTCDate()).padStart(2, '0');
  const weekKey = `${by}-${bm}-${bd}`;

  const hh = String(RESET_HOUR).padStart(2, '0');
  const startISO = fromZonedTime(`${weekKey}T${hh}:00:00`, KST).toISOString();
  return { weekKey, startISO };
}

/**
 * 현재 숙제 주차 식별자만 반환.
 * @returns {string} 'yyyy-MM-dd'
 */
function currentHomeworkWeek() {
  return homeworkWeekStart().weekKey;
}

/**
 * 현재 숙제 주차의 표시용 범위 정보.
 * @returns {{ weekKey: string, startISO: string, endISO: string, label: string }}
 */
function homeworkWeekRange() {
  const { weekKey, startISO } = homeworkWeekStart();
  const endISO = new Date(new Date(startISO).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const hh = String(RESET_HOUR).padStart(2, '0');
  // 경계는 항상 수요일이므로 요일 라벨을 (수)로 고정
  const label = `${formatKST(startISO, 'MM/dd')}(수) ${hh}:00 ~ ${formatKST(endISO, 'MM/dd')}(수) ${hh}:00`;
  return { weekKey, startISO, endISO, label };
}

module.exports = {
  parseKST,
  formatKST,
  todayKSTRange,
  monthKSTRange,
  currentKSTYearMonth,
  kstDayOfMonth,
  isValidDate,
  isValidTime,
  RESET_WDAY,
  RESET_HOUR,
  currentHomeworkWeek,
  homeworkWeekRange,
};
