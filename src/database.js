'use strict';

const Database = require('better-sqlite3');
const path = require('path');

// DB 파일은 프로젝트 루트에 저장
const DB_PATH = path.join(__dirname, '..', 'aion_bot.db');

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
