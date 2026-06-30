import type { Database }        from 'better-sqlite3'
import type { DetailedReport } from '@mosaic/sdk'

export interface SessionSummary {
  sessions:      number
  focus_minutes: number
}

export function getDailySummary(db: Database, userId: number, date: string): SessionSummary {
  const row = db.prepare(`
    SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_seconds), 0) AS total_seconds
    FROM timers_sessions
    WHERE user_id = ? AND status = 'completed' AND DATE(started_at) = ?
  `).get(userId, date) as { sessions: number; total_seconds: number }

  return {
    sessions:      row.sessions,
    focus_minutes: Math.floor(row.total_seconds / 60),
  }
}

export function getWeeklySummary(db: Database, userId: number, start: string, end: string): SessionSummary {
  const row = db.prepare(`
    SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_seconds), 0) AS total_seconds
    FROM timers_sessions
    WHERE user_id = ? AND status = 'completed'
      AND DATE(started_at) >= ? AND DATE(started_at) <= ?
  `).get(userId, start, end) as { sessions: number; total_seconds: number }

  return {
    sessions:      row.sessions,
    focus_minutes: Math.floor(row.total_seconds / 60),
  }
}

export function getDetailedTimersReport(db: Database, userId: number, start: string, end: string): DetailedReport {
  const totals = db.prepare(`
    SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_seconds), 0) AS total_seconds
    FROM timers_sessions
    WHERE user_id = ? AND status = 'completed'
      AND DATE(started_at) >= ? AND DATE(started_at) <= ?
  `).get(userId, start, end) as { sessions: number; total_seconds: number }

  const byPreset = db.prepare(`
    SELECT COALESCE(NULLIF(preset_name,''), 'Custom') AS preset,
           COUNT(*) AS sessions,
           COALESCE(SUM(duration_seconds), 0) AS total_seconds
    FROM timers_sessions
    WHERE user_id = ? AND status = 'completed'
      AND DATE(started_at) >= ? AND DATE(started_at) <= ?
    GROUP BY preset_name
    ORDER BY sessions DESC
  `).all(userId, start, end) as { preset: string; sessions: number; total_seconds: number }[]

  const sessions = db.prepare(`
    SELECT id, COALESCE(NULLIF(preset_name,''), 'Custom') AS preset_name,
           work_minutes, duration_seconds, notes, DATE(started_at) AS date
    FROM timers_sessions
    WHERE user_id = ? AND status = 'completed'
      AND DATE(started_at) >= ? AND DATE(started_at) <= ?
    ORDER BY started_at DESC
    LIMIT 50
  `).all(userId, start, end) as { id: number; preset_name: string; work_minutes: number; duration_seconds: number; notes: string; date: string }[]

  return {
    label: 'Timers',
    sections: [
      {
        type:  'kv',
        title: 'Summary',
        rows:  { Sessions: totals.sessions, 'Focus minutes': Math.floor(totals.total_seconds / 60) },
      },
      {
        type:  'table',
        title: 'By Preset',
        cols:  ['Preset', 'Sessions', 'Minutes'],
        rows:  byPreset.map(r => [r.preset, r.sessions, Math.floor(r.total_seconds / 60)]),
      },
      {
        type:  'list',
        title: 'Sessions',
        items: sessions.map(r => ({
          id:      r.id,
          title:   `${r.preset_name} · ${Math.floor(r.duration_seconds / 60)} min${r.notes ? ` — ${r.notes}` : ''}`,
          dueDate: r.date,
          url:     '/#timers',
        })),
      },
    ],
  }
}
