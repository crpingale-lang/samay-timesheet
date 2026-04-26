const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  serializePermissions,
  getDefaultPermissions,
  ensurePermissions
} = require('./permissions');

const dbDir = process.env.TIMESHEET_DB_DIR || path.join(os.tmpdir(), 'timesheet-local-db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'timesheet.db'));

const DEFAULT_MASTER_DATA = {
  work_classification: [
    { key: 'client_work', label: 'Client Work', short_label: 'Client', sort_order: 1 },
    { key: 'internal', label: 'Internal', short_label: 'Internal', sort_order: 2 },
    { key: 'admin', label: 'Admin', short_label: 'Admin', sort_order: 3 },
    { key: 'business_development', label: 'Business Development', short_label: 'Biz Dev', sort_order: 4 },
    { key: 'learning', label: 'Learning', short_label: 'Learning', sort_order: 5 }
  ],
  work_category: [
    { key: 'gst_filing', label: 'GST Filing', sort_order: 1 },
    { key: 'gst_reconciliation', label: 'GST Reconciliation', sort_order: 2 },
    { key: 'income_tax_return', label: 'Income Tax Return', sort_order: 3 },
    { key: 'tds_tcs_filing', label: 'TDS / TCS Filing', sort_order: 4 },
    { key: 'statutory_audit', label: 'Statutory Audit', sort_order: 5 },
    { key: 'tax_audit', label: 'Tax Audit', sort_order: 6 },
    { key: 'internal_audit', label: 'Internal Audit', sort_order: 7 },
    { key: 'roc_mca_filing', label: 'ROC / MCA Filing', sort_order: 8 },
    { key: 'company_incorporation', label: 'Company Incorporation', sort_order: 9 },
    { key: 'accounts_bookkeeping', label: 'Accounts & Bookkeeping', sort_order: 10 },
    { key: 'payroll_processing', label: 'Payroll Processing', sort_order: 11 },
    { key: 'advisory_consultation', label: 'Advisory / Consultation', sort_order: 12 },
    { key: 'client_meeting', label: 'Client Meeting', sort_order: 13 },
    { key: 'internal_meeting', label: 'Internal Meeting', sort_order: 14 },
    { key: 'training_cpd', label: 'Training / CPD', sort_order: 15 },
    { key: 'fema_rbi_compliance', label: 'FEMA / RBI Compliance', sort_order: 16 },
    { key: 'administrative', label: 'Administrative', sort_order: 17 },
    { key: 'other', label: 'Other', sort_order: 18 }
  ],
  udin_assignment: [
    { key: 'certificate', label: 'Certificate', short_label: 'CERT', sort_order: 1 },
    { key: 'consultancy', label: 'Consultancy', short_label: 'CONS', sort_order: 2 },
    { key: 'professional_services', label: 'Professional Services', short_label: 'PS', sort_order: 3 }
  ],
  financial_year: [
    { key: '2024-25', label: '2024-25', short_label: '2024-25', sort_order: 1 },
    { key: '2025-26', label: '2025-26', short_label: '2025-26', sort_order: 2 },
    { key: '2026-27', label: '2026-27', short_label: '2026-27', sort_order: 3 }
  ]
};

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'article',
    permissions TEXT NOT NULL DEFAULT '[]',
    mfa_method TEXT NOT NULL DEFAULT 'sms',
    mfa_secret TEXT,
    mfa_confirmed_at TEXT,
    email TEXT,
    mobile_number TEXT,
    designation TEXT,
    department TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    last_activity_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS trusted_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    device_label TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT DEFAULT (datetime('now')),
    revoked_at TEXT,
    revoked_by_user_id INTEGER,
    UNIQUE(user_id, device_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (revoked_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    billing_rate REAL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS timesheet_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    client_id INTEGER,
    task_type TEXT NOT NULL,
    description TEXT,
    start_time TEXT,
    end_time TEXT,
    hours REAL NOT NULL DEFAULT 0,
    work_classification TEXT NOT NULL DEFAULT 'client_work',
    billable INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',
    rejection_reason TEXT,
    collaboration_source_entry_id INTEGER,
    collaboration_request_id INTEGER,
    requires_time_confirmation INTEGER NOT NULL DEFAULT 0,
    approved_by_manager INTEGER,
    approved_by_partner INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );

  CREATE TABLE IF NOT EXISTS timesheet_entry_collaborators (
    entry_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (entry_id, user_id),
    FOREIGN KEY (entry_id) REFERENCES timesheet_entries(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS timesheet_collaboration_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_entry_id INTEGER NOT NULL,
    source_user_id INTEGER NOT NULL,
    target_user_id INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    client_id INTEGER,
    task_type TEXT NOT NULL,
    description TEXT,
    start_time TEXT,
    end_time TEXT,
    hours REAL NOT NULL DEFAULT 0,
    work_classification TEXT NOT NULL DEFAULT 'client_work',
    status TEXT NOT NULL DEFAULT 'pending',
    accepted_entry_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source_entry_id, target_user_id),
    FOREIGN KEY (source_entry_id) REFERENCES timesheet_entries(id),
    FOREIGN KEY (source_user_id) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id),
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (accepted_entry_id) REFERENCES timesheet_entries(id)
  );

  CREATE TABLE IF NOT EXISTS leave_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    leave_date TEXT NOT NULL,
    leave_type TEXT NOT NULL DEFAULT 'full',
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS master_data_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    short_label TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(category, key)
  );

  CREATE TABLE IF NOT EXISTS timesheet_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_date TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    holiday_type TEXT NOT NULL DEFAULT 'holiday',
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS timesheet_shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    start_time TEXT NOT NULL DEFAULT '10:00',
    end_time TEXT NOT NULL DEFAULT '18:30',
    active INTEGER NOT NULL DEFAULT 1,
    default_for_new_clients INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS timesheet_client_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    site_name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    shift_id INTEGER,
    shift_start TEXT NOT NULL DEFAULT '10:00',
    shift_end TEXT NOT NULL DEFAULT '18:30',
    radius_meters INTEGER NOT NULL DEFAULT 50,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(client_id, site_name),
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (shift_id) REFERENCES timesheet_shifts(id)
  );

  CREATE TABLE IF NOT EXISTS location_master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location TEXT NOT NULL UNIQUE,
    short_name TEXT,
    latitude REAL,
    longitude REAL,
    radius_meters INTEGER NOT NULL DEFAULT 50,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    person_name TEXT,
    display_name TEXT,
    username TEXT,
    user_role TEXT,
    user_active INTEGER NOT NULL DEFAULT 1,
    attendance_date TEXT NOT NULL,
    entry_time TEXT,
    exit_time TEXT,
    location TEXT,
    location_id TEXT,
    location_type TEXT,
    check_in_location TEXT,
    check_out_location TEXT,
    check_out_location_id TEXT,
    shift_start TEXT NOT NULL DEFAULT '10:00',
    shift_end TEXT NOT NULL DEFAULT '18:30',
    check_in_latitude REAL,
    check_in_longitude REAL,
    check_in_distance_meters REAL,
    check_out_latitude REAL,
    check_out_longitude REAL,
    check_out_distance_meters REAL,
    hours_worked REAL NOT NULL DEFAULT 0,
    attendance_status TEXT NOT NULL DEFAULT 'checked_in',
    late_mark_entry TEXT NOT NULL DEFAULT 'No',
    late_mark_exit TEXT NOT NULL DEFAULT '-',
    entry_diff_minutes INTEGER,
    exit_diff_minutes INTEGER,
    record_source TEXT NOT NULL DEFAULT 'manual',
    approved TEXT NOT NULL DEFAULT 'system',
    correction_status TEXT,
    corrected_by_user_id INTEGER,
    corrected_by_name TEXT,
    corrected_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, attendance_date),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS attendance_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    requested_by_user_id INTEGER NOT NULL,
    requested_by_name TEXT,
    reason TEXT NOT NULL,
    requested_entry_time TEXT,
    requested_exit_time TEXT,
    requested_location_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_by_user_id INTEGER,
    resolved_by_name TEXT,
    resolution_note TEXT,
    resolved_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (record_id) REFERENCES attendance_records(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
    FOREIGN KEY (resolved_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS udin_location_master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location TEXT NOT NULL UNIQUE,
    short_name TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS udin_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_revised TEXT DEFAULT 'Original',
    unique_id TEXT NOT NULL UNIQUE,
    date_of_request TEXT NOT NULL,
    entity_name TEXT NOT NULL,
    entity_short_name TEXT,
    branch TEXT,
    assignment_type TEXT NOT NULL,
    assignment_type_short TEXT,
    entered_by_user_id INTEGER NOT NULL,
    entered_by_name TEXT,
    location_id INTEGER,
    location_name TEXT,
    location_short_name TEXT,
    party_name TEXT NOT NULL,
    folder_number TEXT,
    financial_year TEXT,
    path_for_documentation TEXT,
    initiated_by_user_id INTEGER,
    initiated_by_name TEXT,
    original_udin TEXT,
    original_income_tax_acknowledgement_number TEXT,
    internal_reference_for_udin TEXT,
    remittance_approver TEXT,
    approval_status TEXT DEFAULT 'Pending Review',
    workflow_status TEXT DEFAULT 'pending_review',
    reviewed_by_user_id INTEGER,
    reviewed_by_name TEXT,
    reviewed_at TEXT,
    rejection_reason TEXT,
    udin TEXT,
    udin_generation_date TEXT,
    revocation TEXT,
    revocation_reason TEXT,
    revocation_requested_by_user_id INTEGER,
    revocation_requested_at TEXT,
    revoked_by_user_id INTEGER,
    revoked_at TEXT,
    copy_of_certificate_name TEXT,
    income_tax_acknowledgement_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (entered_by_user_id) REFERENCES users(id),
    FOREIGN KEY (initiated_by_user_id) REFERENCES users(id),
    FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id),
    FOREIGN KEY (location_id) REFERENCES location_master(id)
  );

  CREATE TABLE IF NOT EXISTS udin_request_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT,
    file_blob BLOB NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(request_id, field_name),
    FOREIGN KEY (request_id) REFERENCES udin_requests(id)
  );

  CREATE TABLE IF NOT EXISTS udin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor_user_id INTEGER,
    actor_name TEXT,
    actor_role TEXT,
    payload_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (request_id) REFERENCES udin_requests(id),
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS feedback_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_type TEXT NOT NULL,
    submitted_by_user_id INTEGER NOT NULL,
    submitted_by_name TEXT NOT NULL,
    submitted_by_username TEXT NOT NULL,
    submitted_by_role TEXT NOT NULL,
    submitted_by_designation TEXT,
    payload_json TEXT NOT NULL,
    submitted_date TEXT NOT NULL,
    submitted_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(feedback_type, submitted_by_user_id)
  );
