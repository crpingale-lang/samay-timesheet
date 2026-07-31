# Automated Management Email Reports

This project now includes two Firebase scheduled functions that email management reports directly to active partner accounts.

## Schedule

- Daily report: every day at 8:05 PM, `Asia/Kolkata` (after the 8:00 PM draft auto-submit)
- Weekly report: every Monday at 8:00 AM, `Asia/Kolkata`
- Weekly range: previous Monday through Sunday

## Recipients

By default, recipients are resolved from active `partner` users who have a non-empty email address.

If you want to override that behavior, set a comma-separated recipient list:

- `REPORT_RECIPIENT_EMAILS`

## Required SMTP Settings

Set these values before deploying:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `REPORT_FROM_EMAIL`

Optional values:

- `SMTP_SECURE` set to `true` for TLS-only connections
- `REPORT_REPLY_TO`

The function also reads Firebase runtime config if you prefer `functions.config()`.

## What The Email Contains

- exceptions and non-compliance
- efficiency snapshot
- client priority split into article time and manager time
- approval backlog

## Deployment Note

Firebase scheduled functions require Cloud Scheduler support in the Firebase project. If the project has not already enabled billing, that needs to be in place before the schedules can run in production.

