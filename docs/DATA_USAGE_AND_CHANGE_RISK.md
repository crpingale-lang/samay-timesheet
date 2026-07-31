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
| Extension session and safe option cache | Chrome/Edge session storage | Extension background service and floating timer | Recreated on sign-in; cleared on browser exit/sign-out | High for JWT; medium for timer context |
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

The production JWT signing key is sourced only from Firebase Secret Manager and is bound only to the `api` function. Managed runtime startup fails closed when the secret is missing. Local development uses a process-local ephemeral key instead of a repository fallback. Rotating `JWT_SECRET` invalidates existing sessions by design; rollback can re-enable the preceding Secret Manager version and redeploy the API if required.

## JWT signing-key change assessment

- Data impact: no user or timesheet fields change. Rotation invalidates outstanding JWTs and requires users to sign in again.
- Security impact: removes a signing key from source and Git history as an active credential, limits runtime access to the API function, and prevents production fallback to a known value.

## Excel import assessment

- Clients: required and already supported.
- Holidays: required and already supported.
- Users/access: useful but high-risk because permissions and credentials need row-level validation; defer until specified securely.
- Work categories/classifications: low normal volume; retain manual entry until evidence supports import.
- Form 15CB masters: potentially useful for remitters, remittees, and banks; reassess after master UX normalization.
- Transactional timesheets and approvals: no bulk import in the UX revamp phase.

## Browser extension change assessment

- Current-data-first result: the extension reuses existing auth, client, master-data,
  and timer contracts. It adds no database collection, status, or reporting path.
- The extension sends `source: browser_extension`; the shared timer normalizer accepts
  that audit value while retaining the existing safe fallback for unknown sources.
- The JWT is held only in `chrome.storage.session` with access restricted to trusted
  extension contexts. It is never sent to the page content script, local storage,
  sync storage, a URL, or application logs.
- Content scripts receive the minimum data needed to render the workflow: user summary,
  active clients, active work categories, current timer, notices, and server time.
- The broad webpage match is a presentation requirement for an automatic overlay.
  The extension does not inspect DOM content, capture activity, or transmit page URLs.
- A closed Shadow DOM isolates the component, but any visible overlay should still be
  treated as on-screen information. Users can exit it per tab.
- Existing server permissions, one-active-session transactions, master validation,
  safe draft creation, overlap handling, and the 24-hour boundary remain authoritative.
- Rollback: remove/disable the extension. Server data remains ordinary timer sessions
  and timesheet drafts; no schema rollback or data migration is required.

## Same-day multi-entry workflow assessment

- Current-data-first result: no schema or API contract change is required. Every
  timesheet entry already has its own identity, while `entry_date` is a grouping and
  reporting field rather than a unique key.
- SQLite creates each entry with `INSERT INTO timesheet_entries`; Firestore creates
  each entry with `timesheets.add()`. Daily totals, approvals, dashboards, reports,
  and exports already aggregate all matching records.
- The change is limited to the Add Entry modal. For a new record, its previously
  disabled Save Before Submit action becomes Save & Add Another.
- After saving, the modal retains the selected date, reloads the day's records and
  timeline, then resets the entry-specific fields for another independent record.
- Existing overlap validation remains authoritative for clock-based entries. Adjacent
  ranges and duration-only entries are allowed; intersecting start/end ranges are not.
- Permissions are unchanged: Save & Add Another uses `timesheets.create_own`; submitting
  a saved entry still requires `timesheets.submit_own`.
- Rollback is presentation-only: restore the former modal action. Entries already
  created remain ordinary independent timesheet transactions.

| Test level | Same-day cases |
| --- | --- |
| Soft | Create one record and close normally |
| Normal | Save two adjacent timed records for one date; use Save & Add Another |

## Extension banner and download assessment

- Current-data-first result: the banner needs no server data, API, table, field, or
  analytics event. It is static product guidance on Log Time.
- The versioned ZIP is generated from the reviewed `extension/` source and hosted as
  a public static asset. Extension code is already public by design and the archive
  contains no credential, token, environment value, database configuration, or user data.
- The only new state is `samay_extension_promo_dismissed_v1` in local storage. It is
  a non-sensitive display preference used only to keep the dismissed banner hidden.
  It is never transmitted, synchronized, or used for permissions.
- Downloading does not authenticate or install the extension. Chrome/Edge still presents
  the extension's site-access permissions when the user explicitly loads the unpacked folder.
- The install guide states the security boundary: the extension does not persist passwords
  and continues to use Samay's server-side auth, permissions, master validation, and timer API.
- Rollback: remove the banner stylesheet/markup and downloadable ZIP. User timesheets,
  extension sessions, and any already extracted extension remain unaffected.

| Test level | Banner cases |
| --- | --- |
| Soft | Banner appears for a user with no dismissal preference |
| Normal | Download ZIP; expand/collapse instructions; dismiss and keep hidden on reload |

## Daily draft auto-submit assessment

- Current-data-first result: eligibility and target status come from existing
  timesheets.entry_date, timesheets.status, timesheets.requires_time_confirmation,
  and the owning user's existing role, active state, and permissions. No new collection,
  table, index, or duplicated workflow record is required.
- Two optional transaction fields are added to automated submissions only:
  submission_source=`daily_8pm` and submitted_at record the source and server
  execution time. Existing entries without those fields remain valid manual or legacy
  submissions.
- The authenticated GitHub Actions schedule is the only privileged automation consumer. It reads
  current-day timesheets and users, applies the same role-based transition as the
  authenticated manual API, and writes only eligible draft records.
- Security boundary: no browser token or credential is used. Inactive, missing, and
  explicitly submission-restricted users are skipped. Logs contain aggregate counts only.
- Downstream impact: approval queues and management reporting see the same existing status
  values. Because the existing daily report starts in the same minute, it can observe the
  status mix immediately before or after the idempotent run.
- Compatibility: old records without the optional metadata remain valid. Rollback removes
  the scheduled workflow and UI notice; no migration or destructive operation is required.

## Entry save-button state regression

- Current-data-first result: no table, collection, field, API payload, permission, or
  validation rule changes. The existing modal values and API remain the source of truth.
- Root cause: the save handler directly disabled Save Entry, while the shared modal-state
  refresh restored only Submit and Delete. A completed or failed request could therefore
  leave an editable draft with a permanently disabled save control.
- Change: updateModalGuidance is now the single owner of Save, Save & Add Another/Submit,
  and Delete disabled states. All mutation controls lock while a save is in flight, recover
  in finally, and remain locked for approved entries.
- Security and data risk: authorization, required work notes, timeline validation,
  overlap detection, request payloads, and server writes are unchanged. The in-flight
  guard still prevents duplicate submissions.
- Rollback: restore the prior button assignments. No data migration or recovery is needed.

| Test level | Save-button cases |
| --- | --- |
| Soft | New valid draft opens with Save Entry and Save & Add Another enabled |
