import type { ModuleDb } from '@mosaic/sdk'

export function migrate(db: ModuleDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS timers_presets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT    NOT NULL,
      work_minutes  INTEGER NOT NULL CHECK(work_minutes > 0),
      break_minutes INTEGER NOT NULL CHECK(break_minutes > 0),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS timers_sessions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset_id        INTEGER REFERENCES timers_presets(id) ON DELETE SET NULL,
      preset_name      TEXT    NOT NULL DEFAULT '',
      work_minutes     INTEGER NOT NULL DEFAULT 25,
      status           TEXT    NOT NULL DEFAULT 'active'
                         CHECK(status IN ('active','paused','completed','cancelled')),
      started_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      ended_at         TEXT,
      last_active_start TEXT   NOT NULL DEFAULT (datetime('now')),
      paused_at        TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      notes            TEXT    NOT NULL DEFAULT '',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS timers_sessions_user_date ON timers_sessions(user_id, started_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS timers_sessions_status    ON timers_sessions(user_id, status)`)
  db.exec(`CREATE INDEX IF NOT EXISTS timers_presets_user       ON timers_presets(user_id)`)

  const cols = (db.prepare(`PRAGMA table_info(timers_sessions)`).all() as { name: string }[]).map(c => c.name)
  if (!cols.includes('break_minutes')) {
    db.exec(`ALTER TABLE timers_sessions ADD COLUMN break_minutes INTEGER NOT NULL DEFAULT 5`)
  }
}
