import { Router }                         from 'express'
import { trace, metrics, SpanStatusCode } from '@opentelemetry/api'
import type { ModuleContext }              from '@mosaic/sdk'
import fs                                 from 'node:fs'
import path                               from 'node:path'
import {
  listPresets, createPreset, updatePreset, deletePreset,
} from '../services/presets.service.js'
import {
  startSession, pauseSession, resumeSession,
  completeSession, cancelSession, getActiveSession, listSessions,
} from '../services/sessions.service.js'
import { getDailySummary } from '../services/reports.service.js'

// ─── OTel ─────────────────────────────────────────────────────────────────────

const tracer       = trace.getTracer('timers')
const meter        = metrics.getMeter('timers')
const reqCounter   = meter.createCounter('timers.requests_total',       { description: 'Timer route requests' })
const reqDuration  = meter.createHistogram('timers.request_duration_ms', { unit: 'ms' })
const sessComplete = meter.createCounter('timers.sessions_completed_total', { description: 'Completed focus sessions' })

function track(op: string, fn: () => void): void {
  const t0 = Date.now()
  tracer.startActiveSpan(`timers.${op}`, span => {
    try {
      fn()
      reqCounter.add(1, { op, status: 'ok' })
      span.setStatus({ code: SpanStatusCode.OK })
    } catch (err) {
      reqCounter.add(1, { op, status: 'error' })
      span.setStatus({ code: SpanStatusCode.ERROR })
      span.recordException(err as Error)
      throw err
    } finally {
      reqDuration.record(Date.now() - t0, { op })
      span.end()
    }
  })
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createRouter(ctxRef: { current: ModuleContext | null }): Router {
  const router = Router()
  const db = () => ctxRef.current!.db.raw

  // ── Presets ────────────────────────────────────────────────────────────────

  router.get('/presets', (req, res) => {
    track('presets.list', () => {
      res.json(listPresets(db(), req.userId))
    })
  })

  router.post('/presets', (req, res) => {
    track('presets.create', () => {
      const { name, work_minutes, break_minutes } = req.body
      try {
        res.status(201).json(createPreset(db(), req.userId, { name, work_minutes, break_minutes }))
      } catch (err: any) {
        res.status(400).json({ error: err.message })
      }
    })
  })

  router.put('/presets/:id', (req, res) => {
    track('presets.update', () => {
      try {
        const updated = updatePreset(db(), req.userId, Number(req.params.id), req.body)
        if (!updated) { res.status(404).json({ error: 'Not found' }); return }
        res.json(updated)
      } catch (err: any) {
        res.status(400).json({ error: err.message })
      }
    })
  })

  router.delete('/presets/:id', (req, res) => {
    track('presets.delete', () => {
      try {
        deletePreset(db(), req.userId, Number(req.params.id))
        res.json({ ok: true })
      } catch (err: any) {
        res.status(409).json({ error: err.message })
      }
    })
  })

  // ── Sessions ───────────────────────────────────────────────────────────────

  router.get('/sessions/active', (req, res) => {
    track('sessions.active', () => {
      res.json(getActiveSession(db(), req.userId))
    })
  })

  router.get('/sessions', (req, res) => {
    track('sessions.list', () => {
      const { date, month, status } = req.query as Record<string, string>
      res.json(listSessions(db(), req.userId, { date, month, status }))
    })
  })

  router.post('/sessions/start', (req, res) => {
    track('sessions.start', () => {
      const { preset_id } = req.body
      if (!preset_id) { res.status(400).json({ error: 'preset_id is required' }); return }
      try {
        res.status(201).json(startSession(db(), req.userId, Number(preset_id)))
      } catch (err: any) {
        const status = err.message === 'session already in progress' ? 409 : 400
        res.status(status).json({ error: err.message })
      }
    })
  })

  router.post('/sessions/:id/pause', (req, res) => {
    track('sessions.pause', () => {
      try {
        const s = pauseSession(db(), req.userId, Number(req.params.id))
        if (!s) { res.status(404).json({ error: 'Not found' }); return }
        res.json(s)
      } catch (err: any) {
        res.status(409).json({ error: err.message })
      }
    })
  })

  router.post('/sessions/:id/resume', (req, res) => {
    track('sessions.resume', () => {
      try {
        const s = resumeSession(db(), req.userId, Number(req.params.id))
        if (!s) { res.status(404).json({ error: 'Not found' }); return }
        res.json(s)
      } catch (err: any) {
        res.status(409).json({ error: err.message })
      }
    })
  })

  router.post('/sessions/:id/complete', (req, res) => {
    track('sessions.complete', () => {
      const { notes } = req.body
      try {
        const s = completeSession(db(), req.userId, Number(req.params.id), undefined, notes)
        if (!s) { res.status(404).json({ error: 'Not found' }); return }
        sessComplete.add(1, { preset: s.preset_name })
        ctxRef.current?.logger.info('session completed', { userId: req.userId, sessionId: s.id, duration_seconds: s.duration_seconds })
        res.json(s)
      } catch (err: any) {
        res.status(409).json({ error: err.message })
      }
    })
  })

  router.post('/sessions/:id/cancel', (req, res) => {
    track('sessions.cancel', () => {
      try {
        const s = cancelSession(db(), req.userId, Number(req.params.id))
        if (!s) { res.status(404).json({ error: 'Not found' }); return }
        res.json(s)
      } catch (err: any) {
        res.status(409).json({ error: err.message })
      }
    })
  })

  // ── Reports ────────────────────────────────────────────────────────────────

  router.get('/reports/daily', (req, res) => {
    track('reports.daily', () => {
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10)
      res.json(getDailySummary(db(), req.userId, date))
    })
  })

  // ── Frontend ───────────────────────────────────────────────────────────────

  router.get('/ui.js', (_req, res) => {
    const uiPath = path.resolve(__dirname, '../../public/ui.js')
    res.setHeader('Content-Type', 'application/javascript')
    res.setHeader('Cache-Control', 'no-cache')
    if (fs.existsSync(uiPath)) {
      res.sendFile(uiPath)
    } else {
      res.send('// timers ui not yet built')
    }
  })

  return router
}
