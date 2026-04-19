const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST && !process.env.K_SERVICE) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
}
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.K_SERVICE) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

function resolveProjectId() {
  const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
  if (envProjectId) return envProjectId;

  try {
    const firebasercPath = path.join(__dirname, '..', '.firebaserc');
    if (fs.existsSync(firebasercPath)) {
      const config = JSON.parse(fs.readFileSync(firebasercPath, 'utf8'));
      const projectId = config?.projects?.default;
      if (projectId) return projectId;
    }
  } catch {
    // Fall through to Admin SDK auto-detection.
  }

  return undefined;
}

const appOptions = {};
const projectId = resolveProjectId();
if (projectId) {
  appOptions.projectId = projectId;
}

admin.initializeApp(appOptions);
const db = admin.firestore();

function fullAdminPermissions() {
  return [
    'clients.view','clients.create','clients.edit','clients.delete','clients.import',
    'staff.view','staff.create','staff.edit','staff.delete','access.manage',
    'timesheets.view_own','timesheets.create_own','timesheets.edit_own','timesheets.delete_own','timesheets.submit_own','timesheets.view_all',
    'approvals.view_manager_queue','approvals.approve_manager','approvals.view_partner_queue','approvals.approve_partner',
    'reports.view','reports.export','dashboard.view_self','dashboard.view_team','dashboard.view_firm',
    'udin.view_own','udin.create','udin.update','udin.review','udin.revoke','udin.dashboard.view',
    'feedback.view'
  ];
}

async function seedDefaultAdmin() {
  const usersRef = db.collection('users');
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('admin123', 10);
  const adminSnapshot = await usersRef.where('username', '==', 'admin').limit(1).get();
  const payload = {
    name: 'Administrator',
    username: 'admin',
    password: hash,
    role: 'partner',
    permissions: fullAdminPermissions(),
    email: '',
    mobile_number: '',
    mfa_secret: '',
    mfa_enabled: false,
    mfa_recovery_code_hashes: [],
    designation: 'System Administrator',
    department: 'Administration',
    active: true,
    created_at: new Date()
  };

  if (adminSnapshot.empty) {
    await usersRef.add(payload);
    console.log('Default firebase admin created: admin / admin123');
    return;
  }

  await adminSnapshot.docs[0].ref.set(payload, { merge: true });
}

module.exports = { db, admin, seedDefaultAdmin };
