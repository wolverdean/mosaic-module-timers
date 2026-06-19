import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createPreset } from '../../src/services/presets.service.js'
import {
  startSession, pauseSession, resumeSession, completeSession, cancelSession,
} from '../../src/services/sessions.service.js'
import { pomodoroPushJob } from '../../src/jobs/pomodoro-push.job.js'
import type { ModuleContext } from '@mosaic/sdk'

type Db = ReturnType<typeof Database>

function makeDb(): Db {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
  db.prepare(`INSERT INTO users VALUES (1,'a@b.com')`).run()
  db.prepare(`INSERT INTO users VALUES (2,'b@b.com')`).run()
  migrate({
    exec:        (sql: string) => db.exec(sql),
    prepare:     db.prepare.bind(db),
    transaction: (fn: () => unknown) => { const t = db.transaction(fn); return t() },
    raw:         db,
  } as any)
  return db
}

function makeCtx(db: Db) {
  const pushFn = vi.fn().mockResolvedValue(undefined)
  const ctx = {
    db:     { raw: db },
    notify: { push: pushFn },
    logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  } as unknown as ModuleContext
  return { ctx, pushFn }
}

function setEndsAt(db: Db, id: number, endsAt: string | null) {
  db.prepare(`UPDATE timers_sessions SET ends_at = ? WHERE id = ?`).run(endsAt, id)
}

function setPushSentAt(db: Db, id: number, value: string | null) {
  db.prepare(`UPDATE timers_sessions SET push_sent_at = ? WHERE id = ?`).run(value, id)
}

function getRow(db: Db, id: number): any {
  return db.prepare(`SELECT * FROM timers_sessions WHERE id = ?`).get(id)
}

const PAST   = '2020-01-01T00:00:00'
const FUTURE = '2099-01-01T00:00:00'
const T0     = '2026-06-12T10:00:00'
const T1     = '2026-06-12T10:10:00'
const T2     = '2026-06-12T10:15:00'

let db: Db
let presetId: number
let preset2Id: number

beforeEach(() => {
  db = makeDb()
  presetId  = createPreset(db, 1, { name: 'Pomodoro', work_minutes: 25, break_minutes: 5 }).id
  preset2Id = createPreset(db, 2, { name: 'Pomodoro', work_minutes: 25, break_minutes: 5 }).id
})

describe('pomodoroPushJob — basic fire', () => {
  it('fires push for an expired active session', async () => {
    const s = startSession(db, 1, presetId, T0)
    setEndsAt(db, s.id, PAST)
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)

    expect(pushFn).toHaveBeenCalledOnce()
    expect(pushFn).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Pomodoro complete' }))
  })

  it('stamps push_sent_at = PENDING before calling push', async () => {
    const s = startSession(db, 1, presetId, T0)
    setEndsAt(db, s.id, PAST)

    let pendingDuringPush: string | null = null
    const pushFn = vi.fn().mockImplementation(async () => {
      pendingDuringPush = getRow(db, s.id).push_sent_at
    })
    const ctx = {
      db: { raw: db },
      notify: { push: pushFn },
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    } as unknown as ModuleContext

    await pomodoroPushJob(ctx)

    expect(pendingDuringPush).toBe('PENDING')
  })

  it('stamps push_sent_at to ISO timestamp after successful push', async () => {
    const s = startSession(db, 1, presetId, T0)
    setEndsAt(db, s.id, PAST)
    const { ctx } = makeCtx(db)

    await pomodoroPushJob(ctx)

    const row = getRow(db, s.id)
    expect(row.push_sent_at).not.toBeNull()
    expect(row.push_sent_at).not.toBe('PENDING')
    expect(row.push_sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

describe('pomodoroPushJob — no push for non-active statuses', () => {
  it('does not fire for a paused session', async () => {
    const s = startSession(db, 1, presetId, T0)
    pauseSession(db, 1, s.id, T1)
    setEndsAt(db, s.id, PAST)  // manually set even though paused; job must still skip
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)

    expect(pushFn).not.toHaveBeenCalled()
  })

  it('does not fire for a cancelled session', async () => {
    const s = startSession(db, 1, presetId, T0)
    cancelSession(db, 1, s.id, T1)
    setEndsAt(db, s.id, PAST)
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)

    expect(pushFn).not.toHaveBeenCalled()
  })

  it('does not fire for a completed session', async () => {
    const s = startSession(db, 1, presetId, T0)
    completeSession(db, 1, s.id, T1)
    setEndsAt(db, s.id, PAST)
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)

    expect(pushFn).not.toHaveBeenCalled()
  })
})

describe('pomodoroPushJob — ends_at guards', () => {
  it('does not fire when ends_at is NULL', async () => {
    const s = startSession(db, 1, presetId, T0)
    setEndsAt(db, s.id, null)
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)

    expect(pushFn).not.toHaveBeenCalled()
  })

  it('does not fire when ends_at is in the future', async () => {
    const s = startSession(db, 1, presetId, T0)
    setEndsAt(db, s.id, FUTURE)
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)

    expect(pushFn).not.toHaveBeenCalled()
  })
})

