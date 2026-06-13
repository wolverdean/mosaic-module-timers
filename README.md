# mosaic-module-timers

Pomodoro-style focus timer for the Mosaic framework. Create reusable presets with custom work and break durations, run timer sessions, and review daily focus totals. Session counts appear in the Calendar and contribute to the Reports page.

---

## Features

| Feature | Detail |
|---|---|
| Presets | Reusable templates with configurable work and break durations (in minutes) |
| Sessions | Start, pause, resume, complete, or cancel a Pomodoro cycle |
| Active session tracking | One active session per user at a time |
| Session notes | Add notes when completing a session |
| Daily report | Total focused minutes and session count for any given date |
| Badge | Nav badge shows number of sessions completed today |
| Reports | Daily focus summary contributed to the Reports page |

---

## API

Base path: `/api/timers/`

### Presets

| Method | Path | Description |
|---|---|---|
| `GET` | `/presets` | List presets |
| `POST` | `/presets` | Create preset (`name`, `work_minutes`, `break_minutes`) |
| `PUT` | `/presets/:id` | Update preset |
| `DELETE` | `/presets/:id` | Delete preset |

### Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/sessions/active` | Get the currently active session (if any) |
| `GET` | `/sessions` | List sessions (`date`: `YYYY-MM-DD`, `month`: `YYYY-MM`, `status` filters) |
| `POST` | `/sessions/start` | Start a new session (`preset_id` required) |
| `POST` | `/sessions/:id/pause` | Pause the active session |
| `POST` | `/sessions/:id/resume` | Resume a paused session |
| `POST` | `/sessions/:id/complete` | Complete a session (`notes` optional) |
| `POST` | `/sessions/:id/cancel` | Cancel a session |

### Reports

| Method | Path | Description |
|---|---|---|
| `GET` | `/reports/daily` | Total focused minutes and session count for a date (`date`: `YYYY-MM-DD`) |

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `better-sqlite3` | peer | SQLite driver (provided by framework) |
| `express` | peer | HTTP server (provided by framework) |
| `@opentelemetry/api` | peer | Observability (provided by framework) |

---

## Project structure

```
mosaic-module-timers/
├── index.ts            # Module manifest — slug, nav badge, report hook
├── src/
│   └── routes/
│       └── index.ts    # Timers router + /ui.js
├── public/
│   └── ui.js           # Frontend IIFE — served via GET /api/timers/ui.js
└── tests/
    └── unit/           # Vitest unit tests
```
