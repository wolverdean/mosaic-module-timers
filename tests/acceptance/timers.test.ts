import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createRouter } from '../../src/routes/index.js'
import type { ModuleContext } from '@mosaic/sdk'

function makeApp() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
  db.prepare(`INSERT INTO users VALUES (1,'a@b.com')`).run()

  const modDb = {
    prepare: db.prepare.bind(db),
    exec:    (sql: string) => db.exec(sql),
    transaction: (fn: () => unknown) => { const t = db.transaction(fn); return t() },
    raw: db,
  }
  migrate(modDb as any)

  const ctxRef: { current: ModuleContext | null } = {
    current: {
      db: modDb,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    } as any,
  }

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { (req as any).userId = 1; next() })
  app.use('/api/timers', createRouter(ctxRef))
  return app
}

let app: ReturnType<typeof makeApp>
beforeEach(() => { app = makeApp() })

// AC1 — presets with default seeding
describe('AC1 — presets', () => {
  it('seeds default Pomodoro preset', async () => {
    const res = await request(app).get('/api/timers/presets')
    expect(res.status).toBe(200)
    expect(res.body[0].name).toBe('Pomodoro')
    expect(res.body[0].work_minutes).toBe(25)
    expect(res.body[0].break_minutes).toBe(5)
  })

  it('creates a custom preset', async () => {
    const res = await request(app).post('/api/timers/presets').send({ name: 'Deep Work', work_minutes: 50, break_minutes: 10 })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Deep Work')
  })

  it('rejects invalid preset', async () => {
    const res = await request(app).post('/api/timers/presets').send({ name: '', work_minutes: 25, break_minutes: 5 })
    expect(res.status).toBe(400)
  })
})

// AC2 — start session, singleton enforcement
describe('AC2 — start session', () => {
  it('starts a session from a preset', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const res = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('active')
    expect(res.body.preset_name).toBe('Pomodoro')
  })

  it('rejects second start when session in progress', async () => {
    const presets = await request(app).get('/api/timers/presets')
    await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    const res = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already in progress/)
  })
})

// AC3 — pause
describe('AC3 — pause session', () => {
  it('pauses an active session', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    const res = await request(app).post(`/api/timers/sessions/${started.body.id}/pause`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('paused')
  })

  it('rejects pausing a paused session', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${started.body.id}/pause`)
    const res = await request(app).post(`/api/timers/sessions/${started.body.id}/pause`)
    expect(res.status).toBe(409)
  })
})

// AC4 — resume
describe('AC4 — resume session', () => {
  it('resumes a paused session', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${started.body.id}/pause`)
    const res = await request(app).post(`/api/timers/sessions/${started.body.id}/resume`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('active')
    expect(res.body.paused_at).toBeNull()
  })

  it('rejects resuming an active session', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    const res = await request(app).post(`/api/timers/sessions/${started.body.id}/resume`)
    expect(res.status).toBe(409)
  })
})

// AC5 — complete
describe('AC5 — complete session', () => {
  it('completes a session', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    const res = await request(app).post(`/api/timers/sessions/${started.body.id}/complete`).send({ notes: 'Good focus' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('completed')
    expect(res.body.ended_at).not.toBeNull()
    expect(res.body.notes).toBe('Good focus')
  })

  it('rejects completing already-completed session', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${started.body.id}/complete`)
    const res = await request(app).post(`/api/timers/sessions/${started.body.id}/complete`)
    expect(res.status).toBe(409)
  })
})

// AC6 — cancel
describe('AC6 — cancel session', () => {
  it('cancels a session', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const started = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    const res = await request(app).post(`/api/timers/sessions/${started.body.id}/cancel`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('cancelled')
  })

  it('allows starting a new session after cancel', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const s1 = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${s1.body.id}/cancel`)
    const s2 = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    expect(s2.status).toBe(201)
  })
})

// AC7 — list sessions
describe('AC7 — list sessions', () => {
  it('lists completed sessions by default', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const s = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${s.body.id}/complete`)
    const s2 = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${s2.body.id}/cancel`)
    const res = await request(app).get('/api/timers/sessions')
    expect(res.body).toHaveLength(1)
    expect(res.body[0].status).toBe('completed')
  })

  it('filters by status=cancelled', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const s = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${s.body.id}/cancel`)
    const res = await request(app).get('/api/timers/sessions?status=cancelled')
    expect(res.body).toHaveLength(1)
  })
})

// AC8 — report summary hook
describe('AC8 — summary report hook', () => {
  it('exports summary hook', async () => {
    const { reportHooks } = await import('../../src/hooks/reports.js')
    expect(reportHooks.summary).toBeTypeOf('function')
  })

  it('summary returns correct keys', async () => {
    const { reportHooks } = await import('../../src/hooks/reports.js')
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
    db.prepare(`INSERT INTO users VALUES (1,'a@b.com')`).run()
    const modDb = { prepare: db.prepare.bind(db), exec: (s: string) => db.exec(s), transaction: (fn: () => unknown) => { const t = db.transaction(fn); return t() }, raw: db }
    migrate(modDb as any)
    const ctx = { db: modDb } as any
    const summary = reportHooks.summary!(ctx, 1)
    expect(summary).toHaveProperty('Sessions today')
    expect(summary).toHaveProperty('Focus minutes today')
    expect(summary).toHaveProperty('Sessions this week')
    expect(summary).toHaveProperty('Focus minutes this week')
  })
})

// AC9 — nav badge
describe('AC9 — nav badge counts completed sessions today', () => {
  it('GET /reports/daily returns session count', async () => {
    const presets = await request(app).get('/api/timers/presets')
    const s = await request(app).post('/api/timers/sessions/start').send({ preset_id: presets.body[0].id })
    await request(app).post(`/api/timers/sessions/${s.body.id}/complete`)
    const res = await request(app).get('/api/timers/reports/daily')
    expect(res.status).toBe(200)
    expect(res.body.sessions).toBe(1)
  })
})

// AC10 — frontend endpoint
describe('AC10 — frontend', () => {
  it('GET /ui.js returns JS content type', async () => {
    const res = await request(app).get('/api/timers/ui.js')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/javascript/)
  })

  it('GET /sessions/active returns null when no session', async () => {
    const res = await request(app).get('/api/timers/sessions/active')
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })
})
