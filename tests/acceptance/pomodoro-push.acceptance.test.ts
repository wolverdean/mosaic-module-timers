/**
 * Acceptance tests for AC1–AC8: Pomodoro push notification on work timer expiry.
 *
 * Strategy: use the same in-process app + in-memory DB pattern as the existing
 * acceptance suite (timers.test.ts). The job is invoked directly (not via cron)
 * with a real ctx that has ctx.notify.push mocked — avoids needing real push
 * subscriptions while still exercising the full service + job integration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createRouter } from '../../src/routes/index.js'
import { pomodoroPushJob } from '../../src/jobs/pomodoro-push.job.js'
import type { ModuleContext } from '@mosaic/sdk'

type Db = ReturnType<typeof Database>

function makeEnv() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
  db.prepare(`INSERT INTO users VALUES (1,'user1@test.com')`).run()
  db.prepare(`INSERT INTO users VALUES (2,'user2@test.com')`).run()

  const modDb = {
    prepare:     db.prepare.bind(db),
    exec:        (sql: string) => db.exec(sql),
    transaction: (fn: () => unknown) => { const t = db.transaction(fn); return t() },
    raw:         db,
  }
  migrate(modDb as any)

  const pushFn = vi.fn().mockResolvedValue(undefined)

  function makeCtx(userId: number): ModuleContext {
    return {
      db:     modDb,
      notify: { push: pushFn },
      logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    } as unknown as ModuleContext
  }

  function appFor(userId: number) {
    const ctxRef: { current: ModuleContext | null } = { current: makeCtx(userId) }
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { (req as any).userId = userId; next() })
    app.use('/api/timers', createRouter(ctxRef))
    return app
  }

  const ctx1 = makeCtx(1)
  const ctx2 = makeCtx(2)

  return { db, pushFn, appFor, ctx1, ctx2 }
}

function setEndsAt(db: Db, id: number, endsAt: string | null) {
  db.prepare(`UPDATE timers_sessions SET ends_at = ? WHERE id = ?`).run(endsAt, id)
}

function getRow(db: Db, id: number): any {
  return db.prepare(`SELECT * FROM timers_sessions WHERE id = ?`).get(id)
}

const PAST = '2020-01-01T00:00:00'

let env: ReturnType<typeof makeEnv>

beforeEach(() => {
  env = makeEnv()
  vi.clearAllMocks()
})

// AC1 — push fires when work timer expires
describe('AC1 — push fires when timer expires', () => {
  it('stamps push_sent_at and calls notify.push after job runs on an expired session', async () => {
    const app = env.appFor(1)
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    const sessionId = started.body.id

    setEndsAt(env.db, sessionId, PAST)
    await pomodoroPushJob(env.ctx1)

    expect(env.pushFn).toHaveBeenCalledOnce()
    expect(env.pushFn).toHaveBeenCalledWith(1, expect.objectContaining({
      title: 'Pomodoro complete',
      url:   '/api/timers',
    }))
    const row = getRow(env.db, sessionId)
    expect(row.push_sent_at).not.toBeNull()
    expect(row.push_sent_at).not.toBe('PENDING')
  })
})

// AC2 — push does NOT fire for paused session
describe('AC2 — push does not fire for paused sessions', () => {
  it('skips push when session is paused even if ends_at would be in the past', async () => {
    const app = env.appFor(1)
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${started.body.id}/pause`)

    // Force ends_at to past directly; status is 'paused' so job must skip
    setEndsAt(env.db, started.body.id, PAST)
    await pomodoroPushJob(env.ctx1)

    expect(env.pushFn).not.toHaveBeenCalled()
    expect(getRow(env.db, started.body.id).push_sent_at).toBeNull()
  })
})

// AC3 — push fires exactly once (idempotency)
describe('AC3 — push fires exactly once', () => {
  it('does not double-fire when job runs twice on same expired session', async () => {
    const app = env.appFor(1)
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    setEndsAt(env.db, started.body.id, PAST)

    await pomodoroPushJob(env.ctx1)
    await pomodoroPushJob(env.ctx1)

    expect(env.pushFn).toHaveBeenCalledOnce()
  })
})

// AC4 — push fires correctly after server restart (late delivery)
describe('AC4 — late delivery after server restart', () => {
  it('fires push for a session whose ends_at is 10 minutes in the past', async () => {
    const app = env.appFor(1)
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    // Simulate server being down: ends_at is 10 min old, push_sent_at still null
    setEndsAt(env.db, started.body.id, '2020-01-01T00:00:00')

    await pomodoroPushJob(env.ctx1)

    expect(env.pushFn).toHaveBeenCalledOnce()
    const row = getRow(env.db, started.body.id)
    expect(row.push_sent_at).not.toBeNull()
    expect(row.push_sent_at).not.toBe('PENDING')
  })
})

// AC5 — pausing nulls ends_at
describe('AC5 — pausing a timer suppresses the push window', () => {
  it('ends_at is NULL after pausing an active session', async () => {
    const app = env.appFor(1)
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })

    expect(started.body.ends_at).not.toBeNull()

    await request(app).post(`/api/timers/sessions/${started.body.id}/pause`)
    const row = getRow(env.db, started.body.id)
    expect(row.ends_at).toBeNull()
  })
})

// AC6 — resuming recomputes ends_at
describe('AC6 — resuming re-opens the push window', () => {
  it('ends_at is recomputed (not null) after resuming a paused session', async () => {
    const app = env.appFor(1)
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${started.body.id}/pause`)
    const resumed = await request(app).post(`/api/timers/sessions/${started.body.id}/resume`)

    expect(resumed.body.ends_at).not.toBeNull()
    expect(resumed.body.push_sent_at).toBeNull()
  })
})

// AC7 — break phase does not trigger push (completed session skipped)
describe('AC7 — break phase does not trigger push', () => {
  it('no push sent for a completed session even with past ends_at', async () => {
    const app = env.appFor(1)
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${started.body.id}/complete`)

    setEndsAt(env.db, started.body.id, PAST)
    await pomodoroPushJob(env.ctx1)

    expect(env.pushFn).not.toHaveBeenCalled()
  })
})

// AC8 — push is scoped to the session owner
describe('AC8 — push scoped to session owner', () => {
  it('sends push to correct user_id for each expired session', async () => {
    const app1 = env.appFor(1)
    const app2 = env.appFor(2)

    const presets1 = await request(app1).get('/api/timers/presets')
    const presets2 = await request(app2).get('/api/timers/presets')

    const s1 = await request(app1).post('/api/timers/sessions/start').send({ preset_id: presets1.body[0].id })
    const s2 = await request(app2).post('/api/timers/sessions/start').send({ preset_id: presets2.body[0].id })

    setEndsAt(env.db, s1.body.id, PAST)
    setEndsAt(env.db, s2.body.id, PAST)

    // Use a single ctx that covers both users (shared pushFn)
    await pomodoroPushJob(env.ctx1)

    expect(env.pushFn).toHaveBeenCalledTimes(2)
    const calledUserIds = (env.pushFn.mock.calls as any[][]).map(c => c[0]).sort()
    expect(calledUserIds).toEqual([1, 2])
  })
})
