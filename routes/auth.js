const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../js/database');
const { ensurePermissions } = require('../js/permissions');
const { JWT_SECRET, SESSION_TTL } = require('../config');
const SMS_CHALLENGE_TTL_SECONDS = 10 * 60;
const TRUSTED_DEVICE_TTL_SECONDS = 24 * 60 * 60;
const ONLINE_WINDOW_MS = 15 * 60 * 1000;

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

function nowIso() {
  return new Date().toISOString();
}

function updateUserSessionTimestamps(userId, { login = false, activity = false } = {}) {
  const updates = [];
  const params = [];
  if (login) {
    updates.push('last_login_at = ?');
    params.push(nowIso());
  }
  if (activity) {
    updates.push('last_activity_at = ?');
    params.push(nowIso());
  }
  if (!updates.length) return null;
  params.push(userId);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
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
    contact_info_required: isContactInfoRequired(user),
    last_login_at: user.last_login_at || null,
    last_activity_at: user.last_activity_at || null,
    is_online: !!(user.last_activity_at && (Date.now() - new Date(user.last_activity_at).getTime()) <= ONLINE_WINDOW_MS)
  };
}

function createSmsChallenge({ userId, phoneNumber, verificationCode }) {
  return jwt.sign(
    {
      purpose: 'sms-login',
      userId,
      phoneNumber: String(phoneNumber || ''),
      verificationCode: String(verificationCode || '').trim()
    },
    JWT_SECRET,
    { expiresIn: `${SMS_CHALLENGE_TTL_SECONDS}s` }
  );
}

function verifySmsChallenge(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.purpose !== 'sms-login' || !decoded?.userId || !decoded?.phoneNumber) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function createTrustedDeviceToken({ userId, deviceId }) {
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedDeviceId) return '';
  return jwt.sign(
    {
      purpose: 'trusted-device',
      userId,
      deviceId: normalizedDeviceId
    },
    JWT_SECRET,
    { expiresIn: `${TRUSTED_DEVICE_TTL_SECONDS}s` }
  );
}

function verifyTrustedDeviceToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.purpose !== 'trusted-device' || !decoded?.userId || !decoded?.deviceId) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function normalizeUserAgent(value) {
  return String(value || '').trim();
}

