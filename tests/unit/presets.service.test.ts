import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import {
  listPresets, createPreset, updatePreset, deletePreset,
} from '../../src/services/presets.service.js'

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
  db.prepare(`INSERT INTO users VALUES (1,'a@b.com')`).run()
  db.prepare(`INSERT INTO users VALUES (2,'b@b.com')`).run()
  migrate({ exec: (sql: string) => db.exec(sql), prepare: db.prepare.bind(db), transaction: (fn: () => unknown) => { const t = db.transaction(fn); return t() }, raw: db } as any)
  return db
}

let db: ReturnType<typeof makeDb>
beforeEach(() => { db = makeDb() })

describe('listPresets', () => {
  it('seeds a default Pomodoro preset for new user', () => {
    const list = listPresets(db, 1)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Pomodoro')
    expect(list[0].work_minutes).toBe(25)
    expect(list[0].break_minutes).toBe(5)
  })

  it('does not re-seed if presets already exist', () => {
    listPresets(db, 1)
    listPresets(db, 1)
    expect(listPresets(db, 1)).toHaveLength(1)
  })

  it('isolates presets by user', () => {
    listPresets(db, 1)
    listPresets(db, 2)
    expect(listPresets(db, 1)).toHaveLength(1)
    expect(listPresets(db, 2)).toHaveLength(1)
  })
})

describe('createPreset', () => {
  it('creates a preset with valid fields', () => {
    const p = createPreset(db, 1, { name: 'Deep Work', work_minutes: 50, break_minutes: 10 })
    expect(p.id).toBeTypeOf('number')
    expect(p.name).toBe('Deep Work')
    expect(p.work_minutes).toBe(50)
    expect(p.break_minutes).toBe(10)
  })

  it('throws if name is empty', () => {
    expect(() => createPreset(db, 1, { name: '', work_minutes: 25, break_minutes: 5 }))
      .toThrow('name is required')
  })

  it('throws if work_minutes is not positive', () => {
    expect(() => createPreset(db, 1, { name: 'Bad', work_minutes: 0, break_minutes: 5 }))
      .toThrow('work_minutes must be a positive integer')
    expect(() => createPreset(db, 1, { name: 'Bad', work_minutes: -1, break_minutes: 5 }))
      .toThrow('work_minutes must be a positive integer')
  })

  it('throws if break_minutes is not positive', () => {
    expect(() => createPreset(db, 1, { name: 'Bad', work_minutes: 25, break_minutes: 0 }))
      .toThrow('break_minutes must be a positive integer')
  })
})

describe('updatePreset', () => {
  it('updates preset fields', () => {
    const p = createPreset(db, 1, { name: 'Old', work_minutes: 25, break_minutes: 5 })
    const updated = updatePreset(db, 1, p.id, { name: 'New', work_minutes: 45 })
    expect(updated?.name).toBe('New')
    expect(updated?.work_minutes).toBe(45)
    expect(updated?.break_minutes).toBe(5)
  })

  it('returns null for wrong user', () => {
    const p = createPreset(db, 1, { name: 'Mine', work_minutes: 25, break_minutes: 5 })
    expect(updatePreset(db, 2, p.id, { name: 'Stolen' })).toBeNull()
  })

  it('returns null for missing preset', () => {
    expect(updatePreset(db, 1, 9999, { name: 'Ghost' })).toBeNull()
  })
})

describe('deletePreset', () => {
  it('deletes a preset with no completed sessions', () => {
    const p = createPreset(db, 1, { name: 'Temp', work_minutes: 25, break_minutes: 5 })
    deletePreset(db, 1, p.id)
    expect(listPresets(db, 1).find(x => x.id === p.id)).toBeUndefined()
  })

  it('throws if preset has completed sessions', () => {
    const p = createPreset(db, 1, { name: 'Used', work_minutes: 25, break_minutes: 5 })
    db.prepare(`
      INSERT INTO timers_sessions (user_id, preset_id, preset_name, work_minutes, status, duration_seconds, last_active_start)
      VALUES (1, ?, 'Used', 25, 'completed', 1500, datetime('now'))
    `).run(p.id)
    expect(() => deletePreset(db, 1, p.id)).toThrow('preset has completed sessions')
  })

  it('returns silently for missing preset', () => {
    expect(() => deletePreset(db, 1, 9999)).not.toThrow()
  })
})
