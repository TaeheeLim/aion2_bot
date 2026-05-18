'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB 경로 우선순위:
//   1) 환경변수 DB_PATH (Docker 볼륨 마운트 등)
//   2) 기본: <프로젝트 루트>/aion_bot.db
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'aion_bot.db');

// DB 파일이 들어갈 디렉토리가 없으면 생성 (마운트된 빈 볼륨 첫 기동 대비)
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let db;

/**
 * SQLite DB 초기화 및 테이블 생성
 * @returns {Database} DB 인스턴스
 */
function initDatabase() {
  if (db) return db;

  db = new Database(DB_PATH);

  // WAL 모드: 동시성 향상
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ──────────────────────────────────────────
  // builds 테이블
  // ──────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS builds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT    NOT NULL,
      job_name    TEXT    NOT NULL,
      build_name  TEXT    NOT NULL,
      description TEXT,
      stats       TEXT,
      skills      TEXT,
      author_id   TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // ──────────────────────────────────────────
  // schedules 테이블
  // notify_60/30/10  : 알림 설정 여부 (1=설정, 0=미설정)
  // notified_60/30/10: 이미 발송했는지 여부 (1=발송됨, 중복 방지)
  // ──────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id     TEXT    NOT NULL,
      title        TEXT    NOT NULL,
      scheduled_at TEXT    NOT NULL,
      description  TEXT,
      channel_id   TEXT    NOT NULL,
      role_id      TEXT,
      notify_60    INTEGER NOT NULL DEFAULT 0,
      notify_30    INTEGER NOT NULL DEFAULT 0,
      notify_10    INTEGER NOT NULL DEFAULT 0,
      notified_60  INTEGER NOT NULL DEFAULT 0,
      notified_30  INTEGER NOT NULL DEFAULT 0,
      notified_10  INTEGER NOT NULL DEFAULT 0,
      author_id    TEXT    NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // ──────────────────────────────────────────
  // inventory 테이블 (아이온2 강화/돌파 시뮬레이션)
  // item_type        : '영웅' | '전념의룬'
  // enhance_level    : 강화 등급 (1~20 영웅, 1~10 전념의룬)
  // breakthrough_lv  : 돌파 등급 (0~5 영웅, 전념의룬은 항상 0)
  // *_fail_streak    : 실패 누적 보정 카운터 (영웅만 의미 있음)
  // destroyed        : 0/1 — 1이면 더 이상 강화/돌파 불가
  // ──────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id                    TEXT    NOT NULL,
      user_id                     TEXT    NOT NULL,
      item_name                   TEXT    NOT NULL,
      item_type                   TEXT    NOT NULL,
      enhance_level               INTEGER NOT NULL DEFAULT 1,
      breakthrough_level          INTEGER NOT NULL DEFAULT 0,
      enhance_fail_streak         INTEGER NOT NULL DEFAULT 0,
      breakthrough_fail_streak    INTEGER NOT NULL DEFAULT 0,
      destroyed                   INTEGER NOT NULL DEFAULT 0,
      destroyed_reason            TEXT,
      total_kinah_used            INTEGER NOT NULL DEFAULT 0,
      total_enhance_stones_used   INTEGER NOT NULL DEFAULT 0,
      total_breakthrough_stones_used INTEGER NOT NULL DEFAULT 0,
      created_at                  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at                  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 기존 DB 호환 마이그레이션
  const migrations = [
    `ALTER TABLE schedules ADD COLUMN voice_channel_id TEXT`,
    `ALTER TABLE schedules ADD COLUMN notify_3    INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE schedules ADD COLUMN notified_3  INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* 이미 존재하면 무시 */ }
  }

  console.log('[DB] SQLite 초기화 완료:', DB_PATH);
  return db;
}

/**
 * DB 인스턴스 반환 (초기화 필요 시 자동 초기화)
 */
function getDb() {
  if (!db) initDatabase();
  return db;
}

module.exports = { initDatabase, getDb };
