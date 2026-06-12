import { defineModule }     from '@mosaic/sdk'
import type { ModuleContext } from '@mosaic/sdk'
import { metrics }           from '@opentelemetry/api'
import { migrate }           from './src/migrate.js'
import { createRouter }      from './src/routes/index.js'
import { reportHooks }       from './src/hooks/reports.js'
import { getDailySummary }   from './src/services/reports.service.js'

const meter = metrics.getMeter('timers')
const _runs = meter.createCounter('timers.jobs.runs_total')

const ctxRef: { current: ModuleContext | null } = { current: null }
const router = createRouter(ctxRef)

export default defineModule({
  name:    'Timers',
  slug:    'timers',
  version: '1.0.0',
  sdk:     '>=1.0.0',

  migrate,
  router,

  nav: {
    label: 'Timers',
    icon:  'clock',
    order: 50,
    badge(ctx: ModuleContext, userId: number) {
      try {
        const today = new Date().toISOString().slice(0, 10)
        return getDailySummary(ctx.db.raw, userId, today).sessions
      } catch { return 0 }
    },
  },

  frontend: { entry: '/api/timers/ui.js' },

  reports: reportHooks,

  async onInit(ctx: ModuleContext) {
    ctxRef.current = ctx
    ctx.logger.info('Timers module initialised')
  },

  async health(ctx: ModuleContext) {
    ctx.db.raw.prepare('SELECT 1 FROM timers_sessions LIMIT 1').get()
    return { status: 'ok' as const }
  },
  healthInterval: 120,
})