describe('pomodoroPushJob — idempotency', () => {
  it('does not double-fire when push_sent_at is already a timestamp', async () => {
    const s = startSession(db, 1, presetId, T0)
    setEndsAt(db, s.id, PAST)
    setPushSentAt(db, s.id, '2026-06-12T10:26:00')
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)

    expect(pushFn).not.toHaveBeenCalled()
  })

  it('does not double-fire when push_sent_at is PENDING', async () => {
    const s = startSession(db, 1, presetId, T0)
    setEndsAt(db, s.id, PAST)
    setPushSentAt(db, s.id, 'PENDING')
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)

    expect(pushFn).not.toHaveBeenCalled()
  })

  it('fires exactly once when job runs twice', async () => {
    const s = startSession(db, 1, presetId, T0)
    setEndsAt(db, s.id, PAST)
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)
    await pomodoroPushJob(ctx)

    expect(pushFn).toHaveBeenCalledOnce()
  })
})

describe('pomodoroPushJob — server restart (late delivery)', () => {
  it('fires push for a session whose ends_at is 10 minutes in the past', async () => {
    const s = startSession(db, 1, presetId, T0)
    setEndsAt(db, s.id, '2020-01-01T00:00:00')  // very old
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)

    expect(pushFn).toHaveBeenCalledOnce()
    const row = getRow(db, s.id)
    expect(row.push_sent_at).not.toBeNull()
    expect(row.push_sent_at).not.toBe('PENDING')
  })
})

describe('pomodoroPushJob — multi-user scoping', () => {
  it('sends push to the correct user_id for each expired session', async () => {
    const s1 = startSession(db, 1, presetId,  T0)
    const s2 = startSession(db, 2, preset2Id, T0)
    setEndsAt(db, s1.id, PAST)
    setEndsAt(db, s2.id, PAST)
    const { ctx, pushFn } = makeCtx(db)

    await pomodoroPushJob(ctx)

    expect(pushFn).toHaveBeenCalledTimes(2)
    const calledUserIds = pushFn.mock.calls.map((c: any[]) => c[0]).sort()
    expect(calledUserIds).toEqual([1, 2])
  })
})

describe('pomodoroPushJob — push failure handling', () => {
  it('leaves push_sent_at = PENDING on push failure (no retry double-fire)', async () => {
    const s = startSession(db, 1, presetId, T0)
    setEndsAt(db, s.id, PAST)
    const pushFn = vi.fn().mockRejectedValue(new Error('push failed'))
    const ctx = {
      db: { raw: db },
      notify: { push: pushFn },
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    } as unknown as ModuleContext

    await pomodoroPushJob(ctx)

    const row = getRow(db, s.id)
    expect(row.push_sent_at).toBe('PENDING')
  })
})
