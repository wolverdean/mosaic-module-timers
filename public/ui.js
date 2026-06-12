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
    const d = new Date(iso)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function fmtDuration(seconds) {
    if (seconds < 60) return `${seconds}s`
    return `${Math.round(seconds / 60)}m`
  }

  function getLiveElapsed(session) {
    if (!session) return 0
    let elapsed = session.duration_seconds
    if (session.status === 'active') {
      const activeStart = new Date(session.last_active_start)
      elapsed += Math.floor((Date.now() - activeStart.getTime()) / 1000)
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
        activeSession = await shell.api.post('/sessions/start', { preset_id: Number(presetId) })
        render()
        startTick()
      })
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