`);

// Migrate: add new columns if they don't exist (safe for existing DBs)
const cols = db.prepare("PRAGMA table_info(timesheet_entries)").all().map(c => c.name);
if (!cols.includes('approved_by_manager')) {
  db.exec("ALTER TABLE timesheet_entries ADD COLUMN approved_by_manager INTEGER");
}
if (!cols.includes('approved_by_partner')) {
  db.exec("ALTER TABLE timesheet_entries ADD COLUMN approved_by_partner INTEGER");
}
if (!cols.includes('start_time')) {
  db.exec("ALTER TABLE timesheet_entries ADD COLUMN start_time TEXT");
}
if (!cols.includes('end_time')) {
  db.exec("ALTER TABLE timesheet_entries ADD COLUMN end_time TEXT");
}
if (!cols.includes('work_classification')) {
  db.exec("ALTER TABLE timesheet_entries ADD COLUMN work_classification TEXT NOT NULL DEFAULT 'client_work'");
}
if (!cols.includes('collaboration_source_entry_id')) {
  db.exec("ALTER TABLE timesheet_entries ADD COLUMN collaboration_source_entry_id INTEGER");
}
if (!cols.includes('collaboration_request_id')) {
  db.exec("ALTER TABLE timesheet_entries ADD COLUMN collaboration_request_id INTEGER");
}
if (!cols.includes('requires_time_confirmation')) {
  db.exec("ALTER TABLE timesheet_entries ADD COLUMN requires_time_confirmation INTEGER NOT NULL DEFAULT 0");
}
db.exec(`
  UPDATE timesheet_entries
  SET work_classification = CASE
    WHEN work_classification IS NULL OR work_classification = '' THEN CASE WHEN billable = 1 THEN 'client_work' ELSE 'internal' END
    ELSE work_classification
  END
