const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../js/database');
const { ensurePermissions } = require('../js/permissions');

const JWT_SECRET = 'ca-timesheet-secret-2024';
const SESSION_TTL = '30d';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMobileNumber(value) {
  return String(value || '').trim();
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

function authUserPayload(user) {
  const permissions = ensurePermissions(user.permissions, user.role);
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    designation: user.designation,
    email: normalizeEmail(user.email),
    mobile_number: normalizeMobileNumber(user.mobile_number),
    permissions,
    contact_info_required: isContactInfoRequired(user)
  };
}

function issueSessionToken(user, permissions) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      permissions
    },
    JWT_SECRET,
    { expiresIn: SESSION_TTL }
  );
}

function getAuthorizedUser(req, res) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(decoded.id);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  return user;
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare("SELECT * FROM users WHERE lower(username) = lower(?) AND active = 1").get(username.trim());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const userPayload = authUserPayload(user);
  const token = issueSessionToken(user, userPayload.permissions);

  res.json({
    token,
    user: userPayload
  });
});

// POST /api/auth/refresh-session
router.post('/refresh-session', (req, res) => {
  const authUser = getAuthorizedUser(req, res);
  if (!authUser) return;

  const userPayload = authUserPayload(authUser);
  const token = issueSessionToken(authUser, userPayload.permissions);

  res.json({
    token,
    user: userPayload
  });
});

// POST /api/auth/change-password
router.post('/change-password', (req, res) => {
  const authUser = getAuthorizedUser(req, res);
  if (!authUser) return;

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
  if (!bcrypt.compareSync(currentPassword, authUser.password)) return res.status(400).json({ error: 'Current password is incorrect' });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, authUser.id);
  res.json({ success: true });
});

// POST /api/auth/complete-contact-info
router.post('/complete-contact-info', (req, res) => {
  const authUser = getAuthorizedUser(req, res);
  if (!authUser) return;

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

  const emailOwner = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?").get(email, authUser.id);
  if (emailOwner) {
    return res.status(400).json({ error: 'Email ID is already used by another user' });
  }

  const mobileOwner = db.prepare("SELECT id FROM users WHERE mobile_number = ? AND id != ?").get(mobileNumber, authUser.id);
  if (mobileOwner) {
    return res.status(400).json({ error: 'Mobile number is already used by another user' });
  }

  db.prepare("UPDATE users SET email = ?, mobile_number = ? WHERE id = ?").run(email, mobileNumber, authUser.id);
  const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(authUser.id);

  res.json({
    success: true,
    user: authUserPayload(updatedUser)
  });
});

module.exports = router;
