import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createPreset } from '../../src/services/presets.service.js'
import {
  startSession, pauseSession, resumeSession,
  completeSession, cancelSession, getActiveSession, listSessions,
} from '../../src/services/sessions.service.js'

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
  db.prepare(`INSERT INTO users VALUES (1,'a@b.com')`).run()
  db.prepare(`INSERT INTO users VALUES (2,'b@b.com')`).run()
  migrate({ exec: (sql: string) => db.exec(sql), prepare: db.prepare.bind(db), transaction: (fn: () => unknown) => { const t = db.transaction(fn); return t() }, raw: db } as any)
  return db
}

let db: ReturnType<typeof makeDb>
let presetId: number

beforeEach(() => {
  db = makeDb()
  presetId = createPreset(db, 1, { name: 'Pomodoro', work_minutes: 25, break_minutes: 5 }).id
})

const T0 = '2026-06-12T10:00:00'
const T1 = '2026-06-12T10:10:00'  // +600s
const T2 = '2026-06-12T10:15:00'  // +300s from T1
const T3 = '2026-06-12T10:25:00'  // +600s from T2

describe('startSession', () => {
  it('creates an active session', () => {
    const s = startSession(db, 1, presetId, T0)
    expect(s.status).toBe('active')
    expect(s.preset_name).toBe('Pomodoro')
    expect(s.work_minutes).toBe(25)
    expect(s.duration_seconds).toBe(0)
  })

  it('throws if a session is already active', () => {
    startSession(db, 1, presetId, T0)
    expect(() => startSession(db, 1, presetId, T1)).toThrow('session already in progress')
  })

  it('throws if a session is paused', () => {
    const s = startSession(db, 1, presetId, T0)
    pauseSession(db, 1, s.id, T1)
    expect(() => startSession(db, 1, presetId, T2)).toThrow('session already in progress')
  })

  it('isolates sessions by user', () => {
    const p2 = createPreset(db, 2, { name: 'P', work_minutes: 25, break_minutes: 5 }).id
    startSession(db, 1, presetId, T0)
    expect(() => startSession(db, 2, p2, T0)).not.toThrow()
  })

  it('throws if preset belongs to another user', () => {
    expect(() => startSession(db, 2, presetId, T0)).toThrow('preset not found')
  })
})

describe('pauseSession', () => {
  it('accumulates elapsed seconds and sets paused_at', () => {
    const s = startSession(db, 1, presetId, T0)
    const paused = pauseSession(db, 1, s.id, T1)
    expect(paused.status).toBe('paused')
    expect(paused.duration_seconds).toBe(600)
    expect(paused.paused_at).toBe(T1)
  })

  it('throws if session is not active', () => {
    const s = startSession(db, 1, presetId, T0)
    pauseSession(db, 1, s.id, T1)
    expect(() => pauseSession(db, 1, s.id, T2)).toThrow('session not active')
  })

  it('returns null for wrong user', () => {
    const s = startSession(db, 1, presetId, T0)
    expect(pauseSession(db, 2, s.id, T1)).toBeNull()
  })
})

describe('resumeSession', () => {
  it('clears paused_at and sets status to active', () => {
    const s = startSession(db, 1, presetId, T0)
    pauseSession(db, 1, s.id, T1)
    const resumed = resumeSession(db, 1, s.id, T2)
    expect(resumed?.status).toBe('active')
    expect(resumed?.paused_at).toBeNull()
    expect(resumed?.duration_seconds).toBe(600)
  })

  it('throws if session is not paused', () => {
    const s = startSession(db, 1, presetId, T0)
    expect(() => resumeSession(db, 1, s.id, T1)).toThrow('session not paused')
  })
})