`);

// Migrate roles: rename old 'admin' -> 'partner', 'staff' -> 'article'
db.exec("UPDATE users SET role='partner' WHERE role='admin'");
db.exec("UPDATE users SET role='article' WHERE role='staff'");

const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('permissions')) {
  db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]'");
}
if (!userCols.includes('mfa_method')) {
  db.exec("ALTER TABLE users ADD COLUMN mfa_method TEXT NOT NULL DEFAULT 'sms'");
}
if (!userCols.includes('mfa_secret')) {
  db.exec("ALTER TABLE users ADD COLUMN mfa_secret TEXT");
}
if (!userCols.includes('mfa_confirmed_at')) {
  db.exec("ALTER TABLE users ADD COLUMN mfa_confirmed_at TEXT");
}
if (!userCols.includes('email')) {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT");
}
if (!userCols.includes('mobile_number')) {
  db.exec("ALTER TABLE users ADD COLUMN mobile_number TEXT");
}
if (!userCols.includes('last_login_at')) {
  db.exec("ALTER TABLE users ADD COLUMN last_login_at TEXT");
}
if (!userCols.includes('last_activity_at')) {
  db.exec("ALTER TABLE users ADD COLUMN last_activity_at TEXT");
}
db.exec("UPDATE users SET mfa_method='sms' WHERE mfa_method IS NULL OR mfa_method = ''");

const trustedDeviceCols = db.prepare("PRAGMA table_info(trusted_devices)").all().map(c => c.name);
if (!trustedDeviceCols.length) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      device_label TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT DEFAULT (datetime('now')),
      revoked_at TEXT,
      revoked_by_user_id INTEGER,
      UNIQUE(user_id, device_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (revoked_by_user_id) REFERENCES users(id)
    );
  `);
}

