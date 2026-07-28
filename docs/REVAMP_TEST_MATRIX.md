# Samay revamp test matrix

## Soft

- Login renders with clear hierarchy and one primary action.
- Each page loads shared CSS, shared JavaScript, favicon, and manifest.
- Active navigation and page title agree.
- Primary action is visible without scrolling on common desktop sizes.

## Normal

- Article, manager, partner, and administrator navigation exposes only allowed work.
- Create/edit/save/cancel flows retain values and show consistent feedback.
- Filters, search, sorting, pagination, exports, and saved view state work.
- Approval and submission status language matches the next responsible role.

## Edge

- Empty datasets, long names/descriptions, special characters, inactive masters, rejected records, partial data, and missing optional values.
- Narrow mobile, large mobile, tablet, desktop, and wide desktop.
- Tables scroll intentionally without page-level horizontal overflow.
- Modals, drawers, sticky actions, navigation, toasts, and keyboards do not cover critical controls.

## Failure

- 400/401/403/404/409/500 responses.
- Expired session, offline request, timeout, invalid upload, partial import, duplicate data, stale record, and failed export.
- Errors identify the failed action and a safe recovery.

## Security

- Direct API calls without a token are rejected.
- Role mismatch and record-scope violations are rejected server-side.
- Hidden UI does not substitute for authorization.
- No secrets, passwords, privileged tokens, or sensitive payloads appear in frontend assets or logs.
- Export and document-download permissions are enforced.

## Data and parity

- Changed SQLite and Firestore endpoints return compatible fields, statuses, and errors.
- Existing data supports the redesigned workflow without duplicate storage.
- Report totals and exports remain unchanged unless explicitly documented.
- Imports preserve validation, duplicate handling, and result reporting.

## Extreme

- Large tables, many filters, long exports, maximum uploads, concurrent edits, repeated clicks, slow responses, and high-frequency refresh.
- Static audit of all HTML, inline scripts, shared JavaScript, JSON, service worker, duplicate IDs, malformed encoding, and missing assets.

## Release gate

- No conflict markers, malformed encoding, or syntax failures.
- No unexplained console errors.
- No page-level overflow at tested viewports.
- No unreviewed schema or data migration.
- Working tree contains only intended source/documentation changes.
- Remote `main` is fetched and release is a fast-forward push.
## Executed results

| Check | Result |
| --- | --- |
| Static shared/inline JavaScript compilation across 21 HTML screens | Pass |
| Direct workspace routing and removal of legacy continue flow | Pass |
| Duplicate top-bar workspace links | None found |
| Shared navigation factory and permission visibility | Pass |
| Desktop render matrix at 1440 x 900 across 17 routed screens | Pass; no horizontal overflow |
| Mobile render matrix at 390 x 844 across 17 routed screens | Pass; no horizontal overflow |
| Active navigation and skip-link semantics | Pass on standard shell; UDIN uses equivalent workflow state |
| Mobile navigation accessibility state | Pass |
| Fresh-session browser runtime log across dashboard, UDIN, and all Form 15CB pages | Zero errors |
| UDIN progressive create/cancel panel | Pass; no record mutation during test |
| Partner UDIN route after fresh authentication | Pass; 403 mismatch removed |
| Partner/manager/article permission boundary assertions | Pass |
| SQLite/Firestore UDIN guard representation | Pass |
| `npm test` (`scripts/validate-revamp.js`) | Pass |

The browser audit used local test data only. It did not create timesheets, approvals, UDIN requests, conversions, clients, or users.