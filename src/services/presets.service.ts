import type { Database } from 'better-sqlite3'

export interface Preset {
  id:            number
  user_id:       number
  name:          string
  work_minutes:  number
  break_minutes: number
  created_at:    string
}

export interface CreatePresetInput {
  name:          string
  work_minutes:  number
  break_minutes: number
}

export function listPresets(db: Database, userId: number): Preset[] {
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM timers_presets WHERE user_id = ?`).get(userId) as { n: number }).n
  if (count === 0) {
    db.prepare(`INSERT INTO timers_presets (user_id, name, work_minutes, break_minutes) VALUES (?, 'Pomodoro', 25, 5)`).run(userId)
  }
  return db.prepare(`SELECT * FROM timers_presets WHERE user_id = ? ORDER BY id ASC`).all(userId) as Preset[]
}

export function getPreset(db: Database, userId: number, id: number): Preset | null {
  return (db.prepare(`SELECT * FROM timers_presets WHERE id = ? AND user_id = ?`).get(id, userId) as Preset | undefined) ?? null
}

export function createPreset(db: Database, userId: number, data: CreatePresetInput): Preset {
  if (!data.name || !data.name.trim()) throw new Error('name is required')
  if (!Number.isInteger(data.work_minutes)  || data.work_minutes  <= 0) throw new Error('work_minutes must be a positive integer')
  if (!Number.isInteger(data.break_minutes) || data.break_minutes <= 0) throw new Error('break_minutes must be a positive integer')

  const result = db.prepare(`
    INSERT INTO timers_presets (user_id, name, work_minutes, break_minutes) VALUES (?, ?, ?, ?)
  `).run(userId, data.name.trim(), data.work_minutes, data.break_minutes)
  return getPreset(db, userId, result.lastInsertRowid as number)!
}

export function updatePreset(db: Database, userId: number, id: number, data: Partial<CreatePresetInput>): Preset | null {
  const existing = getPreset(db, userId, id)
  if (!existing) return null

  if (data.work_minutes  !== undefined && (!Number.isInteger(data.work_minutes)  || data.work_minutes  <= 0)) throw new Error('work_minutes must be a positive integer')
  if (data.break_minutes !== undefined && (!Number.isInteger(data.break_minutes) || data.break_minutes <= 0)) throw new Error('break_minutes must be a positive integer')

  db.prepare(`
    UPDATE timers_presets SET name = ?, work_minutes = ?, break_minutes = ?
    WHERE id = ? AND user_id = ?
  `).run(
    data.name          ?? existing.name,
    data.work_minutes  ?? existing.work_minutes,
    data.break_minutes ?? existing.break_minutes,
    id, userId,
  )
  return getPreset(db, userId, id)
}

export function deletePreset(db: Database, userId: number, id: number): void {
  const existing = getPreset(db, userId, id)
  if (!existing) return

  const sessions = (db.prepare(`
    SELECT COUNT(*) AS n FROM timers_sessions WHERE preset_id = ? AND status = 'completed'
  `).get(id) as { n: number }).n
  if (sessions > 0) throw new Error('preset has completed sessions')

  db.prepare(`DELETE FROM timers_presets WHERE id = ? AND user_id = ?`).run(id, userId)
}
