import type { Database } from 'better-sqlite3'
import { getPreset } from './presets.service.js'

export interface Session {
  id:               number
  user_id:          number
  preset_id:        number | null
  preset_name:      string
  work_minutes:     number
  status:           'active' | 'paused' | 'completed' | 'cancelled'
  started_at:       string
  ended_at:         string | null
  last_active_start: string
  paused_at:        string | null
  duration_seconds: number
  notes:            string
  created_at:       string
}

function secondsBetween(from: string, to: string): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000))
}

function getSession(db: Database, userId: number, id: number): Session | null {
  return (db.prepare(`SELECT * FROM timers_sessions WHERE id = ? AND user_id = ?`).get(id, userId) as Session | undefined) ?? null
}

export function getActiveSession(db: Database, userId: number): Session | null {
  return (db.prepare(`
    SELECT * FROM timers_sessions WHERE user_id = ? AND status IN ('active','paused')
  `).get(userId) as Session | undefined) ?? null
}

export function startSession(db: Database, userId: number, presetId: number, now = new Date().toISOString().slice(0, 19)): Session {
  const existing = getActiveSession(db, userId)
  if (existing) throw new Error('session already in progress')

  const preset = getPreset(db, userId, presetId)
  if (!preset) throw new Error('preset not found')

  const result = db.prepare(`
    INSERT INTO timers_sessions
      (user_id, preset_id, preset_name, work_minutes, status, started_at, last_active_start, duration_seconds)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 0)
  `).run(userId, presetId, preset.name, preset.work_minutes, now, now)

  return getSession(db, userId, result.lastInsertRowid as number)!
}

export function pauseSession(db: Database, userId: number, id: number, now = new Date().toISOString().slice(0, 19)): Session | null {
  const session = getSession(db, userId, id)
  if (!session) return null
  if (session.status !== 'active') throw new Error('session not active')

  const elapsed = secondsBetween(session.last_active_start, now)
  db.prepare(`
    UPDATE timers_sessions
    SET status = 'paused', paused_at = ?, duration_seconds = duration_seconds + ?
    WHERE id = ? AND user_id = ?
  `).run(now, elapsed, id, userId)

  return getSession(db, userId, id)!
}

export function resumeSession(db: Database, userId: number, id: number, now = new Date().toISOString().slice(0, 19)): Session | null {
  const session = getSession(db, userId, id)
  if (!session) return null
  if (session.status !== 'paused') throw new Error('session not paused')

  db.prepare(`
    UPDATE timers_sessions
    SET status = 'active', paused_at = NULL, last_active_start = ?
    WHERE id = ? AND user_id = ?
  `).run(now, id, userId)

  return getSession(db, userId, id)!
}

export function completeSession(db: Database, userId: number, id: number, now = new Date().toISOString().slice(0, 19), notes?: string): Session | null {
  const session = getSession(db, userId, id)
  if (!session) return null
  if (session.status !== 'active' && session.status !== 'paused') throw new Error('session not in progress')

  const extraElapsed = session.status === 'active'
    ? secondsBetween(session.last_active_start, now)
    : 0

  db.prepare(`
    UPDATE timers_sessions
    SET status = 'completed', ended_at = ?, duration_seconds = duration_seconds + ?,
        notes = COALESCE(?, notes)
    WHERE id = ? AND user_id = ?
  `).run(now, extraElapsed, notes ?? null, id, userId)

  return getSession(db, userId, id)!
}

export function cancelSession(db: Database, userId: number, id: number, now = new Date().toISOString().slice(0, 19)): Session | null {
  const session = getSession(db, userId, id)
  if (!session) return null
  if (session.status !== 'active' && session.status !== 'paused') throw new Error('session not in progress')

  db.prepare(`
    UPDATE timers_sessions SET status = 'cancelled', ended_at = ? WHERE id = ? AND user_id = ?
  `).run(now, id, userId)

  return getSession(db, userId, id)!
}

export function listSessions(
  db: Database,
  userId: number,
  opts: { date?: string; month?: string; status?: string },
): Session[] {
  const status = opts.status ?? 'completed'
  const params: unknown[] = [userId, status]
  let where = `WHERE user_id = ? AND status = ?`

  if (opts.date) {
    where += ` AND DATE(started_at) = ?`
    params.push(opts.date)
  } else if (opts.month) {
    where += ` AND substr(started_at, 1, 7) = ?`
    params.push(opts.month)
  }

  return db.prepare(`SELECT * FROM timers_sessions ${where} ORDER BY started_at DESC`).all(...params) as Session[]
}
