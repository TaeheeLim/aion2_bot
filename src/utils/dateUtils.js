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
 * YYYY-MM-DD 형식 유효성 검사
 * @param {string} str
 * @returns {boolean}
 */
function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && isValid(parseISO(str));
}

/**
 * HH:mm 형식 유효성 검사
 * @param {string} str
 * @returns {boolean}
 */
function isValidTime(str) {
  return /^\d{2}:\d{2}$/.test(str);
}

module.exports = {
  parseKST,
  formatKST,
  todayKSTRange,
  isValidDate,
  isValidTime,
};