const feedbackCols = db.prepare("PRAGMA table_info(feedback_submissions)").all().map(c => c.name);
if (!feedbackCols.length) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_type TEXT NOT NULL,
      submitted_by_user_id INTEGER NOT NULL,
      submitted_by_name TEXT NOT NULL,
      submitted_by_username TEXT NOT NULL,
      submitted_by_role TEXT NOT NULL,
      submitted_by_designation TEXT,
      payload_json TEXT NOT NULL,
      submitted_date TEXT NOT NULL,
      submitted_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(feedback_type, submitted_by_user_id)
    );
  `);
} else if (!feedbackCols.includes('submitted_date')) {
  db.exec("ALTER TABLE feedback_submissions ADD COLUMN submitted_date TEXT NOT NULL DEFAULT ''");
}
if (!feedbackCols.includes('submitted_at')) {
  db.exec("ALTER TABLE feedback_submissions ADD COLUMN submitted_at TEXT DEFAULT (datetime('now'))");
}

const holidayCols = db.prepare("PRAGMA table_info(timesheet_holidays)").all().map(c => c.name);
if (!holidayCols.length) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS timesheet_holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      holiday_date TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      holiday_type TEXT NOT NULL DEFAULT 'holiday',
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

const shiftCols = db.prepare("PRAGMA table_info(timesheet_shifts)").all().map(c => c.name);
if (!shiftCols.length) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS timesheet_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      start_time TEXT NOT NULL DEFAULT '10:00',
      end_time TEXT NOT NULL DEFAULT '18:30',
      active INTEGER NOT NULL DEFAULT 1,
      default_for_new_clients INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

const siteCols = db.prepare("PRAGMA table_info(timesheet_client_sites)").all().map(c => c.name);
if (!siteCols.length) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS timesheet_client_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      site_name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      shift_id INTEGER,
      shift_start TEXT NOT NULL DEFAULT '10:00',
      shift_end TEXT NOT NULL DEFAULT '18:30',
      radius_meters INTEGER NOT NULL DEFAULT 50,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(client_id, site_name),
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (shift_id) REFERENCES timesheet_shifts(id)
    );
  `);
}

