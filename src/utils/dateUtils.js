'use strict';

const { toZonedTime, fromZonedTime, format } = require('date-fns-tz');
const { parseISO, isValid } = require('date-fns');

const KST = 'Asia/Seoul';

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

module.exports = {
  parseKST,
  formatKST,
  todayKSTRange,
  monthKSTRange,
  currentKSTYearMonth,
  kstDayOfMonth,
  isValidDate,
  isValidTime,
};
