# Samay UI revamp

## Problem statement

Samay had accumulated inconsistent colors, spacing, typography, navigation treatments, one-off page styles, duplicated UI implementations, and broken encoded symbols. The root problem was the absence of one dependable visual system across a multi-module professional application.

## Users and design direction

Articles and staff need fast daily capture; managers and partners need clear approval and reporting; administrators need dense, dependable master-data screens. The new system uses a modern indigo-violet primary, mint/teal operational accents, coral only for attention, softly rounded system typography, a dark professional sidebar, bright work surfaces, restrained gradients, and consistent cards, controls, tables, badges, modals, and empty states.

## Scope and redundancy decisions

In scope: shared presentation, typography, colors, responsive fit, visible character encoding, navigation consistency, and redundant UI cleanup. Authentication, permissions, API contracts, database schemas, stored data, calculations, and workflow rules are unchanged.

The obsolete duplicate UDIN sidebar implementation was removed. Malformed stylesheet markup was repaired on all screens, and mojibake in visible labels, icons, punctuation, statuses, and currency symbols was repaired. One clear primary action is retained per context; secondary actions remain only where they represent distinct workflows.

## Data usage and change risk

No tables, columns, API fields, imports, exports, connectors, or source-of-truth records were added, changed, or removed. Existing SQLite/Firestore selection, API authorization, report data, and form payloads remain unchanged.

Risk is limited to presentation regressions: selector collisions, hidden controls, overflow, contrast, malformed symbols, or inline-script syntax. Rollback is limited to the shared revamp stylesheet and affected presentation files; no data migration is required.

## Security boundary

Secrets, JWT signing, password validation, TOTP verification, database access, and permissions remain server-side. The revamp adds no browser-visible secret, external dependency, analytics script, or third-party font request.

## Responsive and PWA behavior

Desktop uses fixed navigation and a translucent top bar. Mobile uses compact spacing, touch-sized controls, bottom navigation where supported, and scroll-safe tables/modals. Existing manifest, icons, and service worker remain unchanged.

## Verification matrix

| Level | Coverage | Expected result |
| --- | --- | --- |
| Soft | Login render, shared CSS load, primary action | Clean hierarchy and working controls |
| Normal | All HTML routes and shared assets | Every module uses the unified design system |
| Edge | Long labels, empty states, tables, narrow viewport | No page-level spill or overlap |
| Failure | Loading/error/empty states | Clear recovery presentation |
| Security | Auth/API/data boundary | No new secret or permission exposure |
| Responsive | 390x844 and 1440x900 checks | Readable, touchable, overflow-free layout |
| Extreme | All screens and inline scripts | No malformed stylesheet token or syntax failure |

## Maintenance map

- Shared base styles: `public/css/style.css`
- Revamp tokens and overrides: `public/css/revamp.css`
- Shared navigation and UI utilities: `public/js/app.js`
- Page entry points: `public/*.html`
- Local server: `server.js` to `local-app.js`
- Firebase server: `functions/app.js`
- PWA assets: `public/manifest.json`, `public/sw.js`, `public/icons/`

Add reusable visual rules to the shared stylesheets and keep workflow logic in the relevant page or shared utility. Avoid new inline color systems or duplicate sidebar builders.