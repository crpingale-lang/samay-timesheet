# Mobile Design Audit Report — Samay App
**Scope:** On-site (browser) + PWA  
**Audit Date:** 2026-04-09  
**Breakpoint audited:** ≤ 768px (matches the app's single responsive breakpoint)

---

## CRITICAL — Visible Spills / Overlaps

---

### Bug 1 — Toast notifications overlap the bottom navigation bar

**Files:** `public/css/style.css`  
**Lines:** 471 (toast-container), 1970–1982 (bottom-nav mobile)

**What happens:**  
The toast container is pinned at `bottom: 18px` across all screen sizes. On mobile, the bottom nav bar is also fixed at `bottom: 0` and is roughly 66 px tall (10 px top padding + 28 px icon + 4 px gap + ~12 px label + 12 px bottom padding). A toast appearing at `bottom: 18px` lands squarely inside the bottom nav, getting visually hidden or clipped underneath it.

**Current CSS:**
```css
/* style.css line 471 */
.toast-container { position: fixed; bottom: 18px; right: 18px; z-index: 9999; }
```

**Fix — add to the mobile media query (≤ 768px):**
```css
@media (max-width: 768px) {
  .toast-container { bottom: 82px; right: 12px; }
}
```

---

### Bug 2 — "My Timesheets" stat grid stays 4-column on mobile (inline style override)

**File:** `public/my-timesheets.html`  
**Line:** 44

**What happens:**  
The element has an inline `style="grid-template-columns:repeat(4,1fr)"` which has higher CSS specificity than any stylesheet rule, including rules inside `@media` queries. This prevents the responsive rule `.stats-grid { grid-template-columns: 1fr; }` from ever firing on mobile. Four stat cards are crammed side-by-side into ~375 px — text truncates, values overflow, and cards become unreadably narrow.

**Current HTML:**
```html
<div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px;">
```

**Fix:**
```html
<div class="stats-grid" style="margin-bottom:16px;">
```
The responsive CSS class already handles the 1-column collapse. The `margin-bottom` inline style is harmless and can stay.

---

### Bug 3 — Entry modal action bar loses edge-to-edge bleed on mobile (inline style override)

**File:** `public/timesheet.html`  
**Line:** 246

**What happens:**  
The modal footer in the entry modal carries an inline `style="display:flex;gap:8px;margin-top:16px;"`. On mobile, the `.modal-actions` CSS rule is:
```css
margin: 16px -16px 0;   /* negative horizontal margins for edge-to-edge */
padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
position: sticky; bottom: 0;
```
The inline `margin-top:16px` overrides `margin: 16px -16px 0`, dropping the `-16px` side margins. The sticky footer no longer bleeds edge-to-edge — it leaves a 16 px gap on each side, looking like a floating box rather than a screen-anchored bar.

**Current HTML:**
```html
<div class="modal-actions" style="display:flex;gap:8px;margin-top:16px;">
```

**Fix:**
```html
<div class="modal-actions">
```
Remove the inline style entirely. The class already provides `display:flex`, `gap`, and margin.

---

### Bug 4 — Modal action buttons are not sticky on Approvals, Staff, and Clients pages

**Files:**  
- `public/approvals.html` — line 87 (Reject modal)
- `public/staff.html` — line 98 (Staff modal Save/Cancel)
- `public/clients.html` — line 75 (Client modal Save/Cancel), line 113 (Import modal Import/Back)

**What happens:**  
All four modals expand full-screen on mobile (`width: 100vw; height: var(--app-vh)`). Their action buttons sit inside plain `<div style="display:flex;gap:8px;...">` elements instead of a `.modal-actions` div. They do not receive the `position: sticky; bottom: 0` sticky-footer treatment. On long-form modals (Staff has 8 form rows; Import preview can have many rows), users must scroll to the very bottom to find Save/Cancel — and the buttons are not visible without scrolling.

**Current HTML (example — approvals.html line 87):**
```html
<div style="display:flex;gap:8px;margin-top:12px;">
  <button class="btn btn-danger" ...>Reject</button>
  <button class="btn btn-ghost" ...>Cancel</button>
</div>
```

**Fix for each location:**
```html
<div class="modal-actions">
  <button class="btn btn-danger" ...>Reject</button>
  <button class="btn btn-ghost" ...>Cancel</button>
</div>
```
Apply the same change to `staff.html:98`, `clients.html:75`, `clients.html:113`.

---

## MEDIUM — Unfitting Elements / Bad UX

---

### Bug 5 — Import preview table (6 columns) overflows on mobile without horizontal scroll

**File:** `public/clients.html`  
**Lines:** 107–112

**What happens:**  
The CSV import step-2 preview renders a plain `<table>` with 6 columns (Name, Code, Contact, Phone, Rate, Status) inside a `max-height:260px; overflow-y:auto` container. The container has no `overflow-x:auto` and the table has no `.mobile-stack-table` class. On mobile with the global `overflow-x: visible` rule applied to `.table-wrapper`, the table overflows outside its card, causing columns to spill off the right edge of the screen.

**Fix:**
```html
<!-- current -->
<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">

<!-- fix -->
<div style="max-height:260px;overflow-y:auto;overflow-x:auto;border:1px solid var(--border);border-radius:8px;">
```
Alternatively, make the preview table a `.mobile-stack-table` so it stacks on mobile.

---

### Bug 6 — Topbar left container missing `min-width: 0` on Approvals, My Timesheets, and Staff pages

**Files:**  
- `public/approvals.html` line 15  
- `public/my-timesheets.html` line 14  
- `public/staff.html` line 15  

**What happens:**  
The topbar left div (containing the hamburger + title) uses `display:flex` but no `min-width:0`. Without `min-width:0`, a flex child can never shrink below its intrinsic content width. If the page title is long or if the `topbar-actions` on the right has many buttons, the title overflows the topbar header rather than truncating. Compare with `dashboard.html` and `reports.html` which correctly include `min-width:0` on this container.

**Current HTML (approvals.html line 15):**
```html
<div style="display:flex;align-items:center;gap:10px;">
```

**Fix:**
```html
<div style="display:flex;align-items:center;gap:10px;min-width:0;">
```
Apply the same fix to `my-timesheets.html` and `staff.html`.

---

### Bug 7 — Clients topbar 3-button group collapses to unbalanced 2-column grid on mobile

**File:** `public/clients.html`  
**Line:** 19–23

**What happens:**  
The Clients page topbar has three action buttons (Template, Import CSV, + Add Client) inside `.topbar-actions.topbar-button-group`. On mobile, the `.topbar-button-group` CSS applies `grid-template-columns: repeat(2, minmax(0, 1fr))`. Three buttons in a 2-column grid means: row 1 has Template + Import CSV (equal width), row 2 has "+ Add Client" alone in column 1 (half the row width). The layout looks unbalanced, and the primary action button is visually undersized compared to the two utility buttons.

**Fix option A — 3-column grid for this specific group on mobile:**
```css
/* Add to the ≤768px media query */
.topbar-actions.topbar-button-group {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
```

**Fix option B — hide the less-used Template button on mobile:**
```html
<button class="btn btn-ghost btn-sm hide-mobile" id="template-btn" ...>Template</button>
```

---

### Bug 8 — Date navigation buttons may squeeze the date input below usable width on very small screens

**File:** `public/css/style.css`  
**Lines:** 1932–1956 (proto-date-group mobile override)

**What happens:**  
The mobile date toolbar uses:
```css
grid-template-columns: minmax(0, 1.35fr) minmax(88px, 0.82fr) minmax(88px, 0.82fr);
```
Each nav button has a hard minimum of 88 px. On a 320 px screen (288 px available after 16 px padding each side), two buttons consume at least 176 px + 2×8 px gap = 192 px, leaving only ~96 px for the date input. A native date `<input>` on iOS/Android becomes unusable below ~120 px.

**Fix:**
```css
@media (max-width: 360px) {
  .proto-date-group {
    grid-template-columns: 1fr minmax(72px, 0.7fr) minmax(72px, 0.7fr);
  }
  .proto-date-nav-btn {
    font-size: 12px;
    padding-inline: 6px;
  }
}
```

---

## MINOR — CSS Authoring / Polish

---

### Issue 9 — `flex-direction: column` applied to a grid container in report media query

**File:** `public/css/style.css`  
**Lines:** 2387–2390

```css
@media (max-width: 768px) {
  .report-summary-head,
  .report-sidebar-actions {
    grid-template-columns: 1fr;
    flex-direction: column;  /* ← has no effect on grid containers */
  }
}
```
`.report-sidebar-actions` is `display:grid`. The `flex-direction: column` rule is silently ignored. Only `grid-template-columns: 1fr` has effect. This causes no visible bug since the stacking still works, but it's a dead declaration.

**Fix:** Remove `flex-direction: column` from this rule block (it belongs on `.report-summary-head` only, which is flex).

---

### Issue 10 — Modal close buttons use literal "X" text instead of `&times;`

**Files:** `public/staff.html:58`, `public/clients.html:56`, `public/clients.html:85`

The `.modal-close` CSS sizes the button at `font-size: 18px`. The character `&times;` (×) renders cleanly at this size; the letter `X` does not align visually on all platforms. `timesheet.html` and `approvals.html` use `&times;` correctly.

**Fix:** Replace `X` with `&times;` in the three affected locations.

---

### Issue 11 — `mobile-sticky-actions` hardcoded `bottom: 74px` may drift from actual bottom-nav height

**File:** `public/css/style.css`  
**Line:** 2225

```css
.mobile-sticky-actions { bottom: 74px; }
```
The bottom nav height is not defined as a CSS variable, so if the nav ever grows (e.g., due to safe-area-inset on newer phones or label text wrapping), the sticky actions will overlap it or leave a gap. Consider:
```css
:root { --bottom-nav-height: 74px; }
.mobile-sticky-actions { bottom: var(--bottom-nav-height); }
.page-content { padding-bottom: calc(var(--bottom-nav-height) + 34px); } /* replace 108px */
```

---

## Summary Table

| # | Severity | File(s) | Issue |
|---|----------|---------|-------|
| 1 | Critical | style.css | Toast overlaps bottom nav |
| 2 | Critical | my-timesheets.html | Stats grid inline style prevents 1-col collapse |
| 3 | Critical | timesheet.html | Modal-actions inline margin breaks edge-to-edge footer |
| 4 | Critical | approvals / staff / clients | Modal action buttons not sticky on full-screen mobile modal |
| 5 | Medium | clients.html | Import preview table overflows (no overflow-x:auto) |
| 6 | Medium | approvals / my-timesheets / staff | Topbar left container missing min-width:0 |
| 7 | Medium | clients.html | 3-button topbar collapses unevenly to 2-col grid |
| 8 | Medium | style.css | Date nav buttons may crush date input on very small screens |
| 9 | Minor | style.css | Dead flex-direction:column on grid element in reports query |
| 10 | Minor | staff / clients | Modal close uses "X" text instead of &times; |
| 11 | Minor | style.css | Sticky actions bottom: 74px hardcoded, not CSS-variable-driven |