const locationCols = db.prepare("PRAGMA table_info(location_master)").all().map(c => c.name);
if (!locationCols.length) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS location_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL UNIQUE,
      short_name TEXT,
      latitude REAL,
      longitude REAL,
      radius_meters INTEGER NOT NULL DEFAULT 50,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
if (!locationCols.includes('short_name')) {
  db.exec("ALTER TABLE location_master ADD COLUMN short_name TEXT");
}

const udinLocationCols = db.prepare("PRAGMA table_info(udin_location_master)").all().map(c => c.name);
if (!udinLocationCols.length) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS udin_location_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL UNIQUE,
      short_name TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
if (!udinLocationCols.includes('short_name')) {
  db.exec("ALTER TABLE udin_location_master ADD COLUMN short_name TEXT");
}

const udinCols = db.prepare("PRAGMA table_info(udin_requests)").all().map(c => c.name);
if (!udinCols.length) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS udin_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_revised TEXT DEFAULT 'Original',
      unique_id TEXT NOT NULL UNIQUE,
      date_of_request TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      entity_short_name TEXT,
      branch TEXT,
      assignment_type TEXT NOT NULL,
      assignment_type_short TEXT,
      entered_by_user_id INTEGER NOT NULL,
      entered_by_name TEXT,
      location_id INTEGER,
      location_name TEXT,
      location_short_name TEXT,
      party_name TEXT NOT NULL,
      folder_number TEXT,
      financial_year TEXT,
      path_for_documentation TEXT,
      initiated_by_user_id INTEGER,
      initiated_by_name TEXT,
      original_udin TEXT,
      original_income_tax_acknowledgement_number TEXT,
      internal_reference_for_udin TEXT,
      remittance_approver TEXT,
      approval_status TEXT DEFAULT 'Pending Review',
      workflow_status TEXT DEFAULT 'pending_review',
      reviewed_by_user_id INTEGER,
      reviewed_by_name TEXT,
      reviewed_at TEXT,
      rejection_reason TEXT,
      udin TEXT,
      udin_generation_date TEXT,
      revocation TEXT,
      revocation_reason TEXT,
      revocation_requested_by_user_id INTEGER,
      revocation_requested_at TEXT,
      revoked_by_user_id INTEGER,
      revoked_at TEXT,
      copy_of_certificate_name TEXT,
      income_tax_acknowledgement_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

