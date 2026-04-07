const express = require('express');
const router = express.Router();
const { db, seedDefaultAdmin } = require('../db');
const { getUsersMap, invalidateCache } = require('../data-cache');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'ca-timesheet-secret-2024';
const SESSION_TTL = '30d';
const ROLE_DEFAULT_PERMISSIONS = {
  partner: [
    'clients.view','clients.create','clients.edit','clients.delete','clients.import',
    'staff.view','staff.create','staff.edit','staff.delete','access.manage',
    'timesheets.view_own','timesheets.create_own','timesheets.edit_own','timesheets.delete_own','timesheets.submit_own','timesheets.view_all',
    'approvals.view_manager_queue','approvals.approve_manager','approvals.view_partner_queue','approvals.approve_partner',
    'reports.view','reports.export',
    'dashboard.view_self','dashboard.view_team','dashboard.view_firm'
  ],
  manager: [
    'clients.view','staff.view',
    'timesheets.view_own','timesheets.create_own','timesheets.edit_own','timesheets.delete_own','timesheets.submit_own','timesheets.view_all',
    'approvals.view_manager_queue','approvals.approve_manager',
    'reports.view','reports.export',
    'dashboard.view_self','dashboard.view_team'
  ],
  article: [
    'clients.view',
    'timesheets.view_own','timesheets.create_own','timesheets.edit_own','timesheets.delete_own','timesheets.submit_own',
    'dashboard.view_self'
  ]
};

async function findUserByUsernameInsensitive(username) {
  const lowered = String(username || '').trim().toLowerCase();
  const users = await getUsersMap();
  for (const [id, data] of users.entries()) {
    if (String(data.username || '').trim().toLowerCase() === lowered) {
      return { id, data };
    }
  }
  return null;
}

async function findUserByEmailInsensitive(email, excludeId = null) {
  const lowered = String(email || '').trim().toLowerCase();
  if (!lowered) return null;
  const users = await db.collection('users').get();
  for (const doc of users.docs) {
    if (excludeId && doc.id === excludeId) continue;
    const data = doc.data();
    if (String(data.email || '').trim().toLowerCase() === lowered) {
      return { id: doc.id, data };
    }
  }
  return null;
}

async function findUserByMobileNumber(mobileNumber, excludeId = null) {
  const normalized = String(mobileNumber || '').trim();
  if (!normalized) return null;
  const users = await db.collection('users').get();
  for (const doc of users.docs) {
    if (excludeId && doc.id === excludeId) continue;
    const data = doc.data();
    if (String(data.mobile_number || '').trim() === normalized) {
      return { id: doc.id, data };
    }
  }
  return null;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMobileNumber(value) {
  return String(value || '').trim();
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function ensurePermissions(role, permissions) {
  return Array.isArray(permissions) && permissions.length
    ? permissions
    : (ROLE_DEFAULT_PERMISSIONS[normalizeRole(role)] || []);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidMobileNumber(value) {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function isContactInfoRequired(user) {
  return !normalizeEmail(user.email) || !normalizeMobileNumber(user.mobile_number);
}

function authUserPayload(id, user) {
  return {
    id,
    username: user.username,
    name: user.name,
    role: normalizeRole(user.role),
    designation: user.designation || '',
    email: normalizeEmail(user.email),
    mobile_number: normalizeMobileNumber(user.mobile_number),
    permissions: ensurePermissions(user.role, user.permissions),
    contact_info_required: isContactInfoRequired(user)
  };
}

function issueSessionToken(userId, user, permissions) {
  return jwt.sign({
    id: userId,
    username: user.username,
    role: normalizeRole(user.role),
    name: user.name,
    permissions
  }, JWT_SECRET, { expiresIn: SESSION_TTL });
}

async function getAuthorizedUser(req, res) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userRef = db.collection('users').doc(decoded.id);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }
    const user = userDoc.data();
    if (user.active === false || user.active === 0 || user.active === '0') {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }
    return { id: userDoc.id, ref: userRef, data: user };
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    await seedDefaultAdmin(); // Safely ensure default partner exists or bypasses if already seeded
    invalidateCache('users:all');

    const foundUser = await findUserByUsernameInsensitive(username);
    if (!foundUser) return res.status(401).json({ error: 'Invalid credentials' });
    
    const userDoc = { id: foundUser.id };
    const user = foundUser.data;
    
    if (user.active === false || user.active === 0 || user.active === '0') return res.status(403).json({ error: 'Account disabled' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const userPayload = authUserPayload(userDoc.id, user);
    const token = issueSessionToken(userDoc.id, user, userPayload.permissions);
    
    res.json({
      token,
      user: userPayload
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/refresh-session', async (req, res) => {
  const authorized = await getAuthorizedUser(req, res);
  if (!authorized) return;

  const userPayload = authUserPayload(authorized.id, authorized.data);
  const token = issueSessionToken(authorized.id, authorized.data, userPayload.permissions);

  res.json({
    token,
    user: userPayload
  });
});

router.post('/change-password', async (req, res) => {
  const authorized = await getAuthorizedUser(req, res);
  if (!authorized) return;

  const currentPassword = req.body?.currentPassword || req.body?.old_password;
  const newPassword = req.body?.newPassword || req.body?.new_password;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }

  const valid = await bcrypt.compare(currentPassword, authorized.data.password);
  if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(newPassword, 10);
  await authorized.ref.update({ password: newHash });
  invalidateCache('users:all');
  res.json({ success: true });
});

router.post('/complete-contact-info', async (req, res) => {
  const authorized = await getAuthorizedUser(req, res);
  if (!authorized) return;

  const email = normalizeEmail(req.body?.email);
  const mobileNumber = normalizeMobileNumber(req.body?.mobile_number);

  if (!email || !mobileNumber) {
    return res.status(400).json({ error: 'Email ID and mobile number are required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email ID' });
  }
  if (!isValidMobileNumber(mobileNumber)) {
    return res.status(400).json({ error: 'Enter a valid mobile number' });
  }

  const emailOwner = await findUserByEmailInsensitive(email, authorized.id);
  if (emailOwner) {
    return res.status(400).json({ error: 'Email ID is already used by another user' });
  }

  const mobileOwner = await findUserByMobileNumber(mobileNumber, authorized.id);
  if (mobileOwner) {
    return res.status(400).json({ error: 'Mobile number is already used by another user' });
  }

  await authorized.ref.update({
    email,
    mobile_number: mobileNumber
  });
  invalidateCache('users:all');

  const updatedDoc = await authorized.ref.get();
  res.json({
    success: true,
    user: authUserPayload(updatedDoc.id, updatedDoc.data())
  });
});

module.exports = router;
