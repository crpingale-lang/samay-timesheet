# Samay data usage and change-risk map

## Current-data-first decision

The first revamp phase does not require new database tables or fields. Navigation, action hierarchy, labels, layout, validation presentation, and component consistency can be improved with existing data and APIs. Any later data change must prove that linking, derivation, API shaping, indexing, or an existing master cannot satisfy the workflow.

## Source-of-truth map

| Data | Source of truth | Main consumers | Update path | Sensitivity |
| --- | --- | --- | --- | --- |
| User identity, role, permissions | `users` / Firestore `users` | Login, navigation, access, approvals, reports | Auth and staff APIs | High |
| Client identity and billing metadata | `clients` | Time entry, clients, reports, Form 15CB context | Client APIs and import | Medium-high |
| Work categories/classifications | `master_data_options` / master-data API | Time entry, badges, reports | Timesheet Masters | Medium |
| Time entries and approval state | `timesheet_entries` / Firestore timesheets | Daily capture, my work, approvals, dashboards, reports | Timesheet APIs | High |
| Entry collaborators/invitations | Collaboration tables / Firestore equivalents | Time entry and collaboration requests | Timesheet APIs | Medium-high |
| Attendance punches, corrections, locations | Attendance storage and master locations | Attendance, reports, corrections | Attendance APIs | High; location data |
| UDIN requests, files, review state | UDIN storage | UDIN register, approval, expiry, uploads | UDIN APIs | High; compliance documents |
| Form 15CB masters/conversions | Form 15CB storage/templates | Conversion, history, downloads | Form 15CB APIs | High; tax/remittance data |
| Feedback | Feedback storage | Feedback form and reports | Feedback APIs | Potentially sensitive |
| Session state | JWT plus cached browser user | All frontend API calls | Auth APIs and session helpers | High |

## Existing links and auto-population opportunities

- Current user, role, and permissions determine navigation and defaults.
- Client selection supplies client code and configured shift/site defaults.
- Work categories/classifications come from master data, not page-local lists.
- Attendance location choices come from master locations.
- UDIN assignment, financial year, and location values link to masters.
- Form 15CB repeated party and bank data comes from existing masters.
- Report filters derive values from records and master APIs.

## Redundancy risks

- SQLite and Firestore routes can drift in validation, permissions, fields, and errors.
- `staff.html` and `users.html` overlap conceptually.
- Firm, Timesheet, and Form 15CB masters use different interaction patterns.
- Status labels are interpreted separately across dashboard, timesheets, approvals, and reports.
- Inline UI logic duplicates shared formatting and validation.

## Change-risk levels

**Low-risk presentation:** shared tokens, icons, labels, spacing, action grouping, responsive layout, and feedback states. Verify all screens and roles.

**Medium-risk workflow presentation:** moving actions, collapsing filters, renaming navigation, changing defaults, or consolidating screens. Verify discoverability, keyboard/touch behavior, saved view state, and role-specific paths.

**High-risk data or contract:** fields, tables, status transitions, authentication storage, imports/exports, permissions, report calculations, or API response shapes. Require SQLite/Firestore parity, migration and rollback, historical accuracy, permission review, and API/export regression tests.

## Security boundary

Passwords, signing secrets, database credentials, document processing, privileged exports, and permissions stay server-side. Browser code is public. Browser-readable JWT storage is documented security debt and must not be expanded; secure HTTP-only cookie migration is a separate high-risk authentication project.

## Excel import assessment

- Clients: required and already supported.
- Holidays: required and already supported.
- Users/access: useful but high-risk because permissions and credentials need row-level validation; defer until specified securely.
- Work categories/classifications: low normal volume; retain manual entry until evidence supports import.
- Form 15CB masters: potentially useful for remitters, remittees, and banks; reassess after master UX normalization.
- Transactional timesheets and approvals: no bulk import in the UX revamp phase.