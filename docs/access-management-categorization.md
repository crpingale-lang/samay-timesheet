# Access Management Categorization

## Purpose

This document separates:

- `organization role`: the person's functional place in the firm
- `application role`: the permissions they hold inside the software

For this app, these two concerns should not be stored or interpreted as the same field.

---

## Current State Analysis

Today the app uses one field, `users.role`, for both:

- organizational identity: `partner`, `manager`, `article`
- application authorization: who can view, edit, approve, export, and manage masters

This creates tight coupling between business structure and software rights.

### Current examples in code

- `partner` can manage staff and clients
- `manager` and `partner` can access approvals and reports
- `article` is limited mostly to self timesheet work
- approval workflow is driven directly by the same `role` field

### Problems with the current model

- adding new firm functions like `hr`, `accounts`, `admin executive`, or `report viewer` becomes hard
- a person cannot easily hold one business role and a different app access level
- future delegated permissions become messy, for example:
  - manager who should not manage staff master data
  - partner who should only view reports
  - operations user who should manage clients but not approve timesheets
- audit and policy logic become harder because hierarchy and software rights are mixed

---

## Recommended Access Model

Use three layers.

### 1. Organization Role

This answers: `Who is this person in the business?`

Recommended values for this app:

- `partner`
- `manager`
- `article`
- `principal`
- `accounts`
- `hr`
- `admin_executive`
- `reporting_analyst`

This should influence workflow context, reporting structure, and screen defaults, but should not directly decide every permission.

### 2. Application Role

This answers: `What are they allowed to do in the software?`

Recommended values:

- `system_admin`
- `access_admin`
- `master_data_admin`
- `approval_manager`
- `approval_partner`
- `operations_user`
- `report_viewer`
- `self_service_user`

A user may hold one or more application roles.

### 3. Permission

This answers: `What exact action can they perform?`

Permissions should be evaluated by action, not by job title.

---

## Permission Categories For This App

The current product modules suggest these permission groups.

### A. Identity And Access

- `users.view`
- `users.create`
- `users.edit`
- `users.activate_deactivate`
- `users.reset_password`
- `users.assign_org_role`
- `users.assign_app_role`
- `access.manage`

### B. Staff Directory

- `staff.view`
- `staff.view_hours_summary`
- `staff.edit_profile_fields`

### C. Client Master

- `clients.view`
- `clients.create`
- `clients.edit`
- `clients.activate_deactivate`
- `clients.import`
- `clients.export_template`

### D. Timesheet Self-Service

- `timesheets.create_own`
- `timesheets.view_own`
- `timesheets.edit_own_draft`
- `timesheets.delete_own_draft`
- `timesheets.submit_own`
- `timesheets.resubmit_own_rejected`

### E. Timesheet Supervisory Access

- `timesheets.view_team`
- `timesheets.view_all`
- `timesheets.edit_any_nonapproved`
- `timesheets.delete_any_nonapproved`

This category should be granted carefully. It is different from approval rights.

### F. Approval Workflow

- `approvals.view_manager_queue`
- `approvals.view_partner_queue`
- `approvals.approve_level_1`
- `approvals.reject_level_1`
- `approvals.approve_level_2`
- `approvals.reject_level_2`
- `approvals.self_approve_if_allowed`

### G. Reporting And Export

- `reports.utilization.view`
- `reports.client.view`
- `reports.staff_hours.view`
- `reports.export_csv`

### H. Dashboard And Insight Access

- `dashboard.view_self`
- `dashboard.view_team`
- `dashboard.view_firm`

### I. Configuration And Audit

- `settings.manage_work_classifications`
- `settings.manage_task_types`
- `audit.view_access_changes`
- `audit.view_approval_history`

The last two are not fully implemented today, but they should exist in the target design.

---

## Suggested Application Roles

These are the software-facing roles that fit the current app and near-future needs.

### `self_service_user`

For normal staff who only manage their own timesheets.

Includes:

- own dashboard access
- own timesheet create, edit, delete, submit, resubmit
- no master data access
- no approval access
- no broad reporting access

### `approval_manager`

For first-level reviewers.

Includes:

- view manager approval queue
- approve or reject level 1
- view team dashboard
- view reports needed for supervision

Usually does not include:

- user access administration
- client master administration
- final approval

### `approval_partner`

For final approvers.

Includes:

- partner approval queue
- approve or reject level 2
- firm-wide dashboard
- management reports
- self approval only if firm policy allows

### `report_viewer`

For leadership or analysts who need visibility without edit power.

Includes:

- reports view
- dashboard view
- export if required

Does not include:

- approvals
- staff management
- client master edits

### `master_data_admin`

For operational administration of staff and client master data.

Includes:

- create and edit clients
- create and update staff records
- activate or deactivate records

Does not automatically include:

- approval rights
- access administration

### `access_admin`

For controlling software permissions.

Includes:

- assign organization roles
- assign application roles
- reset access
- manage access mappings

Should be restricted to very few users.

### `system_admin`

Top-level platform control.

Includes all permissions, including configuration and future audit capabilities.

Should be rare and used mainly for setup, emergencies, and governance.

---

## Suggested Organization Roles

These describe the person's functional identity in the firm.

### `partner`

- senior leadership
- may also hold `approval_partner`, `report_viewer`, or `system_admin`

### `manager`

- engagement or team reviewer
- may also hold `approval_manager` and `report_viewer`

### `article`

- execution staff
- usually holds `self_service_user`

### `accounts`

- finance and billing support
- may hold `report_viewer` and limited `clients.view`

### `hr`

- people administration
- may hold `master_data_admin` for staff records only if policy allows

### `admin_executive`

- support operations
- may hold `master_data_admin` for clients and non-sensitive staff profile fields

### `reporting_analyst`

- analytics and reporting
- may hold `report_viewer`

---

## Recommended Mapping For This App

This is the starting categorization I recommend for your current workflow.

| Organization role | Recommended application roles |
|---|---|
| `partner` | `approval_partner`, `report_viewer` |
| `managing_partner` or designated owner | `system_admin`, `access_admin`, `approval_partner`, `report_viewer` |
| `manager` | `approval_manager`, `report_viewer` |
| `article` | `self_service_user` |
| `accounts` | `report_viewer` |
| `hr` | `master_data_admin` |
| `admin_executive` | `master_data_admin` |
| `reporting_analyst` | `report_viewer` |

If you want stricter control, do not grant `master_data_admin` by default to `partner` or `manager`. Make it explicit.

---

## Access Categorization By Module

This is the clearest way to implement access in the app.

### Dashboard

- self metrics: `self_service_user`
- team pending approvals: `approval_manager`
- firm pending approvals and totals: `approval_partner`, `report_viewer`

### Timesheets

- create and manage own entries: `self_service_user`
- review team submissions: `approval_manager`
- review firm-level final queue: `approval_partner`

### Approvals

- first-stage approval: `approval_manager`
- second-stage approval: `approval_partner`

### Reports

- operational and management reports: `report_viewer`
- exports: `report_viewer` or stronger

### Clients

- view clients: almost all active users if needed for timesheeting
- create or edit clients: `master_data_admin`

### Staff

- view staff list: `master_data_admin`, `report_viewer`, approval roles if needed
- create or edit staff: `master_data_admin`
- assign access roles: `access_admin`

---

## Design Rules To Follow

1. Never use organization role alone to authorize screen actions.
2. Approval routing can still use organization structure, but approval permission must also exist.
3. A user can have multiple application roles.
4. Sensitive actions should check explicit permissions, not inferred seniority.
5. Navigation visibility and API authorization should both use the same permission model.

---

## Target Data Model

Recommended future structure:

### `users`

- identity fields
- `organization_role`

### `application_roles`

- role catalog like `approval_manager`, `report_viewer`

### `permissions`

- permission catalog like `clients.create`, `approvals.approve_level_2`

### `user_application_roles`

- user-to-app-role mapping

### `application_role_permissions`

- app-role-to-permission mapping

This gives the app a standard RBAC design:

`organization role -> business context`

`application role -> permission bundle`

`permission -> runtime authorization`

---

## What This Means For The Current Code

Current `users.role` should eventually be split into:

- `users.organization_role`
- one or more assigned application roles

Short-term migration path:

1. keep current `role` for approval workflow compatibility
2. add `organization_role` and `app_role` first
3. shift UI gating from `partner/manager/article` checks to permission checks
4. shift API route checks to permission checks
5. lastly, decouple approval routing from hardcoded role strings

---

## Recommended First Implementation Scope

For this app, the best first release is:

1. add `organization_role`
2. add `application_role`
3. support these initial app roles:
   - `system_admin`
   - `master_data_admin`
   - `approval_manager`
   - `approval_partner`
   - `report_viewer`
   - `self_service_user`
4. convert current route protection to use app-role-based checks
5. keep approval workflow behavior aligned with business hierarchy until phase 2

This gives immediate clarity without forcing a large rewrite in one step.
