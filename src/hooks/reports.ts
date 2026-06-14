import type { ReportHooks, ReportSummary, ModuleContext } from '@mosaic/sdk'
import { getDailySummary, getWeeklySummary, getDetailedTimersReport } from '../services/reports.service.js'

export const reportHooks: ReportHooks = {
  summary(ctx: ModuleContext, userId: number): ReportSummary {
    const db    = ctx.db.raw
    const today = new Date().toISOString().slice(0, 10)

    const d = new Date()
    const day  = d.getUTCDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() + diff)
    const sunday = new Date(monday)
    sunday.setUTCDate(monday.getUTCDate() + 6)
    const weekStart = monday.toISOString().slice(0, 10)
    const weekEnd   = sunday.toISOString().slice(0, 10)

    const daily  = getDailySummary(db, userId, today)
    const weekly = getWeeklySummary(db, userId, weekStart, weekEnd)

    return {
      'Sessions today':        daily.sessions,
      'Focus minutes today':   daily.focus_minutes,
      'Sessions this week':    weekly.sessions,
      'Focus minutes this week': weekly.focus_minutes,
    }
  },
  detailed(ctx: ModuleContext, userId: number, start: string, end: string) {
    return getDetailedTimersReport(ctx.db.raw, userId, start, end)
  },
}
