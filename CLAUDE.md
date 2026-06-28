# CLAUDE.md — mosaic-module-timers

This file is loaded automatically by Claude Code when you open this module directory.
This module uses the **Feature Factory** pipeline. Feature Factory is already installed in `.claude/`.

---

## Module Identity

| Field | Value |
|-------|-------|
| **Slug** | `timers` |
| **Package** | `mosaic-module-timers` |
| **Purpose** | Pomodoro-style focus timer module for Mosaic — sessions, presets, daily focus reports |
| **Framework** | `/opt/CODE/mosaic-framework` |
| **API mount** | `/api/timers/` |
| **DB prefix** | `timers_` (e.g., `timers_sessions`) |

---

## The Pipeline

Feature Factory agents, skills, and hooks are installed in `.claude/`. The full pipeline applies — see `.claude/skills/feature-factory-orchestration.md`.

```
[Researcher] → [Story Writer] → ⏸ CHECKPOINT 1 → [Spec Writer] → ⏸ CHECKPOINT 2
→ [Backend Builder] → [Frontend Builder] → [Test Verifier] → [Validator] → [Secretary] → ⏸ CHECKPOINT 3
```

---

## Test Runner

**Always run tests from this module directory, not the framework.**

```bash
npx vitest run           # run once
npx vitest               # watch mode
npx vitest --coverage    # with coverage
```

---

## Deploy to Framework

After changes pass local tests and receive Checkpoint 3 approval, use the deploy skill:

See `.claude/skills/deploy-to-framework.md` — it rebuilds the link and restarts PM2.

---

## Framework Integration Contract

### Registry Manifest
`index.ts` must export a default object with:

```typescript
export default {
  slug: 'timers',
  name: 'Timers',
  version: '1.x.x',
  router,          // Express Router — mounted at /api/timers/
  migrate(db),     // idempotent — runs at framework startup
  jobs: [],        // { cron: string, handler: () => void }[]
  hooks: {},       // getWeekly?(), getMonthly?(), etc.
  frontend: {},    // { scripts: string[] }
}
```

### Auth
Every route must use `requireAuth`. The framework sets `req.userId` after auth.

```typescript
import requireAuth from '../../mosaic-framework/middleware/requireAuth'
```

Two auth modes the framework accepts:
- Session cookie (`req.session.userId`)
- Bearer token (`Authorization: Bearer <token>`)

### Database
- `better-sqlite3` — **synchronous API, no `await`**
- WAL mode + foreign keys already enabled by the framework
- Table names: `timers_<table>` (e.g., `timers_sessions`, `timers_presets`)
- Migration pattern: inline in `migrate(db)`:
  - New tables: `CREATE TABLE IF NOT EXISTS`
  - New columns: check with `db.pragma('table_info(timers_<table>)')`, then `ALTER TABLE ADD COLUMN`
  - **No migration framework — do not invent one**
- Parameterized queries only — no string interpolation in SQL

---

## Non-Negotiable Rules

1. **Never modify framework files from this repo.** If the framework needs a change, open `/opt/CODE/mosaic-framework/` in Claude Code.
2. **Never hardcode secrets.** Env vars only.
3. **Never skip tests.** TDD: write the failing test first.
4. **Never string-interpolate SQL.** Parameterized queries via `better-sqlite3` prepared statements only.
5. **Never skip observability.** Every feature ships with OTel logs, RED metrics, and traces. See `.claude/skills/observability-otel.md`.
6. **Never swallow exceptions.** Log with context. Never expose stack traces to API clients.
7. **Spec determines scope.** If it isn't in the approved brief, stop and ask.
8. **Read before writing.** Every builder reads relevant existing files before producing new ones.
9. **Validator CRITICAL findings block the PR.** Loop back to the relevant builder.
10. **Never skip the test baseline on fixes.** Run full test suite before and after any fix.
11. **Never invent API contracts.** Read the actual source files before assuming anything.

---

## Boundary Rules

| Direction | Rule |
|-----------|------|
| This module → Framework | Read framework source to understand contracts. Never write to framework files. |
| Framework → This module | Framework project redirects all module modification requests here. |

---

## Key Files

| Path | Purpose |
|------|---------|
| `index.ts` | Module manifest — slug, router, migrate, jobs, hooks, frontend |
| `src/routes.ts` (or similar) | Express router — all routes call `requireAuth` |
| `src/db.ts` (or similar) | `migrate()` function — idempotent schema setup |
| `tests/unit/` | Backend Builder owns |
| `tests/component/` | Frontend Builder owns |
| `tests/acceptance/` | Test Verifier owns |
| `public/` | Module frontend — no build step, inline JS/CSS |
| `LOG.md` | Validator appends after every pipeline run — read at start of new feature |
| `.claude/skills/deploy-to-framework.md` | Deploy this module to production |
