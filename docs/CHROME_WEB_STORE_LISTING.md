# Samay Focus Timer — Chrome Web Store listing

## Product details

**Name:** Samay Focus Timer

**Summary (132 characters maximum):**

Record focused work from a subtle floating timer and save completed time as a draft in your Samay account.

**Category:** Productivity

**Language:** English

**Detailed description:**

Samay Focus Timer lets authorized Samay users record focused work without keeping the timesheet portal in the foreground.

Start from a compact, searchable form, then collapse the timer into a subtle elapsed-time banner while you work. Your active timer stays synchronized across open tabs and with Samay. When you end the timer, the recorded time is saved as a draft for review before submission.

Key features:

- Select an active client or internal work.
- Search approved work categories from Samay master data.
- Add a required work note before recording.
- Start, pause, resume, and end from the floating overlay.
- Keep the timer visible in a small collapsed banner.
- Restore the same active timer across supported tabs.
- Save completed time as a Samay draft for review.
- Keep credentials and session data out of webpage content.

A Samay account issued by your organization is required. The overlay works on normal HTTP and HTTPS webpages. Chrome system pages, the Chrome Web Store, some built-in PDF viewers, and new-tab surfaces do not allow extension overlays.

**Homepage URL:** https://samay-timesheet.web.app/extension-support.html

**Support URL:** https://samay-timesheet.web.app/extension-support.html

**Privacy policy URL:** https://samay-timesheet.web.app/extension-privacy.html

**Mature content:** No

## Privacy practices

**Single purpose:**

Let an authorized Samay user run a small timer on ordinary webpages and save the resulting work time as a draft in their Samay account.

**Permission justifications:**

- `storage`: Stores the Samay session token, account summary, permitted client/work lists, and active timer state in Chrome session storage. The extension does not use local or sync storage for credentials.
- `alarms`: Refreshes the authenticated timer state once per minute so elapsed time and pause/resume/end state remain consistent across tabs and after service-worker suspension.
- `https://samay-timesheet.web.app/*`: Required for HTTPS calls to the Samay API for sign-in, authorized master data, active timer synchronization, and start/pause/resume/end actions. No other server host is permitted.
- `http://*/*` and `https://*/*` content-script matches: Required only to render and control the user-requested floating timer on ordinary webpages. The content script does not read, collect, or transmit page content, browsing history, or page URLs. Samay's own site is excluded to avoid duplicating its built-in timer.

**Remote code:** No. All executable JavaScript and CSS is included in the extension ZIP. The extension calls the Samay JSON API but does not download or execute remote code.

**Data types collected:**

- Personally identifiable information: Samay account identity such as name, username/email, and role.
- Authentication information: username/email, password during sign-in, and the resulting session token. The password is sent over HTTPS and is never stored by the extension.

Do not select browsing history, website content, location, financial information, health information, personal communications, or user-activity monitoring. The work note and timer selections are entered directly into the extension for the requested timer feature; the extension does not observe webpage activity.

**Limited Use certifications:** Certify all applicable statements. Data is used only for the extension's single user-facing purpose, is not sold or used for advertising or credit decisions, and is transferred only as necessary to provide Samay, maintain security, comply with law, or provide user-requested support.

## Distribution

**Visibility for initial review:** Unlisted. This supports a controlled organizational rollout while using the same Chrome Web Store review process as a public listing. Change to Public later if broad discovery is intended.

**Regions:** All regions where the organization's Samay service is offered. Review before final submission.

## Test instructions for reviewers

The extension requires an authorized Samay account. Add temporary reviewer credentials only in the Developer Dashboard's private Test instructions field; never place credentials in the listing, repository, screenshots, or ZIP.

1. Open the extension popup and sign in with the provided temporary reviewer account.
2. Open any normal HTTPS webpage other than `samay-timesheet.web.app` and refresh it if the extension was just installed.
3. Select the extension icon and choose **Show timer on this page**.
4. Expand the banner, choose **Internal / no client**, select an available work category, enter `Chrome Web Store review timer`, and choose **Start**.
5. Confirm the banner collapses and elapsed time increases.
6. Expand it, test Pause and Resume, then choose End.
7. Confirm the saved state states that a draft was created. Choose **View draft** to open Samay.
8. Sign out from the extension popup when testing is complete.

## Required upload assets

- Package ZIP with `manifest.json` at the root.
- Store icon: `extension/icons/icon-128.png`.
- Screenshots: 1280 × 800 PNG files in `store-assets/chrome-web-store/`.
- Small promo tile: 440 × 280 PNG.
- Optional marquee: 1400 × 560 PNG.

## Final action checklist

- Verify the publisher/support email shown in the Developer Dashboard.
- Verify the public privacy and support URLs load without authentication.
- Add a temporary least-privilege reviewer account in the private Test instructions field.
- Confirm the disclosure checkboxes exactly match this version's behavior.
- Choose deferred publishing when submitting for review so approval does not automatically make the item live.
