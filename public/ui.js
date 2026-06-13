;(function () {
  'use strict'

  // ─── State ─────────────────────────────────────────────────────────────────

  let shell
  let container
  let presets     = []
  let activeSession = null
  let todaySessions = []
  let tickInterval  = null

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function pad(n) { return String(n).padStart(2, '0') }

  function fmtSeconds(s) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${pad(m)}:${pad(sec)}`
  }

  function fmtTime(iso) {
    if (!iso) return ''
    const d = toUtcDate(iso)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function fmtDuration(seconds) {
    if (seconds < 60) return `${seconds}s`
    return `${Math.round(seconds / 60)}m`
  }

  function playSound(filename) {
    new Audio(`/sounds/${filename}`).play().catch(() => {})
  }

  function toUtcDate(s) {
    // Timestamps are stored as UTC but without a timezone suffix —
    // either 'YYYY-MM-DD HH:MM:SS' (SQLite) or 'YYYY-MM-DDTHH:MM:SS' (JS ISO).
    // Without an explicit Z, browsers parse them as local time.
    // Always append Z so they're correctly treated as UTC.
    if (!s) return new Date(0)
    const n = s.replace(' ', 'T')
    return new Date(n.endsWith('Z') ? n : n + 'Z')
  }

  function getLiveElapsed(session) {
    if (!session) return 0
    let elapsed = session.duration_seconds
    if (session.status === 'active') {
      elapsed += Math.floor((Date.now() - toUtcDate(session.last_active_start).getTime()) / 1000)
    }
    return elapsed
  }

  function getRemainingSeconds(session) {
    const total = (session.work_minutes || 25) * 60
    return Math.max(0, total - getLiveElapsed(session))
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  function render() {
    container.innerHTML = `
      <style>
        .timers-wrap { max-width:640px; margin:0 auto; padding:20px; font-family:system-ui,sans-serif; }
        .timer-card { background:#fff; border:1px solid #e5e7eb; border-radius:16px; padding:32px; text-align:center; margin-bottom:20px; }
        .timer-preset-name { font-size:13px; color:#6b7280; font-weight:500; letter-spacing:.05em; text-transform:uppercase; margin-bottom:12px; }
        .timer-countdown { font-size:80px; font-weight:700; color:#111827; font-variant-numeric:tabular-nums; line-height:1; margin-bottom:8px; }
        .timer-countdown.urgent { color:#dc2626; }
        .timer-work-label { font-size:13px; color:#9ca3af; margin-bottom:24px; }
        .timer-controls { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
        .timer-btn { padding:10px 22px; border-radius:10px; border:none; cursor:pointer; font-size:15px; font-weight:600; transition:opacity .15s; }
        .timer-btn:hover { opacity:.85; }
        .btn-start    { background:#6366f1; color:#fff; }
        .btn-pause    { background:#f59e0b; color:#fff; }
        .btn-resume   { background:#10b981; color:#fff; }
        .btn-complete { background:#6366f1; color:#fff; }
        .btn-cancel   { background:#f3f4f6; color:#6b7280; }
        .preset-row { display:flex; gap:10px; align-items:center; justify-content:center; margin-bottom:16px; }
        .preset-select { padding:8px 12px; border:1px solid #d1d5db; border-radius:8px; font-size:14px; background:#fff; }
        .status-badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:600; }
        .badge-active { background:#dcfce7; color:#166534; }
        .badge-paused { background:#fef3c7; color:#92400e; }
        .section-title { font-size:14px; font-weight:600; color:#374151; margin:0 0 10px; }
        .history-list { display:flex; flex-direction:column; gap:8px; }
        .history-item { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:12px 16px; display:flex; align-items:center; gap:12px; }
        .history-icon { font-size:20px; }
        .history-info { flex:1; }
        .history-name { font-weight:500; font-size:14px; color:#111827; }
        .history-meta { font-size:12px; color:#9ca3af; }
        .history-dur  { font-weight:600; font-size:14px; color:#6366f1; }
        .empty-history { text-align:center; color:#9ca3af; padding:24px; font-size:14px; }
      </style>
      <div class="timers-wrap">
        ${activeSession ? renderActive() : renderStart()}
        <div>
          <div class="section-title">Today's sessions</div>
          ${todaySessions.length === 0
            ? `<div class="empty-history">No completed sessions yet today</div>`
            : `<div class="history-list">${todaySessions.map(renderHistoryItem).join('')}</div>`}
        </div>
      </div>
    `
    attachHandlers()
  }

  function renderActive() {
    const s   = activeSession
    const rem = getRemainingSeconds(s)
    const urgent = rem < 60 && s.status === 'active'
    const isPaused = s.status === 'paused'

    return `
      <div class="timer-card">
        <div class="timer-preset-name">${s.preset_name}</div>
        <div class="timer-countdown ${urgent ? 'urgent' : ''}" id="timer-countdown">
          ${fmtSeconds(rem)}
        </div>
        <div class="timer-work-label">
          ${s.work_minutes} min focus ·
          <span class="status-badge ${isPaused ? 'badge-paused' : 'badge-active'}">
            ${isPaused ? 'Paused' : 'Running'}
          </span>
        </div>
        <div class="timer-controls">
          ${isPaused
            ? `<button class="timer-btn btn-resume" id="btn-resume">Resume</button>`
            : `<button class="timer-btn btn-pause"  id="btn-pause">Pause</button>`}
          <button class="timer-btn btn-complete" id="btn-complete">Complete</button>
          <button class="timer-btn btn-cancel"   id="btn-cancel">Cancel</button>
        </div>
      </div>
    `
  }

  function renderStart() {
    const options = presets.map(p =>
      `<option value="${p.id}">${p.name} (${p.work_minutes}m / ${p.break_minutes}m break)</option>`
    ).join('')

    return `
      <div class="timer-card">
        <div class="timer-countdown" style="color:#9ca3af">--:--</div>
        <div class="timer-work-label">Ready to focus</div>
        <div class="preset-row">
          <select class="preset-select" id="preset-select">${options}</select>
          <button class="timer-btn btn-cancel" id="btn-edit-presets" style="font-size:13px;padding:8px 14px">Edit</button>
        </div>
        <div class="timer-controls">
          <button class="timer-btn btn-start" id="btn-start">Start</button>
        </div>
      </div>
    `
  }

  function renderHistoryItem(s) {
    return `
      <div class="history-item">
        <div class="history-icon">🍅</div>
        <div class="history-info">
          <div class="history-name">${s.preset_name}</div>
          <div class="history-meta">${fmtTime(s.started_at)}${s.notes ? ' · ' + s.notes : ''}</div>
        </div>
        <div class="history-dur">${fmtDuration(s.duration_seconds)}</div>
      </div>
    `
  }

  // ─── Live tick ─────────────────────────────────────────────────────────────

  function startTick() {
    stopTick()
    if (!activeSession || activeSession.status !== 'active') return
    tickInterval = setInterval(() => {
      const countdown = document.getElementById('timer-countdown')
      if (!countdown) { stopTick(); return }
      const rem = getRemainingSeconds(activeSession)
      countdown.textContent = fmtSeconds(rem)
      if (rem < 60) countdown.classList.add('urgent')
    }, 1000)
  }

  function stopTick() {
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null }
  }

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function attachHandlers() {
    const btnStart = document.getElementById('btn-start')
    if (btnStart) {
      btnStart.addEventListener('click', async () => {
        const select = document.getElementById('preset-select')
        const presetId = select ? select.value : (presets[0]?.id)
        if (!presetId) return
        playSound('hi-bowl.mp3')
        activeSession = await shell.api.post('/sessions/start', { preset_id: Number(presetId) })
        render()
        startTick()
      })
    }

    const btnEditPresets = document.getElementById('btn-edit-presets')
    if (btnEditPresets) {
      btnEditPresets.addEventListener('click', () => showPresets())
    }

    const btnPause = document.getElementById('btn-pause')
    if (btnPause) {
      btnPause.addEventListener('click', async () => {
        activeSession = await shell.api.post(`/sessions/${activeSession.id}/pause`, {})
        stopTick()
        render()
      })
    }

    const btnResume = document.getElementById('btn-resume')
    if (btnResume) {
      btnResume.addEventListener('click', async () => {
        activeSession = await shell.api.post(`/sessions/${activeSession.id}/resume`, {})
        render()
        startTick()
      })
    }

    const btnComplete = document.getElementById('btn-complete')
    if (btnComplete) {
      btnComplete.addEventListener('click', async () => {
        stopTick()
        playSound('med-bowl.mp3')
        await shell.api.post(`/sessions/${activeSession.id}/complete`, {})
        activeSession = null
        await loadData()
      })
    }

    const btnCancel = document.getElementById('btn-cancel')
    if (btnCancel) {
      btnCancel.addEventListener('click', async () => {
        if (!confirm('Cancel this session?')) return
        stopTick()
        await shell.api.post(`/sessions/${activeSession.id}/cancel`, {})
        activeSession = null
        render()
      })
    }
  }

  // ─── Data ──────────────────────────────────────────────────────────────────

  async function loadData() {
    const today = new Date().toISOString().slice(0, 10)
    const [presetsData, active, history] = await Promise.all([
      shell.api.get('/presets'),
      shell.api.get('/sessions/active'),
      shell.api.get(`/sessions?date=${today}`),
    ])
    presets       = presetsData
    activeSession = active
    todaySessions = history
    render()
    if (activeSession?.status === 'active') startTick()
  }

  // ─── Preset editor ────────────────────────────────────────────────────────

  function showPresets(editingId) {
    const editing = editingId ? presets.find(p => p.id === editingId) : null

    container.innerHTML = `
      <style>
        .timers-wrap { max-width:640px; margin:0 auto; padding:20px; font-family:system-ui,sans-serif; }
        .timer-btn { padding:10px 22px; border-radius:10px; border:none; cursor:pointer; font-size:15px; font-weight:600; transition:opacity .15s; }
        .timer-btn:hover { opacity:.85; }
        .btn-start  { background:#6366f1; color:#fff; }
        .btn-cancel { background:#f3f4f6; color:#6b7280; }
        .preset-row { display:flex; gap:10px; align-items:center; margin-bottom:10px; }
        .section-title { font-size:14px; font-weight:600; color:#374151; margin:0 0 10px; }
        .preset-item { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:12px 16px; display:flex; align-items:center; gap:10px; margin-bottom:8px; }
        .preset-info { flex:1; }
        .preset-name { font-weight:600; font-size:14px; color:#111827; }
        .preset-meta { font-size:12px; color:#9ca3af; margin-top:2px; }
        .form-group { margin-bottom:14px; }
        .form-label { display:block; font-size:13px; font-weight:500; color:#6b7280; margin-bottom:4px; }
        .form-input { width:100%; padding:8px 12px; border:1px solid #d1d5db; border-radius:8px; font-size:14px; box-sizing:border-box; }
        .form-row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .back-link { background:none; border:none; color:#6366f1; cursor:pointer; font-size:14px; padding:0; margin-bottom:16px; display:inline-block; }
      </style>
      <div class="timers-wrap">
        <button class="back-link" id="presets-back">← Back</button>
        <div class="section-title" style="font-size:16px;margin-bottom:16px">Presets</div>

        <div id="presets-list">
          ${presets.map(p => `
            <div class="preset-item">
              <div class="preset-info">
                <div class="preset-name">${p.name}</div>
                <div class="preset-meta">${p.work_minutes}m work · ${p.break_minutes}m break</div>
              </div>
              <button class="timer-btn btn-cancel preset-edit-btn" data-id="${p.id}" style="font-size:12px;padding:6px 12px">Edit</button>
              <button class="timer-btn btn-cancel preset-del-btn"  data-id="${p.id}" style="font-size:12px;padding:6px 12px;color:#dc2626">Delete</button>
            </div>`).join('')}
        </div>

        <div id="preset-form-wrap" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-top:16px">
          <div class="section-title">${editing ? 'Edit preset' : 'New preset'}</div>
          <div class="form-group">
            <label class="form-label">Name</label>
            <input class="form-input" id="pf-name" value="${editing ? editing.name : ''}" placeholder="e.g. Deep Work">
          </div>
          <div class="form-row2">
            <div class="form-group">
              <label class="form-label">Work (minutes)</label>
              <input class="form-input" id="pf-work" type="number" min="1" max="120" value="${editing ? editing.work_minutes : 25}">
            </div>
            <div class="form-group">
              <label class="form-label">Break (minutes)</label>
              <input class="form-input" id="pf-break" type="number" min="1" max="60" value="${editing ? editing.break_minutes : 5}">
            </div>
          </div>
          <div style="display:flex;gap:10px">
            <button class="timer-btn btn-start" id="pf-save" style="font-size:14px;padding:9px 20px">
              ${editing ? 'Save changes' : 'Add preset'}
            </button>
            ${editing ? `<button class="timer-btn btn-cancel" id="pf-cancel-edit" style="font-size:14px;padding:9px 20px">Cancel</button>` : ''}
          </div>
        </div>
      </div>
    `

    document.getElementById('presets-back').addEventListener('click', () => loadData())

    document.querySelectorAll('.preset-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => showPresets(Number(btn.dataset.id)))
    })

    document.querySelectorAll('.preset-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this preset?')) return
        await shell.api.delete(`/presets/${btn.dataset.id}`)
        presets = await shell.api.get('/presets')
        showPresets()
      })
    })

    const cancelEdit = document.getElementById('pf-cancel-edit')
    if (cancelEdit) cancelEdit.addEventListener('click', () => showPresets())

    document.getElementById('pf-save').addEventListener('click', async () => {
      const name  = document.getElementById('pf-name').value.trim()
      const work  = parseInt(document.getElementById('pf-work').value,  10)
      const brk   = parseInt(document.getElementById('pf-break').value, 10)
      if (!name)           { alert('Name is required'); return }
      if (!(work  > 0))    { alert('Work minutes must be positive'); return }
      if (!(brk   > 0))    { alert('Break minutes must be positive'); return }

      if (editing) {
        await shell.api.put(`/presets/${editing.id}`, { name, work_minutes: work, break_minutes: brk })
      } else {
        await shell.api.post('/presets', { name, work_minutes: work, break_minutes: brk })
      }
      presets = await shell.api.get('/presets')
      showPresets()
    })
  }

  // ─── Module registration ───────────────────────────────────────────────────

  window.Mosaic.registerModule({
    slug: 'timers',

    init(s) {
      shell = s
    },

    onActivate(el) {
      container = el
      loadData()
    },

    onDeactivate() {
      stopTick()
      activeSession = null
      todaySessions = []
    },
  })
})()
