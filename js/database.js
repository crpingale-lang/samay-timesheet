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

module.exports = db;