const udinFileCols = db.prepare("PRAGMA table_info(udin_request_files)").all().map(c => c.name);
if (!udinFileCols.length) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS udin_request_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      file_blob BLOB NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(request_id, field_name)
    );
  `);
}

const udinAuditCols = db.prepare("PRAGMA table_info(udin_audit_log)").all().map(c => c.name);
if (!udinAuditCols.length) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS udin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor_user_id INTEGER,
      actor_name TEXT,
      actor_role TEXT,
      payload_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

const users = db.prepare("SELECT id, role, permissions FROM users").all();
const updatePermissions = db.prepare("UPDATE users SET permissions = ? WHERE id = ?");
for (const user of users) {
  updatePermissions.run(serializePermissions(ensurePermissions(user.permissions, user.role)), user.id);
}

// Migrate statuses: old 'submitted' -> 'pending_manager'
db.exec("UPDATE timesheet_entries SET status='pending_manager' WHERE status='submitted'");

// Seed default partner
const partnerExists = db.prepare("SELECT id FROM users WHERE role='partner' LIMIT 1").get();
if (!partnerExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare("INSERT INTO users (name, username, password, role, permissions, designation, email, mobile_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run('Partner Admin', 'partner', hash, 'partner', serializePermissions(getDefaultPermissions('partner')), 'Managing Partner', 'partner@example.com', '+919999999991');
  console.log('✅ Default partner created: partner / admin123');
}

// Seed sample manager
const managerExists = db.prepare("SELECT id FROM users WHERE role='manager' LIMIT 1").get();
if (!managerExists) {
  const hash = bcrypt.hashSync('manager123', 10);
  db.prepare("INSERT INTO users (name, username, password, role, permissions, designation, email, mobile_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run('Sample Manager', 'manager', hash, 'manager', serializePermissions(getDefaultPermissions('manager')), 'Audit Manager', 'manager@example.com', '+919999999992');
  console.log('✅ Default manager created: manager / manager123');
}

db.prepare("UPDATE users SET permissions = ? WHERE username = ?").run(
  serializePermissions(getDefaultPermissions('partner')),
  'partner'
);
db.prepare("UPDATE users SET permissions = ? WHERE username = ?").run(
  serializePermissions(getDefaultPermissions('manager')),
  'manager'
);

// Seed sample clients
const clientCount = db.prepare("SELECT COUNT(*) as cnt FROM clients").get();
if (clientCount.cnt === 0) {
  const insertClient = db.prepare(`INSERT INTO clients (name, code, contact_person, billing_rate) VALUES (?, ?, ?, ?)`);
  insertClient.run('Internal / Admin', 'INT001', '', 0);
  insertClient.run('Sample Client Pvt. Ltd.', 'CLI001', 'Rajesh Shah', 2500);
  console.log('✅ Sample clients seeded');
}

const countMasterData = db.prepare("SELECT COUNT(*) as cnt FROM master_data_options WHERE category = ?");
const insertMasterData = db.prepare(`
  INSERT INTO master_data_options (category, key, label, short_label, sort_order, active)
  VALUES (?, ?, ?, ?, ?, 1)
`);

for (const [category, items] of Object.entries(DEFAULT_MASTER_DATA)) {
  if (countMasterData.get(category).cnt > 0) continue;
  for (const item of items) {
    insertMasterData.run(category, item.key, item.label, item.short_label || null, item.sort_order || 0);
  }
}

const shiftCount = db.prepare("SELECT COUNT(*) as cnt FROM timesheet_shifts").get();
if (shiftCount.cnt === 0) {
  db.prepare(`
    INSERT INTO timesheet_shifts (shift_code, label, start_time, end_time, active, default_for_new_clients)
    VALUES (?, ?, ?, ?, 1, 1)
  `).run('GEN-1000', 'General Day Shift', '10:00', '18:30');
}

const locationCount = db.prepare("SELECT COUNT(*) as cnt FROM location_master").get();
if (locationCount.cnt === 0) {
  db.prepare(`
    INSERT INTO location_master (location, short_name, latitude, longitude, radius_meters, active, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
  `).run('Main Office', 'MO', 19.0760, 72.8777, 75);
}

const udinLocationCount = db.prepare("SELECT COUNT(*) as cnt FROM udin_location_master").get();
if (udinLocationCount.cnt === 0) {
  db.prepare(`
    INSERT INTO udin_location_master (location, short_name, active, updated_at)
    VALUES (?, ?, 1, datetime('now'))
  `).run('Main Office', 'MO');
}

module.exports = db;
