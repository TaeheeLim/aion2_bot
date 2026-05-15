'use strict';

/**
 * 아이온2 강화/돌파 시뮬레이션 데이터
 * 원본: 아이온강화.xlsx (사용자 제공)
 *
 * 룩업 규칙 (TARGET-LEVEL 통일):
 *   엑셀의 "강화등급 N" / "돌파등급 N" row 는 "N 단계에 도달하기 위한" 확률·비용.
 *   즉 현재 레벨 C 에서 C+1 로 시도하려면 row[target = C+1] 데이터를 사용.
 *
 *   배열은 0-indexed:
 *     - HERO_ENHANCE[0]      = "강화등급 1" row  (창 생성 단계 → 미사용)
 *     - HERO_ENHANCE[10]     = "강화등급 11" row (10 → 11 시도 시 사용, 65%)
 *     - HERO_BREAKTHROUGH[0] = "돌파등급 1" row  (돌파 0 → 1 시도 시 사용, 33%)
 *     - RUNE_ENHANCE[0]      = "강화등급 1" row  (창 생성 단계 → 미사용)
 *
 * 실패 처리:
 *   - 영웅: 실패해도 파괴 안 됨, 보정 누적 (다음 시도 확률 += fail_boost). 재시도 가능.
 *     성공 시 fail_streak 는 0 으로 리셋.
 *   - 전념의룬: 실패 시 즉시 파괴.
 */

// 영웅 강화: 목표 등급 1~20. 0번째 row(등급 1)는 생성 단계용으로 룩업에서 사용하지 않음.
const HERO_ENHANCE = [
  { prob: 100, fail_boost: 0, kinah: 14000,   stones: 540   },  // 등급 1  (creation)
  { prob: 100, fail_boost: 0, kinah: 19000,   stones: 770   },  // 등급 2  (1 → 2)
  { prob: 100, fail_boost: 0, kinah: 35000,   stones: 1410  },  // 등급 3
  { prob: 100, fail_boost: 0, kinah: 54000,   stones: 2160  },  // 등급 4
  { prob: 100, fail_boost: 0, kinah: 76000,   stones: 3020  },  // 등급 5
  { prob: 100, fail_boost: 0, kinah: 100000,  stones: 3970  },  // 등급 6
  { prob: 100, fail_boost: 0, kinah: 126000,  stones: 5010  },  // 등급 7
  { prob: 100, fail_boost: 0, kinah: 153000,  stones: 6110  },  // 등급 8
  { prob: 100, fail_boost: 0, kinah: 183000,  stones: 7290  },  // 등급 9
  { prob: 100, fail_boost: 0, kinah: 214000,  stones: 8540  },  // 등급 10
  { prob: 65,  fail_boost: 5, kinah: 380000,  stones: 9860  },  // 등급 11 (10 → 11)
  { prob: 50,  fail_boost: 5, kinah: 570000,  stones: 11230 },  // 등급 12
  { prob: 35,  fail_boost: 5, kinah: 910000,  stones: 12660 },  // 등급 13
  { prob: 25,  fail_boost: 5, kinah: 1420000, stones: 14150 },  // 등급 14
  { prob: 20,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 등급 15
  { prob: 65,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 등급 16
  { prob: 50,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 등급 17
  { prob: 35,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 등급 18
  { prob: 25,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 등급 19
  { prob: 20,  fail_boost: 5, kinah: 1970000, stones: 15690 },  // 등급 20 (19 → 20)
];

// 영웅 돌파: 목표 등급 1~5. 시작 등급 = 0.
// fail_boost 는 %포인트 단위 (엑셀 raw 0.05 는 셀 포맷 0% 로 인해 5% 로 표시되는 값).
const HERO_BREAKTHROUGH = [
  { prob: 33,   fail_boost: 5, kinah: 600000,  stones: 6  },  // 등급 1 (0 → 1)
  { prob: 25,   fail_boost: 4, kinah: 900000,  stones: 9  },  // 등급 2
  { prob: 16.5, fail_boost: 3, kinah: 1400000, stones: 12 },  // 등급 3
  { prob: 12.5, fail_boost: 2, kinah: 2000000, stones: 15 },  // 등급 4
  { prob: 10,   fail_boost: 1, kinah: 3000000, stones: 20 },  // 등급 5 (4 → 5)
];

// 전념의룬 강화: 목표 등급 1~10. 0번째 row(등급 1)는 생성 단계용으로 룩업에서 사용하지 않음.
const RUNE_ENHANCE = [
  { prob: 100, kinah: 5000,   stones: 200  },  // 등급 1  (creation)
  { prob: 80,  kinah: 9070,   stones: 290  },  // 등급 2  (1 → 2)
  { prob: 66,  kinah: 19700,  stones: 520  },  // 등급 3
  { prob: 50,  kinah: 40000,  stones: 800  },  // 등급 4
  { prob: 33,  kinah: 84900,  stones: 1120 },  // 등급 5
  { prob: 25,  kinah: 147000, stones: 1470 },  // 등급 6
  { prob: 20,  kinah: 233000, stones: 1860 },  // 등급 7
  { prob: 15,  kinah: 379000, stones: 2270 },  // 등급 8
  { prob: 12,  kinah: 563000, stones: 2700 },  // 등급 9
  { prob: 10,  kinah: 793000, stones: 3170 },  // 등급 10 (9 → 10)
];

// ──────────────────────────────────────────────────────────
// 룩업 헬퍼
// ──────────────────────────────────────────────────────────

const MAX_HERO_ENHANCE        = 20;
const MAX_HERO_BREAKTHROUGH   = 5;
const MAX_RUNE_ENHANCE        = 10;

/**
 * 영웅 강화 시도 데이터 조회. target-level lookup.
 * @param {number} currentLevel - 현재 강화 레벨 (1~19). 목표는 currentLevel+1.
 * @returns {{prob,fail_boost,kinah,stones}|null}
 */
function getHeroEnhanceStep(currentLevel) {
  if (currentLevel < 1 || currentLevel >= MAX_HERO_ENHANCE) return null;
  // 목표 등급 = currentLevel + 1, 배열 인덱스 = 목표 - 1 = currentLevel
  return HERO_ENHANCE[currentLevel];
}

/**
 * 영웅 돌파 시도 데이터 조회. target-level lookup.
 * @param {number} currentLevel - 현재 돌파 레벨 (0~4). 목표는 currentLevel+1.
 * @returns {{prob,fail_boost,kinah,stones}|null}
 */
function getHeroBreakthroughStep(currentLevel) {
  if (currentLevel < 0 || currentLevel >= MAX_HERO_BREAKTHROUGH) return null;
  // 목표 등급 = currentLevel + 1, 배열 인덱스 = 목표 - 1 = currentLevel
  return HERO_BREAKTHROUGH[currentLevel];
}

/**
 * 전념의룬 강화 시도 데이터 조회. target-level lookup.
 * @param {number} currentLevel - 현재 레벨 (1~9). 목표는 currentLevel+1.
 * @returns {{prob,kinah,stones}|null}
 */
function getRuneEnhanceStep(currentLevel) {
  if (currentLevel < 1 || currentLevel >= MAX_RUNE_ENHANCE) return null;
  // 목표 등급 = currentLevel + 1, 배열 인덱스 = 목표 - 1 = currentLevel
  return RUNE_ENHANCE[currentLevel];
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
