const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'timesheet.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'article',
    designation TEXT,
    department TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
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
    hours REAL NOT NULL DEFAULT 0,
    billable INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',
    rejection_reason TEXT,
    approved_by_manager INTEGER,
    approved_by_partner INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (client_id) REFERENCES clients(id)
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
`);

// Migrate: add new columns if they don't exist (safe for existing DBs)
const cols = db.prepare("PRAGMA table_info(timesheet_entries)").all().map(c => c.name);
if (!cols.includes('approved_by_manager')) {
  db.exec("ALTER TABLE timesheet_entries ADD COLUMN approved_by_manager INTEGER");
}
if (!cols.includes('approved_by_partner')) {
  db.exec("ALTER TABLE timesheet_entries ADD COLUMN approved_by_partner INTEGER");
}

// Migrate roles: rename old 'admin' -> 'partner', 'staff' -> 'article'
db.exec("UPDATE users SET role='partner' WHERE role='admin'");
db.exec("UPDATE users SET role='article' WHERE role='staff'");

// Migrate statuses: old 'submitted' -> 'pending_manager'
db.exec("UPDATE timesheet_entries SET status='pending_manager' WHERE status='submitted'");

// Seed default partner
const partnerExists = db.prepare("SELECT id FROM users WHERE role='partner' LIMIT 1").get();
if (!partnerExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`INSERT INTO users (name, username, password, role, designation) VALUES (?, ?, ?, ?, ?)`)
    .run('Partner Admin', 'partner', hash, 'partner', 'Managing Partner');
  console.log('✅ Default partner created: partner / admin123');
}

// Seed sample manager
const managerExists = db.prepare("SELECT id FROM users WHERE role='manager' LIMIT 1").get();
if (!managerExists) {
  const hash = bcrypt.hashSync('manager123', 10);
  db.prepare(`INSERT INTO users (name, username, password, role, designation) VALUES (?, ?, ?, ?, ?)`)
    .run('Sample Manager', 'manager', hash, 'manager', 'Audit Manager');
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

module.exports = db;
