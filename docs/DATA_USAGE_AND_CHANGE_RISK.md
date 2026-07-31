# Samay data usage and change-risk map

## Current-data-first decision

The first revamp phase does not require new database tables or fields. Navigation, action hierarchy, labels, layout, validation presentation, and component consistency can be improved with existing data and APIs. Any later data change must prove that linking, derivation, API shaping, indexing, or an existing master cannot satisfy the workflow.

## Source-of-truth map

| Data | Source of truth | Main consumers | Update path | Sensitivity |
| --- | --- | --- | --- | --- |
| User identity, role, permissions | `users` / Firestore `users` | Login, navigation, access, approvals, reports | Auth and staff APIs | High |
| Client identity and billing metadata | `clients` | Time entry, clients, reports, Form 15CB context | Client APIs and import | Medium-high |
| Work categories/classifications | `master_data_options` / master-data API | Time entry, badges, reports | Timesheet Masters | Medium |
| Time entries and approval state | `timesheet_entries` / Firestore timesheets | Daily capture, my work, approvals, dashboards, reports | Timesheet APIs | High |
| Entry collaborators/invitations | Collaboration tables / Firestore equivalents | Time entry and collaboration requests | Timesheet APIs | Medium-high |
| Attendance punches, corrections, locations | Attendance storage and master locations | Attendance, reports, corrections | Attendance APIs | High; location data |
| UDIN requests, files, review state | UDIN storage | UDIN register, approval, expiry, uploads | UDIN APIs | High; compliance documents |
| Form 15CB masters/conversions | Form 15CB storage/templates | Conversion, history, downloads | Form 15CB APIs | High; tax/remittance data |
| Feedback | Feedback storage | Feedback form and reports | Feedback APIs | Potentially sensitive |
| Session state | JWT plus cached browser user | All frontend API calls | Auth APIs and session helpers | High |
| Timer running/paused state | `time_sessions` | Focus timer recovery and one-active-session rule | Start, Pause, Resume, End, Discard APIs | Medium-high |
| Timer pause interval | `paused_at`, `total_paused_ms` on `time_sessions` | Exact active-duration calculation | Server timestamps and transactional API transitions | Medium-high |

## Timer pause/resume change assessment

- Current-data-first result: the existing `time_sessions` operational entity remains
  the correct source of truth. No new table or collection is needed.
- New fields are justified because `started_at` and `stopped_at` alone cannot distinguish
  working time from paused time after refresh or cross-device recovery.
- Classification capture is reduced: `work_classification` is derived from the existing
  client link (`client_work` when selected, otherwise `internal`) and remains stored on
  the completed draft for reporting compatibility.
- Affected consumers: SQLite and Firestore timer APIs, elapsed display, draft duration
  calculation, timer module tests, and module documentation. Existing dashboard,
  approval, report, and export consumers continue reading ordinary timesheet drafts.
- Migration: SQLite adds both columns idempotently; Firestore fields are additive.
  Missing values are treated as `null` and zero for backward compatibility.
- Accuracy risk: a paused session cannot honestly produce one continuous clock window,
  so End creates a duration-only draft with paused time excluded and a review warning.
- Concurrency risk: Pause and Resume use guarded state transitions/transactions. Duplicate
  or stale transitions return HTTP 409 instead of altering duration twice.
- Rollback: older code ignores additive fields; completed drafts remain valid. An active
  paused session should be resumed or ended before rolling back the API to avoid hiding it.

## Existing links and auto-population opportunities

- Current user, role, and permissions determine navigation and defaults.
- Client selection supplies client code and configured shift/site defaults.
- Work categories/classifications come from master data, not page-local lists.
- Attendance location choices come from master locations.
- UDIN assignment, financial year, and location values link to masters.
- Form 15CB repeated party and bank data comes from existing masters.
- Report filters derive values from records and master APIs.

## Redundancy risks

- SQLite and Firestore routes can drift in validation, permissions, fields, and errors.
- `staff.html` and `users.html` overlap conceptually.
- Firm, Timesheet, and Form 15CB masters use different interaction patterns.
- Status labels are interpreted separately across dashboard, timesheets, approvals, and reports.
- Inline UI logic duplicates shared formatting and validation.

## Change-risk levels

**Low-risk presentation:** shared tokens, icons, labels, spacing, action grouping, responsive layout, and feedback states. Verify all screens and roles.

**Medium-risk workflow presentation:** moving actions, collapsing filters, renaming navigation, changing defaults, or consolidating screens. Verify discoverability, keyboard/touch behavior, saved view state, and role-specific paths.

**High-risk data or contract:** fields, tables, status transitions, authentication storage, imports/exports, permissions, report calculations, or API response shapes. Require SQLite/Firestore parity, migration and rollback, historical accuracy, permission review, and API/export regression tests.

## Security boundary

Passwords, signing secrets, database credentials, document processing, privileged exports, and permissions stay server-side. Browser code is public. Browser-readable JWT storage is documented security debt and must not be expanded; secure HTTP-only cookie migration is a separate high-risk authentication project.

## Excel import assessment

- Clients: required and already supported.
- Holidays: required and already supported.
- Users/access: useful but high-risk because permissions and credentials need row-level validation; defer until specified securely.
- Work categories/classifications: low normal volume; retain manual entry until evidence supports import.
- Form 15CB masters: potentially useful for remitters, remittees, and banks; reassess after master UX normalization.
- Transactional timesheets and approvals: no bulk import in the UX revamp phase.
