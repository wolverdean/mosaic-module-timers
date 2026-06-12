import type { Database } from 'better-sqlite3'

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
