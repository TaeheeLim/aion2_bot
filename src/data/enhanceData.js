'use strict';

/**
 * 아이온2 강화/돌파 시뮬레이션 데이터
 * 원본: 아이온강화.xlsx (사용자 제공)
 *
 * 룩업 규칙:
 *   - 강화: 현재 레벨 N에서 N+1 로 시도 시 row[N] 사용 (current-level lookup)
 *   - 돌파: 현재 레벨 N에서 N+1 로 시도 시 row[N+1] 사용 (target-level lookup, 0부터 시작)
 *
 * 실패 처리:
 *   - 영웅: 실패해도 파괴 안 됨, 보정 누적 (다음 시도 확률 += fail_boost). 재시도 가능.
 *   - 전념의룬: 실패 시 즉시 파괴.
 */

// 영웅 강화: lvl 1~20 (max=20). row index = 현재 레벨.
// 마지막 row (lvl 20→21) 는 사용되지 않음(20강 도달 시 /돌파 로 전환).
const HERO_ENHANCE = [
  { prob: 100, fail_boost: 0, kinah: 14000,   stones: 540   },  // 1 → 2
  { prob: 100, fail_boost: 0, kinah: 19000,   stones: 770   },  // 2 → 3
  { prob: 100, fail_boost: 0, kinah: 35000,   stones: 1410  },  // 3 → 4
  { prob: 100, fail_boost: 0, kinah: 54000,   stones: 2160  },  // 4 → 5
  { prob: 100, fail_boost: 0, kinah: 76000,   stones: 3020  },  // 5 → 6
  { prob: 100, fail_boost: 0, kinah: 100000,  stones: 3970  },  // 6 → 7
  { prob: 100, fail_boost: 0, kinah: 126000,  stones: 5010  },  // 7 → 8
  { prob: 100, fail_boost: 0, kinah: 153000,  stones: 6110  },  // 8 → 9
  { prob: 100, fail_boost: 0, kinah: 183000,  stones: 7290  },  // 9 → 10
  { prob: 100, fail_boost: 0, kinah: 214000,  stones: 8540  },  // 10 → 11
  { prob: 65,  fail_boost: 5, kinah: 380000,  stones: 9860  },  // 11 → 12
  { prob: 50,  fail_boost: 5, kinah: 570000,  stones: 11230 },  // 12 → 13
  { prob: 35,  fail_boost: 5, kinah: 910000,  stones: 12660 },  // 13 → 14
  { prob: 25,  fail_boost: 5, kinah: 1420000, stones: 14150 },  // 14 → 15
  { prob: 20,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 15 → 16
  { prob: 65,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 16 → 17
  { prob: 50,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 17 → 18
  { prob: 35,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 18 → 19
  { prob: 25,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 19 → 20
  { prob: 20,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 20 → 21 (unused)
];

// 영웅 돌파: lvl 0~5 (max=5). row index = 목표 레벨 - 1 (target-level lookup, 0-indexed).
// 즉 current 0 → 1 시 row 0 사용, current 4 → 5 시 row 4 사용.
const HERO_BREAKTHROUGH = [
  { prob: 33,   fail_boost: 0.05, kinah: 600000,  stones: 6  },  // 0 → 1
  { prob: 25,   fail_boost: 0.04, kinah: 900000,  stones: 9  },  // 1 → 2
  { prob: 16.5, fail_boost: 0.03, kinah: 1400000, stones: 12 },  // 2 → 3
  { prob: 12.5, fail_boost: 0.02, kinah: 2000000, stones: 15 },  // 3 → 4
  { prob: 10,   fail_boost: 0.01, kinah: 3000000, stones: 20 },  // 4 → 5
];

// 전념의룬 강화: lvl 1~10 (max=10). row index = 현재 레벨.
// 확률은 사용자 지정값(엑셀 N열은 비어있음). 실패 시 즉시 파괴.
const RUNE_ENHANCE = [
  { prob: 100, kinah: 5000,   stones: 200  },  // 1 → 2
  { prob: 80,  kinah: 9070,   stones: 290  },  // 2 → 3
  { prob: 66,  kinah: 19700,  stones: 520  },  // 3 → 4
  { prob: 50,  kinah: 40000,  stones: 800  },  // 4 → 5
  { prob: 33,  kinah: 84900,  stones: 1120 },  // 5 → 6
  { prob: 25,  kinah: 147000, stones: 1470 },  // 6 → 7
  { prob: 20,  kinah: 233000, stones: 1860 },  // 7 → 8
  { prob: 15,  kinah: 379000, stones: 2270 },  // 8 → 9
  { prob: 12,  kinah: 563000, stones: 2700 },  // 9 → 10
  { prob: 10,  kinah: 793000, stones: 3170 },  // 10 → 11 (unused)
];

// ──────────────────────────────────────────────────────────
// 룩업 헬퍼
// ──────────────────────────────────────────────────────────

const MAX_HERO_ENHANCE        = 20;
const MAX_HERO_BREAKTHROUGH   = 5;
const MAX_RUNE_ENHANCE        = 10;

/**
 * 영웅 강화 시도 데이터 조회.
 * @param {number} currentLevel - 현재 강화 레벨 (1~19)
 * @returns {{prob,fail_boost,kinah,stones}|null}
 */
function getHeroEnhanceStep(currentLevel) {
  if (currentLevel < 1 || currentLevel >= MAX_HERO_ENHANCE) return null;
  return HERO_ENHANCE[currentLevel - 1];
}

/**
 * 영웅 돌파 시도 데이터 조회.
 * @param {number} currentLevel - 현재 돌파 레벨 (0~4)
 * @returns {{prob,fail_boost,kinah,stones}|null}
 */
function getHeroBreakthroughStep(currentLevel) {
  if (currentLevel < 0 || currentLevel >= MAX_HERO_BREAKTHROUGH) return null;
  return HERO_BREAKTHROUGH[currentLevel];
}

/**
 * 전념의룬 강화 시도 데이터 조회.
 * @param {number} currentLevel - 현재 레벨 (1~9)
 * @returns {{prob,kinah,stones}|null}
 */
function getRuneEnhanceStep(currentLevel) {
  if (currentLevel < 1 || currentLevel >= MAX_RUNE_ENHANCE) return null;
  return RUNE_ENHANCE[currentLevel - 1];
}

module.exports = {
  HERO_ENHANCE,
  HERO_BREAKTHROUGH,
  RUNE_ENHANCE,
  MAX_HERO_ENHANCE,
  MAX_HERO_BREAKTHROUGH,
  MAX_RUNE_ENHANCE,
  getHeroEnhanceStep,
  getHeroBreakthroughStep,
  getRuneEnhanceStep,
};
