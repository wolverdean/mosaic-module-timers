import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createPreset } from '../../src/services/presets.service.js'
import { startSession, completeSession, cancelSession } from '../../src/services/sessions.service.js'
import { getDailySummary, getWeeklySummary } from '../../src/services/reports.service.js'

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
  db.prepare(`INSERT INTO users VALUES (1,'a@b.com')`).run()
  migrate({ exec: (sql: string) => db.exec(sql), prepare: db.prepare.bind(db), transaction: (fn: () => unknown) => { const t = db.transaction(fn); return t() }, raw: db } as any)
  return db
}

let db: ReturnType<typeof makeDb>
let presetId: number

beforeEach(() => {
  db = makeDb()
  presetId = createPreset(db, 1, { name: 'Pomodoro', work_minutes: 25, break_minutes: 5 }).id
})

describe('getDailySummary', () => {
  it('returns zeros when no sessions', () => {
    const s = getDailySummary(db, 1, '2026-06-12')
    expect(s.sessions).toBe(0)
    expect(s.focus_minutes).toBe(0)
  })

  it('counts completed sessions and sums duration', () => {
    const s1 = startSession(db, 1, presetId, '2026-06-12T10:00:00')
    completeSession(db, 1, s1.id, '2026-06-12T10:25:00')  // 1500s
    const s2 = startSession(db, 1, presetId, '2026-06-12T11:00:00')
    completeSession(db, 1, s2.id, '2026-06-12T11:25:00')  // 1500s
    const summary = getDailySummary(db, 1, '2026-06-12')
    expect(summary.sessions).toBe(2)
    expect(summary.focus_minutes).toBe(50)
  })

  it('excludes cancelled sessions', () => {
    const s = startSession(db, 1, presetId, '2026-06-12T10:00:00')
    cancelSession(db, 1, s.id, '2026-06-12T10:05:00')
    expect(getDailySummary(db, 1, '2026-06-12').sessions).toBe(0)
  })

  it('excludes sessions from other days', () => {
    const s = startSession(db, 1, presetId, '2026-06-11T10:00:00')
    completeSession(db, 1, s.id, '2026-06-11T10:25:00')
    expect(getDailySummary(db, 1, '2026-06-12').sessions).toBe(0)
  })
})

describe('getWeeklySummary', () => {
  it('returns zeros when no sessions in range', () => {
    const s = getWeeklySummary(db, 1, '2026-06-08', '2026-06-14')
    expect(s.sessions).toBe(0)
    expect(s.focus_minutes).toBe(0)
  })

  it('sums sessions within the date range', () => {
    const s1 = startSession(db, 1, presetId, '2026-06-09T10:00:00')
    completeSession(db, 1, s1.id, '2026-06-09T10:25:00')  // 1500s
    const s2 = startSession(db, 1, presetId, '2026-06-13T10:00:00')
    completeSession(db, 1, s2.id, '2026-06-13T10:50:00')  // 3000s
    const sum = getWeeklySummary(db, 1, '2026-06-08', '2026-06-14')
    expect(sum.sessions).toBe(2)
    expect(sum.focus_minutes).toBe(75)
  })

  it('excludes sessions outside range', () => {
    const s = startSession(db, 1, presetId, '2026-06-01T10:00:00')
    completeSession(db, 1, s.id, '2026-06-01T10:25:00')
    expect(getWeeklySummary(db, 1, '2026-06-08', '2026-06-14').sessions).toBe(0)
  })
})
