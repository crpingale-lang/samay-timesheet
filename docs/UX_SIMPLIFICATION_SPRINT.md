# UX simplification sprint

## Principal problem

Samay's core workflows are small, but users must interpret multiple equivalent controls before acting. This sprint reduces choice and technical exposure in the four highest-friction paths without adding schema fields.

## Current-data-first decisions

- Time entry keeps the existing `hours`, `start_time`, and `end_time` contract. Start/end mode derives hours; duration mode saves hours with null start/end values.
- Recent-entry suggestions reuse the currently loaded timesheet entries and require an explicit user action. No pattern history or new personal data is stored.
- Access presets reuse the existing role defaults. Advanced changes continue to save the existing permission array.
- Approval grouping and review flags are derived in the browser from the existing pending-entry response. Approval API requests are unchanged.
- Attendance refresh and export use the existing APIs. No background job or additional persistence is introduced.

## Workflow decisions

### Time entry

Users choose either start/end time or duration. The inactive method is hidden, and calculated hours are read-only in start/end mode. A recent client/category pattern can be applied without copying stale narrative text.

### People and access

The selected role applies a professional default preset. Custom permission checkboxes use human labels and remain collapsed unless the stored user differs from the role preset. SQLite, Firebase, and the browser session normalizer now treat a non-empty permission array as an explicit override while always retaining firm-dashboard access.

### Approvals

The global `Approve All` shortcut is removed. Review remains selection-based, with entries grouped by staff and date and derived flags for missing notes, long entries, or missing clients on client work.

### Attendance

Correction has one primary entry point. CSV and Excel sit in one export menu, and the page refreshes visible data automatically every 60 seconds and when the tab regains visibility.

## Test matrix

| Level | Cases |
| --- | --- |
| Soft | Add duration-only entry; add start/end entry; create user with role preset; approve one selected row; open both attendance export formats. |
| Normal | Edit time and duration entries; edit a user with custom access; select multiple grouped approvals; automatic attendance refresh while visible. |
| Edge | Empty recent-entry history; approved entry locked; role with no custom differences; empty approval queue; missing notes and 10+ hour entry flags. |
| Failure | Existing API failures continue through current toast/empty-state handling; export permission denial remains server-backed. |
| Security | Only access managers see permission controls; permissions remain API-validated; approval and export API permissions are unchanged. |
| Responsive | 390x844 mobile, 768px tablet boundary, 1280x720 desktop, and wide desktop; modal scrolling and horizontal overflow checked. |
| Parity | SQLite, Firebase, and browser-session custom permission fallback behavior verified in source validation. |

## Risk and rollback

The sprint changes presentation and client-side derivation, plus one Firebase permission-normalization rule to match SQLite. Roll back by reverting the sprint commit; no data migration is required. Existing non-empty permission arrays remain valid.
