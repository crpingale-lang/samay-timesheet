# Focus Timer Module

## Problem statement

Samay already records completed time entries, but users must remember and type the
start and end time after the work is finished. The principal problem is not missing
timesheet fields; it is the lack of a recoverable, low-friction running-work state
that can remain visible while the user works outside Samay.

## Purpose and users

The Focus Timer lets any user with `timesheets.create_own` select an existing client,
work category, and optional note, then start, pause, resume, and end a server-backed
timer. Work classification is derived from the linked client instead of captured again:
a selected client means client work; no client means internal work. On end, Samay creates
one or more ordinary draft timesheet entries for review.

## Design decisions

- The timer is user-initiated. It does not inspect applications, screens, files,
  keyboard activity, or idle state.
- A user can have at most one running session across devices.
- The server timestamp is authoritative. Browser intervals only render elapsed time.
- The current PWA remains the application shell. Desktop Chromium can additionally
  open the timer in a Document Picture-in-Picture always-on-top window.
- The PiP window is optional and never owns timer state. Closing it does not stop or
  lose the server-side session.
- The PiP window is a complete mini workflow: a small searchable input state captures
  client, work, and an optional note; Start auto-collapses it to a translucent live
  banner showing only status and elapsed time. The expanded state shows client, work,
  Pause/Resume, and End. The saved state offers Re-enter, New timer, and Exit.
- Pause and resume are server-authoritative. A paused timestamp plus accumulated paused
  milliseconds keeps recovery accurate across refreshes and devices.
- Completed work continues to use `timesheet_entries` / Firestore `timesheets`, so
  dashboards, approvals, reports, and exports need no parallel reporting path.
- A normal uninterrupted, same-day, non-overlapping timer produces start/end times.
  A timer that was paused is saved as exact active duration without an assumed clock
  window. Overlapping, sub-minute, or cross-midnight captures also use the existing
  safe duration-only draft fallback with a user warning.
- A timer longer than 24 hours is stopped but does not create an assumed draft.
  Samay returns the captured duration and instructs the user to enter corrected time.

## Data classification and lineage

| Data | Classification | Source of truth | Used by | Update path |
| --- | --- | --- | --- | --- |
| Client | Master | `clients` | Timer selection, draft entry, reports | Existing client master screens/APIs |
| Work category | Master | `master_data_options` / `master_data` | Timer selection and draft `task_type` | Existing timesheet master screens/APIs |
| Work classification | Master | `master_data_options` / `master_data` | Billable classification and reporting | Existing timesheet master screens/APIs |
| Active session | Operational state | `time_sessions` | Recovery, pause state, elapsed display, one-active-session invariant | Timer start/pause/resume/stop/discard APIs |
| `paused_at` | Operational state | `time_sessions` | Freezes the live display and closes the current pause interval | Set by Pause; cleared by Resume/End |
| `total_paused_ms` | Operational state | `time_sessions` | Excludes all completed pause intervals from active duration | Reset on Start; accumulated by Resume/End |
| Completed draft | Transaction | `timesheet_entries` / `timesheets` | Log Time, My Work, approvals, dashboards, reports | Created atomically by End, then existing edit/submit APIs |
| Elapsed seconds | Derived | `server_now or paused_at - started_at - total_paused_ms` | Web pill, modal, PiP display | Recalculated; never incremented in storage |

`time_sessions` is justified because an active timer has a different lifecycle from
a completed/draft timesheet. Reusing `timesheet_entries` would create incomplete
records in reports and approvals and would not safely enforce one active session.

## API contracts

All endpoints are mounted below `/api/timer`, require the existing JWT middleware,
and enforce timesheet permissions server-side.

### `GET /active`

- Permission: `timesheets.view_own`
- Response: `{ active: TimeSession | null, server_now: ISODateTime }`
- Returns only the signed-in user's session.

### `POST /start`

- Permission: `timesheets.create_own`
- Body: `client_id`, `task_type`, `work_classification`, optional `description`,
  optional `source`
- Derives classification server-side from the client link, validates linked active
  masters, and prevents a second running or paused session.
- Response: `{ active: TimeSession, server_now: ISODateTime }`
- Conflict: HTTP 409 with the existing active session.

### `POST /pause`

- Permission: `timesheets.create_own`
- Transitions only `running` to `paused` in a transaction/guarded update.
- Response: `{ active: TimeSession, server_now: ISODateTime }`

### `POST /resume`

- Permission: `timesheets.create_own`
- Adds the completed pause interval to `total_paused_ms` and transitions `paused`
  to `running` transactionally.
- Response: `{ active: TimeSession, server_now: ISODateTime }`

### `POST /stop`

- Permission: `timesheets.create_own`
- Body: optional final `description`
- Atomically stops the session and creates draft timesheet data when safe.
- Response: `{ success, entry_ids, entries, warning, elapsed_seconds }`
- If a precise time window would overlap, the draft is duration-only and the
  response explains why.