function upsertTrustedDevice({ userId, deviceId, deviceLabel, userAgent }) {
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedDeviceId) return null;
  const label = String(deviceLabel || '').trim();
  const agent = normalizeUserAgent(userAgent);
  const existing = db.prepare('SELECT id FROM trusted_devices WHERE user_id = ? AND device_id = ?').get(userId, normalizedDeviceId);
  if (existing) {
    db.prepare(`
      UPDATE trusted_devices
      SET device_label = ?, user_agent = ?, last_used_at = datetime('now'), revoked_at = NULL, revoked_by_user_id = NULL
      WHERE id = ?
    `).run(label || null, agent || null, existing.id);
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO trusted_devices (user_id, device_id, device_label, user_agent)
    VALUES (?, ?, ?, ?)
  `).run(userId, normalizedDeviceId, label || null, agent || null);
  return result.lastInsertRowid;
}

function isTrustedDeviceActive(userId, deviceId) {
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedDeviceId) return false;
  const record = db.prepare(`
    SELECT id
    FROM trusted_devices
    WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
  `).get(userId, normalizedDeviceId);
  return !!record;
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
  const identifier = String(req.body?.username || req.body?.identifier || '').trim();
  const password = String(req.body?.password || '');
  const trustedDeviceToken = String(req.body?.trusted_device_token || '').trim();
  const trustedDeviceId = String(req.body?.trusted_device_id || '').trim();
  const trustedDeviceLabel = String(req.body?.trusted_device_label || '').trim();
  if (!identifier || !password) return res.status(400).json({ error: 'Username or email and password required' });

  const user = db.prepare(`
    SELECT * FROM users
    WHERE (lower(username) = lower(?) OR lower(email) = lower(?))
      AND active = 1
    LIMIT 1
  `).get(identifier, identifier);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const trustedDevice = verifyTrustedDeviceToken(trustedDeviceToken);
  const trustedDeviceMatches =
    trustedDevice &&
    trustedDevice.userId === user.id &&
    trustedDevice.deviceId === trustedDeviceId &&
    isTrustedDeviceActive(user.id, trustedDeviceId);

  const isLocalSmsMode = process.env.NODE_ENV !== 'production';
  const userPayload = authUserPayload(user);
  if (trustedDeviceMatches) {
    const updatedUser = updateUserSessionTimestamps(user.id, { login: true, activity: true }) || user;
    const token = issueSessionToken(user, userPayload.permissions);
    upsertTrustedDevice({
      userId: user.id,
      deviceId: trustedDeviceId,
      deviceLabel: trustedDeviceLabel,
      userAgent: req.headers['user-agent']
    });
    return res.json({
      token,
      user: authUserPayload(updatedUser),
      trusted_device_token: createTrustedDeviceToken({ userId: user.id, deviceId: trustedDeviceId })
    });
  }
  if (isLocalSmsMode) {
    const smsVerificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const smsChallengeToken = createSmsChallenge({
      userId: user.id,
      phoneNumber: user.mobile_number,
      verificationCode: smsVerificationCode
    });

    return res.json({
      sms_required: true,
      sms_mode: 'local',
      sms_challenge_token: smsChallengeToken,
      phone_number: user.mobile_number,
      masked_phone_number: user.mobile_number,
      sms_test_code: smsVerificationCode,
      user: userPayload
    });
  }

  const updatedUser = updateUserSessionTimestamps(user.id, { login: true, activity: true }) || user;
  const token = issueSessionToken(user, userPayload.permissions);
  upsertTrustedDevice({
    userId: user.id,
    deviceId: trustedDeviceId,
    deviceLabel: trustedDeviceLabel,
    userAgent: req.headers['user-agent']
  });

  res.json({
    token,
    user: authUserPayload(updatedUser)
  });
});

// POST /api/auth/complete-sms-login
router.post('/complete-sms-login', (req, res) => {
  const smsChallengeToken = String(req.body?.sms_challenge_token || '');
  const smsVerificationCode = String(req.body?.sms_verification_code || '').trim();
  const trustedDeviceId = String(req.body?.trusted_device_id || '').trim();
  const trustedDeviceLabel = String(req.body?.trusted_device_label || '').trim();

  if (!smsChallengeToken || !smsVerificationCode) {
    return res.status(400).json({ error: 'Missing SMS login details' });
  }

  const challenge = verifySmsChallenge(smsChallengeToken);
  if (!challenge) {
    return res.status(401).json({ error: 'SMS challenge expired or invalid' });
  }

  if (smsVerificationCode !== challenge.verificationCode) {
    return res.status(401).json({ error: 'SMS code is invalid' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(challenge.userId);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const updatedUser = updateUserSessionTimestamps(user.id, { login: true, activity: true }) || user;
  const userPayload = authUserPayload(updatedUser);
  const token = issueSessionToken(user, userPayload.permissions);
  upsertTrustedDevice({
    userId: user.id,
    deviceId: trustedDeviceId,
    deviceLabel: trustedDeviceLabel,
    userAgent: req.headers['user-agent']
  });
  return res.json({
    token,
    user: userPayload,
    trusted_device_token: createTrustedDeviceToken({
      userId: user.id,
      deviceId: trustedDeviceId
    })
  });
});

// POST /api/auth/refresh-session
router.post('/refresh-session', (req, res) => {
  const authUser = getAuthorizedUser(req, res);
  if (!authUser) return;

  const updatedUser = updateUserSessionTimestamps(authUser.id, { activity: true }) || authUser;
  const userPayload = authUserPayload(updatedUser);
  const token = issueSessionToken(authUser, userPayload.permissions);

  res.json({
    token,
    user: userPayload
  });
});

// POST /api/auth/activity-ping
router.post('/activity-ping', (req, res) => {
  const authUser = getAuthorizedUser(req, res);
  if (!authUser) return;

  const updatedUser = updateUserSessionTimestamps(authUser.id, { activity: true }) || authUser;
  res.json({
    success: true,
    user: authUserPayload(updatedUser)
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
