import type { ModuleContext }         from '@mosaic/sdk'
import { trace, metrics, SpanStatusCode } from '@opentelemetry/api'

const tracer        = trace.getTracer('timers')
const meter         = metrics.getMeter('timers')
const pushCounter   = meter.createCounter('timers.pomodoro_push.fired_total',    { description: 'Push notifications sent for expired Pomodoro sessions' })
const durationHist  = meter.createHistogram('timers.pomodoro_push.job_duration_ms', { unit: 'ms' })

interface ExpiredSession {
  id:           number
  user_id:      number
  work_minutes: number
  ends_at:      string
}

export async function pomodoroPushJob(ctx: ModuleContext): Promise<void> {
  return tracer.startActiveSpan('timers.pomodoro_push.run', async span => {
    const now     = new Date().toISOString().slice(0, 19)
    const startMs = Date.now()

    ctx.logger.debug('timers:pomodoro-push tick', { now })

    const expired = ctx.db.raw.prepare(`
      SELECT id, user_id, work_minutes, ends_at
      FROM   timers_sessions
      WHERE  status       = 'active'
        AND  ends_at      IS NOT NULL
        AND  ends_at      <= ?
        AND  push_sent_at IS NULL
    `).all(now) as ExpiredSession[]

    const stmtClaim = ctx.db.raw.prepare(
      `UPDATE timers_sessions SET push_sent_at = 'PENDING' WHERE id = ? AND push_sent_at IS NULL`
    )
    const stmtStamp = ctx.db.raw.prepare(
      `UPDATE timers_sessions SET push_sent_at = ? WHERE id = ?`
    )

    for (const session of expired) {
      // Pre-claim atomically — prevents double-fire if process crashes after push but before stamp
      stmtClaim.run(session.id)

      try {
        await ctx.notify.push(session.user_id, {
          title: 'Pomodoro complete',
          body:  `Your ${session.work_minutes}-minute work period has ended. Time for a break.`,
          url:   '/#timers',
        })

        stmtStamp.run(now, session.id)

        ctx.logger.info('timers:pomodoro-push sent', {
          session_id: session.id,
          user_id:    session.user_id,
          ends_at:    session.ends_at,
        })
        pushCounter.add(1, { result: 'success' })
      } catch (err) {
        // Leave push_sent_at = 'PENDING' — missed notification is safer than double-fire on retry
        ctx.logger.error('timers:pomodoro-push failed', err as Error, {
          session_id: session.id,
          user_id:    session.user_id,
        })
        pushCounter.add(1, { result: 'error' })
      }
    }

    const durationMs = Date.now() - startMs
    durationHist.record(durationMs)
    ctx.logger.debug('timers:pomodoro-push done', { sessions_processed: expired.length, duration_ms: durationMs })
    span.setStatus({ code: SpanStatusCode.OK })
    span.end()
  })
}
