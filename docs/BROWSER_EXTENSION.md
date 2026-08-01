# Samay Focus Timer browser extension

## Product intent

The extension gives a Samay user a small, persistent timer inside ordinary Chrome and Edge webpages. It removes the need to keep the Samay tab visible while preserving Samay's server-authoritative timer and draft-review workflow.

The extension is deliberately narrow. It records time against existing Samay master data; it does not create clients, work categories, users, or submitted timesheets.

## User experience contract

- The overlay sits in the upper-right corner and uses a translucent, high-contrast surface.
- The collapsed banner shows only the active state, client context, and elapsed time.
- The expanded idle state contains three mandatory decisions: client/internal, work category, and work note.
- Client and work fields are searchable controlled lists; arbitrary values cannot start a timer.
- The active state exposes only Pause/Resume and End.
- End saves a draft in Samay. The user can open the draft for review or immediately prepare a new timer.
- Exit hides the overlay only on the current page. The toolbar popup can show it again.
- Samay's own site is excluded to prevent duplication with the built-in focus timer.

## Security boundary

The background service worker is the only extension context that receives a Samay token or calls the API.

- Passwords are submitted from the popup and immediately cleared; they are never written to storage.
- The JWT and user session are stored in `chrome.storage.session`, not local storage or sync storage.
- Session storage access is restricted to trusted extension contexts.
- The content script never receives the JWT or Authorization header.
- The injected overlay uses a closed Shadow DOM to isolate its styles and reduce page interference.
- Network access is restricted to `https://samay-timesheet.web.app/*`.
- No cookies, browsing history, tab metadata, clipboard, or arbitrary code execution permissions are requested.
- API requests use a timeout, `no-store` caching, server-side permission checks, and normal Samay JWT expiry.

The broad `http://*/*` and `https://*/*` content-script match is necessary for an automatic floating overlay across user webpages. The extension does not read page content or transmit page URLs.

## Data flow

1. The popup sends username/email and password to the background service worker.
2. The service worker signs in through `/api/auth/login` and keeps the returned session in browser-session storage.
3. The service worker fetches active clients, work categories, and `/api/timer/active`.
4. Content scripts receive only the user summary, safe option lists, timer details, notices, and server time.
5. Start/Pause/Resume/End messages return to the service worker, which calls the existing timer API.
6. The service worker broadcasts the resulting state to all open tabs so each overlay stays consistent.
7. End creates a Samay draft through the existing server transaction; the extension does not write timesheet data itself.

## Install from the Log Time portal

1. Open **Log Time** in Samay and select **Download extension** in the extension banner.
2. Extract the ZIP to a permanent folder; Chrome and Edge need that folder after installation.
3. Open `chrome://extensions` or `edge://extensions`.
4. Enable **Developer mode**, choose **Load unpacked**, and select the extracted folder.
5. Pin **Samay Focus Timer**, open its toolbar icon, and sign in.

The portal hosts the reviewed versioned ZIP as a static public asset. It contains only
the extension package and no account data, token, environment value, or credential.
The banner's dismissed state is an optional local browser preference and never reaches
the Samay API.
## Load locally in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository's `extension` folder.
5. Pin **Samay Focus Timer**, open its toolbar icon, and sign in.
6. On a normal website, choose **Show timer on this page** if the overlay was previously exited.

For Edge, use `edge://extensions` and the same unpacked folder.

After a code change, select **Reload** on the extension card and refresh the webpage being tested.

## Browser limits

Chrome and Edge do not permit extensions to inject overlays into browser-owned pages such as `chrome://`, `edge://`, the extension store, or some built-in PDF/new-tab surfaces. A browser extension also cannot float above desktop applications. The existing Document Picture-in-Picture timer remains the appropriate browser-window option from Samay, while a true desktop-wide overlay would require a signed desktop application.

## Release checklist

- Run `npm test`.
- Test sign-in, wrong credentials, expired session, no clients, no categories, internal work, client work, start conflict, pause, resume, end, and cross-tab synchronization.
- Test 100%, 125%, and 150% scaling in current Chrome and Edge.
- Verify keyboard-only operation and reduced-motion behavior.
- Review requested permissions and keep the public privacy disclosure accurate. Page content and URLs are not collected.
- Package the contents of `extension/` as the store upload ZIP; do not wrap them in an extra parent folder.


## Chrome Web Store release material

- Store listing copy, permission justifications, privacy declarations, and reviewer steps live in `docs/CHROME_WEB_STORE_LISTING.md`.
- Public privacy policy: `https://samay-timesheet.web.app/extension-privacy.html`.
- Public support page: `https://samay-timesheet.web.app/extension-support.html`.
- Store graphics live in `store-assets/chrome-web-store/` and must match the version being uploaded.
- The upload ZIP is generated from the contents of `extension/` and keeps `manifest.json` at the archive root.
## Test matrix

| Level | Extension cases |
| --- | --- |
| Soft | Signed-out pill; sign in; internal timer; collapse/expand; end to draft |
| Normal | Search/select client and category; required note; pause/resume; new timer; view draft; exit and restore |
| Edge | Empty client master; empty work master; inactive options; long client/note; 24-hour boundary; extension reload during active timer |
| Failure | Wrong credentials; offline/timeout; expired JWT; API 500; start conflict; action response loss; unsupported page |
| Security | No token in content context; no password persistence; server permission denial; no page URL/content transmission; manifest permission review |
| Concurrency | Two tabs start together; state change in another tab/device; double pause/resume/end; service-worker suspension and recovery |
| UI fit | Collapsed/expanded/saved at 100%, 125%, 150%; 320 px browser width; short viewport; long labels; keyboard only; reduced motion |
| Extreme | Hundreds of client options; timer over 24 hours; malformed server timestamps; rapid tab creation; maximum 2,000-character note |

Automated validation covers manifest permissions, syntax, security boundaries, required
