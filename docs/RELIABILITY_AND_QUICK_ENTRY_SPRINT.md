# Reliability and Quick Entry Sprint

## Objective

Make daily time entry feel smaller and safer without hiding required controls or weakening authorization. This sprint upgrades the supported runtime, replaces vulnerable spreadsheet handling, tightens file uploads and timesheet permissions, and adds explainable quick-start suggestions.

## Runtime and dependency changes

- Firebase Functions runtime: Node.js 22.
- Firebase Admin uses its modular initialization APIs (`getFirestore` and `getStorage`).
- Spreadsheet import/export uses ExcelJS. The deprecated `xlsx` package is removed.
- Multer is upgraded to the maintained 2.x line.
- Spreadsheet, XML, PDF, PNG, and JPEG uploads have explicit extension/MIME allowlists, file-count limits, and size limits.
- Production secrets remain server-side; no credentials or service keys are added to browser bundles.

## Faster entry workflow

`GET /api/timesheets/suggestions` returns up to three patterns derived only from the signed-in user's own entries from the last 60 days.

Suggestions contain structural fields only:

- client and task identity;
- work classification;
- use count and most recent use;
- a confidence score and plain-language reason;
- model identifier `frequency_recency_v1`.

The service requires at least two previous uses and a confidence share of 0.15. It never copies description, notes, time, duration, approval state, or another user's data. Selecting a suggestion still requires the user to enter today's description and confirm the schedule before saving.

## Authorization contract

- View, create, edit, delete, submit, and review operations use permission checks at the API boundary.
- Partner or administrator labels do not bypass timesheet permissions.
- Own-entry endpoints bind scope to the authenticated user on the server.
- Submit rejects unknown, non-owned, or non-draft entries instead of silently skipping them.
- Missing authentication returns `401`; insufficient permission returns `403`; invalid workflow state returns `400`.

## Dialog and responsive contract

- Desktop dialogs retain a visible edge gap and internal gutters.
- Mobile dialogs use a bottom-sheet layout with a top edge gap, 20px content gutters, safe-area padding, and internal scrolling.
- Hidden quick-start panels must use `display: none` so empty state does not consume space.
- Controls remain reachable at 390px, 760px, and desktop widths without horizontal document overflow.

## Test matrix

| Level | Coverage |
| --- | --- |
| Soft | Static route, dependency, runtime, permission, and UI-token checks |
| Normal | Suggestion ranking, workbook round-trip, CSV escaping, page script parsing |
| Edge | Empty history, duplicate patterns, numeric spreadsheet dates, future-day UI |
| Failure | Bad file type, oversized upload, invalid entry, wrong owner, non-draft submit |
| Security | Unauthenticated API call, permission gates, no role bypass, narrative exclusion |
| Responsive | Desktop and 390px dialog geometry, internal scrolling, horizontal overflow |
| Deployment | Build/tests before commit, push to main, Hosting workflow, Functions health check |

## Operational verification

Before release:

1. Run `npm test` at the repository root.
2. Run `npm test` in `functions`.
3. Run both production dependency audits with development packages omitted.
4. Start the SQLite-backed local server and verify the page and authenticated suggestion endpoint.
5. Verify desktop and mobile dialog geometry in the browser.
6. Deploy only after all checks pass.

After release:

1. Confirm the Hosting workflow succeeded for the pushed commit.
2. Confirm Functions report the Node.js 22 runtime.
3. Smoke-test the production login page and an authenticated timesheet flow.
4. Review Functions logs for upload rejection spikes or permission failures.

## Rollback

If the release misbehaves, redeploy the previous known-good Hosting artifact and Functions source generation. The quick-start UI is additive and safely disappears when the endpoint returns no suggestions. No schema migration is required, so rollback does not require data repair.

