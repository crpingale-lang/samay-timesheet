# Samay product revamp goal

## Principal problem

Samay manages a comparatively small practice workflow, but the product feels complicated because navigation, actions, modules, forms, statuses, and visual treatments expose too much implementation detail. The root problem is cognitive load, not feature count.

The product must make this mental model obvious:

1. Choose the area of work.
2. Capture or maintain the required record.
3. Review exceptions and incomplete items.
4. Approve where the user has authority.
5. Report from approved, trustworthy data.

## Intended users and decisions

| User | Primary decisions |
| --- | --- |
| Article/staff | What work did I perform, for whom, when, and is it ready to submit? |
| Manager | What needs review, what is incomplete, and what requires correction? |
| Partner | What needs final approval and what operational risks need attention? |
| Administrator | Which users, clients, masters, permissions, and locations are valid? |
| Report consumer | What approved data supports staffing, client, attendance, and compliance decisions? |

## Evidence from the baseline audit

- 21 HTML screens, 208 buttons, 79 modal-class elements, and 415 inline style declarations.
- Four separately maintained sidebar builders plus dedicated UDIN navigation.
- Parallel SQLite and Firestore route implementations with parity risk.
- Top bars repeat module switching, back-navigation, refresh, export, and create actions inconsistently.
- Masters are spread across firm, timesheet, Form 15CB, client, user, and UDIN contexts.
- Navigation symbols render, but they are inconsistent, rely on font glyphs, and do not form a coherent icon language.
- Some modules present secondary controls before the user understands the primary task.

## Success criteria

- A user can identify the primary action on every screen within a few seconds.
- Common workflows use consistent verbs, placements, status language, and confirmation patterns.
- The sidebar reflects the user's jobs rather than the repository's page structure.
- Page headers contain one primary action and only essential contextual actions.
- Data tables remain dense and useful while filters are progressively disclosed.
- Forms group fields by decision, auto-populate known values, and explain validation inline.
- Loading, empty, failure, permission, and success states use one shared language.
- Mobile and tablet layouts preserve task priority rather than merely stacking desktop controls.
- No schema or source-of-truth duplication is introduced for visual convenience.
- SQLite and Firestore behavior remains aligned for changed workflows.

## Product design principles

1. **Task before module:** label navigation around what the user needs to do.
2. **One primary action:** each view has a single visually dominant next step.
3. **Progressive disclosure:** advanced filters, imports, destructive actions, and configuration stay available without competing with daily work.
4. **Status as guidance:** status labels explain the next owner/action, not only the database state.
5. **Table-first operations:** reports and registers prioritize searchable, filterable data.
6. **Current-data first:** link, derive, and auto-populate before adding storage.
7. **Consistent recovery:** every failure state says what happened and what the user can do.
8. **Restrained graphics:** graphics establish hierarchy and identity; they do not obscure data.
9. **Permission-aware simplicity:** unavailable actions are removed or clearly explained, never teased.
10. **Professional density:** rounded, modern, readable, but not oversized or toy-like.

## Information architecture target

### Daily work

- Home
- Log time
- My work
- Attendance
- UDIN

### Review

- Approvals
- Reports

### Firm setup

- Overview
- Clients
- People & access
- Masters

Module switching remains available from the brand area and user menu; it should not be repeated as a primary button on most pages.

## Scope and safeguards

In scope: the shared shell, sidebars, top bars, navigation, iconography, typography, colors, spacing, cards, tables, forms, modals, feedback states, redundant actions, unclear labels, dirty component variants, responsive behavior, data-flow documentation, duplicated capture review, auto-population opportunities, API parity, and permission boundaries.

Schema, authentication storage, approval lifecycle, report calculations, imports, and backend contracts may change only after a documented current-data-first assessment and compatibility plan. Decorative features without workflow value and replacing working business logic solely to fit a visual concept are out of scope.

## Impact and rollback

Shared CSS and `public/js/app.js` affect all authenticated screens. Changes must be incremental and verified across representative modules after every phase. Workflow or data-contract changes require SQLite/Firestore parity and API regression checks. Visual changes can roll back by reverting shared shell commits; data changes require a separate migration and rollback plan.

## Phased execution

1. Establish design tokens, icon system, action hierarchy, and one shared shell.
2. Simplify login, module selection, dashboard, and daily time capture.
3. Simplify review flows: my work, approvals, attendance exceptions, and reports.
4. Consolidate administrative UX: clients, people/access, and masters.
5. Normalize specialist modules: UDIN and Form 15CB.
6. Verify responsive, accessibility, data, permission, failure, and regression behavior.

## Open questions tracked during implementation

- Whether “My Timesheets” should be renamed “My Work” everywhere.
- Whether module selection should remain a gate after login or become a persistent workspace switcher.
- Whether staff and access management should be one screen or two explicit views.
- Which advanced report filters are used frequently enough to remain expanded.
- Which master-entry forms need bulk Excel import versus template download only.
- Which status transitions need a separate immutable audit event in a future data phase.
## Implemented product decisions

- Replaced four duplicated shell templates with one permission-aware navigation factory and thin workspace contexts.
- Reframed navigation around Daily work, Review, Firm setup, and specialist workspace tasks.
- Made the supplied Samay logo the persistent workspace switcher and removed duplicate module/back links from page headers.
- Replaced the module dropdown-and-continue sequence with three direct, descriptive workspace actions.
- Established a logo-aligned teal, cyan, and orange palette; consistent SVG navigation icons; restrained rounding; professional density; and visible focus states.
- Added skip navigation, active-page semantics, accessible mobile-menu states, reduced-motion support, and responsive action behavior.
- Simplified UDIN from an always-open AppSheet-style data-entry panel to a request register with progressive create/detail actions.
- Removed unused UDIN navigation states and the duplicate UDIN sidebar initialization path.
- Consolidated the legacy Staff screen into People & Access (`users.html`) while preserving old bookmarks through a redirect.
- Repaired Form 15CB's global API constant collision, which previously prevented every page in that module from initializing.
- Aligned SQLite UDIN permission defaults with Firebase and removed article-level update/review/revoke permissions from the browser fallback.
- Removed production-exposed prototype, obsolete “coming soon,” and abandoned timesheet backup artifacts; the service-worker shell now caches only supported product routes.

## Outcome

The application now presents one coherent product shell across firm control, timesheets, attendance, approvals, reports, UDIN, and Form 15CB. No database schema or source-of-truth duplication was introduced. The implementation removes more legacy markup and JavaScript than it adds.