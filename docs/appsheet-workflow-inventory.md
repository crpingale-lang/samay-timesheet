# AppSheet Workflow Inventory

This document captures the office workflow currently implemented in AppSheet so we can rebuild the backend and frontend without losing behavior.

## Sources

- AppSheet app: `PatkiandSoman-545664243-26-03-06`
- App ID: `d0c087b4-593d-4b57-a958-64136ee795a6`
- Assurance workbook: `E:\AI Projects\Appsheet DB\Assurance Tracker.xlsx`
- Attendance workbook: `E:\AI Projects\Appsheet DB\Attendance (1).xlsx`

## High-Level Split

The AppSheet app is really two products inside one shell:

- UDIN / assurance workflow
- Attendance / leave workflow

Both share the same app login/session and the same workspace selector, but they use different tables, slices, dashboards, and actions.

## Backend Model Inventory

### Assurance / UDIN

Primary workbook sheets:

- `Assurance Tracker`
- `UDIN Site Data`
- `Audit Tracker`
- `Temp`
- `Location Master`
- `Group Master`
- `Entered by Master`
- `Checked by Master`
- `Entity Master`
- `Partner Master`
- `Assignment Master`
- `Financial Year Master`
- `Users`
- `Admin Users`
- `Database Schema`

Key business entities:

- Assurance requests / assignments
- UDIN issuance
- UDIN updates
- Signed copy uploads
- Revocation tracking
- Entity / partner / assignment masters
- User and role masters

### Attendance

Primary workbook sheets:

- `Attendance`
- `Leaves`
- `Shift Masters`
- `Location Master`
- `Bulk Leave`
- `Deleted Rows Log`
- `Holidays`
- `Landing Page`

Key business entities:

- Attendance entries
- Leave requests and approvals
- Shift master configuration
- Geo-fenced office locations
- Holidays

## AppSheet Data Schemas

The app definition exposes these key schemas:

- `Assurance Tracker_Schema`
- `UDIN Site Data_Schema`
- `Attendance_Schema`
- `Leaves_Schema`
- `Shift Masters_Schema`
- `Location Master 2_Schema`

Important design points:

- `Assurance Tracker` is the central UDIN workflow table.
- `UDIN Site Data` stores UDIN-specific records and validity flags.
- `Attendance` is the operational time log.
- `Leaves` is the attendance leave workflow.
- The app reuses shared users, but location concepts are split between assurance and attendance.

## UDIN Workflow

### Core Views and Slices

- `For Reviewer`
- `Add Assignment`
- `UDIN Updation`
- `For Signed Copy Upload`
- `For UDIN Revocation`
- `UDIN Not updated`
- `Blank UDIN not editable`
- `For Dashboard`
- `Managers Dashboard`
- `Approve UDIN request`
- `UDIN Expiry Tracker`

### What the workflow does

- Creates a new assignment request.
- Routes it to reviewer approval.
- Lets the reviewer approve or reject.
- Supports UDIN entry and later UDIN update.
- Supports signed certificate / copy upload.
- Tracks revocation windows and revocation eligibility.
- Flags requests where UDIN has not been filled yet.
- Prevents duplicate UDIN values.

### Notable rules

- `For Reviewer` shows unassigned rows without UDIN.
- `UDIN Updation` shows rows with approved status.
- `For UDIN Revocation` is limited to recent UDIN generation records.
- `Blank UDIN not editable` blocks editing until the UDIN exists.
- The app has explicit workspace gating for `UDIN Tracker`.

### Important UDIN fields

- `Unique ID`
- `Date of request`
- `Name of Entiry`
- `Type of Assignment`
- `Entered by`
- `Location`
- `Name of the party`
- `Folder Number`
- `Path for documentation`
- `Initiated by`
- `Original UDIN`
- `Original Income Tax Acknowoledgement Number`
- `Internal Reference for UDIN`
- `UDIN`
- `Approval Status`
- `Revocation`
- `Copy of Certificate`

## Attendance Workflow

### Core Views and Slices

- `Attendance Dashboard`
- `Add Attendance Record`
- `Attendance_Form`
- `Create attendance Record`
- `Attendance for today`
- `Past Attendance Data`
- `Missing Attendance for Today`
- `Upcoming Leaves`
- `Upcoming Leaves All`
- `People on Leave Today`
- `Upcoming Holidays`

### What the workflow does

- Lets a user create an attendance record from a form.
- Uses location selection and geofence checks.
- Shows today’s attendance, missing attendance, and leave-aware panels.
- Displays historical attendance.
- Tracks hours worked and late-mark information.
- Supports leave visibility from the same workspace.

### Notable rules

- `Add Attendance Record` is visible only in the `Attendance` workspace and to the right roles.
- `Attendance_Form` captures entry time, entry location, selected office location, and distance.
- `Create attendance Record` is the slice used for record creation and filtering.
- `Attendance for today` shows only today’s rows.
- `Missing Attendance for Today` filters users with missing check-in data.

### Important attendance fields

- `Name`
- `Date`
- `Entry Time`
- `Exit Time`
- `Location`
- `Entry Location`
- `Exit Location`
- `Distance`
- `Hours Worked`
- `Approved`
- `Approved By`
- `Late Mark regularised?`
- `Late mark Approver`
- `Check In Overridden?`
- `Check Out Overridden?`
- `Final Check in Time`
- `Final Check out Time`

## Current Frontend Mapping

### Already present

- `public/module-select.html`
- `public/attendance.html`
- `public/udin-coming-soon.html`
- `public/dashboard.html`
- `public/js/app.js`
- `functions/routes/auth.js`
- `functions/routes/master-data.js`
- `functions/routes/attendance.js`

### What is already live

- Module switching is implemented.
- Attendance check-in and log viewing are implemented.
- Attendance location loading and geofence validation are implemented.
- Authentication and role permissions are implemented.

### What is still missing

- A real UDIN frontend.
- UDIN reviewer queue.
- UDIN approval/update screens.
- Signed copy upload flow.
- UDIN revocation flow.
- Attendance approval / override / late-mark management matching AppSheet behavior.

## Backend Mapping

### Existing backend routes

- `/api/auth`
- `/api/master-data`
- `/api/attendance`
- `/api/timesheets`
- `/api/reports`
- `/api/staff`
- `/api/clients`
- `/api/feedback`
- `/api/form15cb`

### Attendance backend behavior

- Reads from `attendance_records`.
- Filters by date, user, and query.
- Creates manual check-ins with geofence enforcement.
- Uses office locations and radius rules from master data.

### Permission model

The current role model already includes:

- `attendance.view_own`
- `attendance.create_own`
- `attendance.view_reports`
- `dashboard.view_self`
- `dashboard.view_team`
- `dashboard.view_firm`

## Key Gaps To Rebuild The AppSheet Workflow

1. Build a proper UDIN backend model.
2. Add reviewer queue and status transitions.
3. Add signed copy upload storage.
4. Add revocation state and audit trail.
5. Add attendance approval and override states.
6. Add late-mark regularization flows.
7. Add leave approvals and upcoming-leave views.
8. Add dashboard panels that mirror the AppSheet dashboards.

## Suggested Rebuild Order

1. UDIN data model and API.
2. UDIN reviewer and approval UI.
3. Signed copy upload and revocation flows.
4. Attendance approval / override parity.
5. Leave panels and dashboard widgets.
6. Final permission tuning and menu routing.

## Notes

- The AppSheet workbook contains sensitive data such as passwords and GPS coordinates. Those should not be copied into the new backend as-is.
- The AppSheet app uses workspace switching as a major routing concept. Any rebuild should preserve that mental model so office users do not lose context.
