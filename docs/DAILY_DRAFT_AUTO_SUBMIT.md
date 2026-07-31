# Daily Draft Auto-Submit

## Policy

Samay automatically submits eligible timesheet drafts every day at **8:00 PM
Asia/Kolkata**. The job uses the India calendar date at execution time and runs
server-side, so a user does not need to keep the portal or extension open.

## Eligibility and status transitions

- Only entries whose `entry_date` is the current India date and whose `status` is
  `draft` are considered.
- Entries requiring time confirmation are skipped so overlapping shared work is
  never silently submitted.
- Entries for missing, inactive, or submission-restricted users are skipped.
- Article drafts move to `pending_manager`.
- Manager and partner drafts move to `approved`, matching the existing manual
  submission workflow.
- Rejected, pending, approved, older, and future entries are not changed.

Each changed entry receives `submission_source=daily_8pm`, `submitted_at`, and an
updated `updated_at` value. Approved manager/partner entries retain the existing
approval actor fields. The scheduled function logs date-level counts only; work
notes, client details, usernames, and other sensitive content are not logged.

## Reliability

- Writes are committed in batches of at most 400, below Firestore's 500-write limit.
- A repeated run is idempotent because only records still in `draft` are eligible.
- Errors are allowed to fail the function so Cloud Scheduler can retry and surface
  the failed execution instead of reporting a false success.
- The daily management report runs at 8:05 PM so it sees the post-submission state.

## Test matrix

| Level | Cases |
| --- | --- |
| Soft | One article draft becomes `pending_manager` at the India date boundary |
| Normal | Article, manager, and partner drafts receive their existing role-based status |
| Edge | Rejected/approved/other-day entries and confirmation-required shared entries remain unchanged |
| Security | Missing, inactive, and permission-restricted users are skipped; no narrative data is logged |
| Failure | Missing Firestore connection fails explicitly; commit errors propagate for scheduler retry |
| Extreme | 451 eligible drafts are split into two write batches; a repeated run performs zero writes |

## Rollback

Disable or remove the `dailyDraftAutoSubmit` export to stop future executions. No
schema migration is required. Existing status history remains readable because the
new submission metadata fields are optional and additive.