### `POST /discard`

- Permission: `timesheets.create_own`
- Stops operational state without creating a timesheet entry.

## Database references

### SQLite `time_sessions`

One row per user, keyed by `user_id`. Additive `paused_at` and `total_paused_ms`
columns are migrated idempotently for existing databases. The row is overwritten when
a new timer starts, which is sufficient because completed work becomes an ordinary
timesheet transaction. The row retains the most recent stopped/discarded state until
the next start.

### Firestore `time_sessions/{user_id}`

A deterministic document ID makes concurrent start attempts serializable. Pause,
resume, and end transitions are serialized with Firestore transactions. Pause fields
are additive, so Firestore needs no destructive migration.

## Security and permissions

- The browser receives no database credentials or service secrets.
- Client ownership, permissions, timestamps, calculated duration, status, and draft
  creation are server-controlled.
- Input text is length-limited and rendered with DOM text nodes for dynamic values.
- The PiP document reuses the authenticated opener's API calls and contains no token
  in its URL.
- The module inherits Samay's current bearer-token storage. Migrating the wider
  application to secure HTTP-only cookies remains a separate authentication change.

## Responsive and PWA behavior

- The on-page launcher remains usable when Document PiP is unavailable.
- The timer modal uses a single-column layout below 720 px and keeps touch targets at
  least 44 px.
- The searchable PiP input targets 316 x 300 pixels, expanded recording targets
  286 x 176 pixels, and the collapsed banner targets 226 x 58 pixels. Long labels are
  truncated; Chromium may clamp these dimensions.
- The timer uses a translucent, blurred surface that becomes more opaque on hover or
  focus so background work remains visible without reducing text contrast.
- After End, the floating window stays open in a compact saved state, retains client
  and work for fast consecutive capture, clears the completed note, and offers direct
  re-entry into the created draft.
- The service worker uses network-first behavior for timer JavaScript and CSS.
- Document PiP is desktop-Chromium-specific and requires a user gesture. The session
  remains active if the PiP window is closed.

## Excel import and pattern learning

- Excel import: not applicable. Timer start is a live operational action and cannot
  be meaningfully bulk imported.
- Pattern learning: the first version does not add a second suggestion model. It
  reuses existing work masters; future work may surface existing frequency/recency
  suggestions inside the timer.

## Cross-reference map

- Frontend controller: `public/js/focus-timer.js`
- Frontend styles: `public/css/focus-timer.css`
- Shared timer calculations: `functions/lib/focus-timer-core.js`
- SQLite API: `routes/timer.js`
- Firestore API: `functions/routes/timer.js`
- SQLite schema: `js/database.js`
- Existing draft editing/submission: `routes/timesheets.js`,
  `functions/routes/timesheets.js`, `public/timesheet.html`

## Change risk and recovery

- Existing timesheet schemas and API contracts are additive and unchanged.
- The new SQLite table is created idempotently during database initialization.
- Firestore receives additive pause fields and requires no destructive migration.
- SQLite adds the same fields through idempotent `PRAGMA table_info` checks. Existing
  running sessions behave as having no paused time.
- If timer routes are rolled back, existing completed drafts remain valid. The
  operational `time_sessions` data can remain without affecting reports.
- Main risks are duplicate starts, stale browser state, network loss during stop,
  overlap with manual entries, and forgotten timers. Server transactions, recovery,
  duration-only conflict fallback, and the 24-hour review boundary address them.

## Bug-fixing guide

- Timer missing after login: inspect `/api/timer/active`, permissions, and dynamic
  script loading in `public/js/app.js`.
- A second timer starts: inspect the SQLite `user_id` primary key or Firestore
  transaction on `time_sessions/{user_id}`.
- Stop creates no draft: inspect the API `warning`; sessions over 24 hours
  intentionally require manual correction.
- PiP does not open: feature-detect `documentPictureInPicture`; the on-page modal is
  the supported fallback.
- Pause state is stale: inspect `status`, `paused_at`, `total_paused_ms`, and the
  `/pause` or `/resume` transaction response before changing the browser interval.
- Draft totals look wrong: run the timer-core tests and inspect paused-duration and
  timezone segmentation before changing reporting code.

## Test matrix

| Level | Cases |
| --- | --- |
| Soft | Load with no session; start; recover; stop; draft appears |
| Normal | Search client/work; start; auto-collapse; expand; pause; resume; end; re-enter; start next; page refresh |
| Edge | Sub-minute stop; midnight split; archived master after start; long labels |
| Failure | Offline start/stop; API 500; retry after response loss |
| Security | Missing permission; another user's session; client/master tampering |
| Concurrency | Two starts; double pause/resume/end; state change on a second device |
| Extreme | Timer over 24 hours; malformed timestamps; very long text |
| UI fit | 360x800, 768x1024, 1366x768, 1920x1080; 316x300 input; 286x176 expanded; 226x58 collapsed |