describe('completeSession', () => {
  it('finalises duration from active session', () => {
    const s = startSession(db, 1, presetId, T0)
    const done = completeSession(db, 1, s.id, T1)
    expect(done?.status).toBe('completed')
    expect(done?.duration_seconds).toBe(600)
    expect(done?.ended_at).toBe(T1)
  })

  it('finalises duration correctly after pause-resume-complete', () => {
    const s  = startSession(db, 1, presetId, T0)   // active
    pauseSession(db, 1, s.id, T1)                   // +600s → 600
    resumeSession(db, 1, s.id, T2)                  // resume at T2
    const done = completeSession(db, 1, s.id, T3)   // +600s → 1200
    expect(done?.duration_seconds).toBe(1200)
  })

  it('completes a paused session without extra elapsed', () => {
    const s = startSession(db, 1, presetId, T0)
    pauseSession(db, 1, s.id, T1)                   // +600s → 600
    const done = completeSession(db, 1, s.id, T2)   // already paused
    expect(done?.duration_seconds).toBe(600)
  })

  it('accepts optional notes', () => {
    const s = startSession(db, 1, presetId, T0)
    const done = completeSession(db, 1, s.id, T1, 'Good session')
    expect(done?.notes).toBe('Good session')
  })

  it('throws if session not in progress', () => {
    const s = startSession(db, 1, presetId, T0)
    completeSession(db, 1, s.id, T1)
    expect(() => completeSession(db, 1, s.id, T2)).toThrow('session not in progress')
  })

  it('returns null for wrong user', () => {
    const s = startSession(db, 1, presetId, T0)
    expect(completeSession(db, 2, s.id, T1)).toBeNull()
  })
})

describe('cancelSession', () => {
  it('sets status to cancelled', () => {
    const s = startSession(db, 1, presetId, T0)
    const cancelled = cancelSession(db, 1, s.id, T1)
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.ended_at).toBe(T1)
  })

  it('throws if session not in progress', () => {
    const s = startSession(db, 1, presetId, T0)
    cancelSession(db, 1, s.id, T1)
    expect(() => cancelSession(db, 1, s.id, T2)).toThrow('session not in progress')
  })
})

describe('getActiveSession', () => {
  it('returns null when no active session', () => {
    expect(getActiveSession(db, 1)).toBeNull()
  })

  it('returns active session', () => {
    startSession(db, 1, presetId, T0)
    expect(getActiveSession(db, 1)?.status).toBe('active')
  })

  it('returns paused session', () => {
    const s = startSession(db, 1, presetId, T0)
    pauseSession(db, 1, s.id, T1)
    expect(getActiveSession(db, 1)?.status).toBe('paused')
  })

  it('returns null after completion', () => {
    const s = startSession(db, 1, presetId, T0)
    completeSession(db, 1, s.id, T1)
    expect(getActiveSession(db, 1)).toBeNull()
  })
})

describe('listSessions', () => {
  it('returns completed sessions by default', () => {
    const s = startSession(db, 1, presetId, T0)
    completeSession(db, 1, s.id, T1)
    const s2 = startSession(db, 1, presetId, T1)
    cancelSession(db, 1, s2.id, T2)
    const list = listSessions(db, 1, {})
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('completed')
  })

  it('filters by date', () => {
    const s = startSession(db, 1, presetId, '2026-06-12T10:00:00')
    completeSession(db, 1, s.id, '2026-06-12T10:25:00')
    const s2 = startSession(db, 1, presetId, '2026-06-11T09:00:00')
    completeSession(db, 1, s2.id, '2026-06-11T09:25:00')
    expect(listSessions(db, 1, { date: '2026-06-12' })).toHaveLength(1)
  })

  it('filters by month', () => {
    const s = startSession(db, 1, presetId, '2026-06-12T10:00:00')
    completeSession(db, 1, s.id, '2026-06-12T10:25:00')
    const s2 = startSession(db, 1, presetId, '2026-05-01T09:00:00')
    completeSession(db, 1, s2.id, '2026-05-01T09:25:00')
    expect(listSessions(db, 1, { month: '2026-06' })).toHaveLength(1)
  })
})
