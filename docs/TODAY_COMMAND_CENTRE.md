# Today Command Centre

## Problem statement

Samay already contains the records needed to tell a user what requires attention, but the dashboard presents mostly totals and recent activity. Users must interpret those totals, remember workflow rules, and visit several modules to discover unfinished work. The root problem is not missing functionality; it is the absence of a permission-aware decision layer over existing operational data.

The command centre must answer four questions quickly:

1. What requires my action now?
2. Why is it important?
3. How many records are affected?
4. Where do I go to resolve it?

## Current-data-first decision

No new database table, field, migration, scheduled job, or duplicate task record is required. Actions are derived at request time through the existing authenticated `GET /api/timesheets/dashboard-summary` contract. This preserves each operational module as its source of truth and prevents stale copied task data.

The command centre is a read model. Completing an action always happens in the owning module through its existing API and permission checks.

## Data usage and lineage

| Data element | Source of truth | Used for | Update path | Sensitivity and authorization |
| --- | --- | --- | --- | --- |
| Today's and weekly hours | `timesheet_entries` / `timesheets` | Day context, missing-log prompt, weekly progress | Timesheet create/edit/delete/submit APIs | Own records only unless an existing review permission applies |
| Draft and rejected counts | Timesheet status | Submit/fix actions | Timesheet edit and submit APIs | Own records only |
| Pending approvals | Timesheet status | Manager review action | Approval API | Returned only with approval permission |
| Collaboration requests | `timesheet_collaboration_requests` | Shared-entry review action | Collaboration accept/reject APIs | Target user only |
| Today's attendance state | `attendance_records` | Check-in/check-out action | Attendance check-in/check-out APIs | Own state only |
| Pending attendance corrections | `attendance_corrections` | Correction review action | Attendance correction decision API | Returned only with correction approval permission |
| Holiday state | `timesheet_holidays` | Suppress false missing-work prompts and explain the day | Timesheet Masters APIs | Active date/title only |
| Pending UDIN review | `udin_requests` | UDIN review action | UDIN review API | Returned only with UDIN review permission |
| Permissions | Authenticated server session | Action inclusion and deep-link eligibility | Access Management | Never inferred from frontend role labels |

## Action contract

The dashboard response adds:

- `actions`: up to five prioritized actions with stable `id`, `category`, `tone`, `title`, `description`, `count`, `href`, and `action_label` fields;
- `attendance`: current user's normalized attendance state;
- `day_context`: workday/holiday/weekend context;
- `generated_at`: server generation timestamp.

The server builds the action list. The browser does not construct privileged actions from raw counts. Actions link only to internal application routes and never contain credentials, tokens, narrative descriptions, or other users' record details.

## Prioritization

1. Rejected own entries that require correction.
2. Checked-in attendance requiring check-out.
3. Missing attendance on a working day.
4. Timesheet approvals assigned to an authorized reviewer.
5. Attendance corrections assigned to an authorized reviewer.
6. Collaboration requests assigned to the current user.
7. Draft entries awaiting submission.
8. UDIN requests awaiting an authorized review.
9. Missing time for the current working day.
10. A low-priority link to review today's log when no exception is open.

Only the five highest-priority items are returned. Equal-priority items retain a stable order.

## UI design

The dashboard is reorganized around one primary surface:

- a concise daily focus statement;
- a vertically scannable action list with reason, count and direct resolution link;
- compact context metrics for today, week, attendance and open drafts;
- recent entries and team utilization retained as secondary evidence;
- loading, empty, cached, stale and error states;
- keyboard and touch-accessible internal links.

The page does not add decorative charts or fake productivity scores. The existing weekly chart remains secondary context.

## Change-risk assessment

| Risk | Mitigation |
| --- | --- |
| Permission leak through action counts | Server checks the relevant permission before querying/including each privileged action |
| Stale action after a write | Dashboard cache TTL is reduced; the page refreshes the authenticated summary and exposes a retry action |
| False missing-work alert on holidays/weekends | Active holiday and weekday context suppress alert-style prompts |
| Cross-backend drift | Shared pure action builder is used by SQLite and Firebase routes and tested with the same scenarios |
| Broken deep link | Links target existing screens; My Work accepts a validated status query parameter |
| Dashboard failure caused by a secondary collection | Read paths return normalized empty states; automated module-load and API tests cover both implementations |
| Performance regression | Existing dashboard endpoint and cache are reused; queries are bounded to one user/date/status where supported |
| Unrelated workflow breakage | No schema or write-path change; existing module APIs remain authoritative |

## Bulk import and pattern-learning assessment

This feature introduces no data-entry form or new master data, so Excel bulk import is not applicable. The command centre uses deterministic current workflow state rather than prediction. Pattern learning remains in the separate Quick Start entry feature and is not mixed into compliance/action prioritization.

## Test matrix

| Level | Cases |
| --- | --- |
| Soft | No open exceptions; one fallback action; empty recent entries |
| Normal | Drafts, today's time, check-in state, manager approvals, collaboration request |
| Edge | Holiday, weekend, rejected entry, checked-in without checkout, more than five eligible actions |
| Failure | Dashboard API failure, stale local cache, missing secondary collection, invalid status deep link |
| Security | Article cannot see approval/correction/UDIN review counts; unauthenticated endpoint returns 401; internal-only links |
| Data volume | Large counts remain aggregate values; action result stays capped at five |
| Responsive | 390px, 768px, 1280px and wide desktop; no document overflow, action text wraps, touch targets remain usable |
| Regression | All HTML scripts parse, shared navigation remains valid, existing reliability and revamp tests remain green |

## Rollback

Rollback is code-only: redeploy the previous Hosting and Functions revisions. No data migration or repair is required because this module adds no stored data and changes no transaction write path.
