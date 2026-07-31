const express = require('express');
const router = express.Router();
const { db, seedDefaultAdmin } = require('../db');
const { getUsersMap, invalidateCache } = require('../data-cache');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { SESSION_TTL } = require('../config');
const { signJwtToken, verifyJwtToken } = require('../lib/session-jwt');
const TRUSTED_DEVICE_TTL_SECONDS = 24 * 60 * 60;
const ROLE_DEFAULT_PERMISSIONS = {
  partner: [
    'clients.view','clients.create','clients.edit','clients.delete','clients.import',
    'staff.view','staff.create','staff.edit','staff.delete','access.manage',
    'timesheets.masters.view','timesheets.masters.create','timesheets.masters.edit','timesheets.masters.delete','timesheets.masters.import',
    'timesheets.view_own','timesheets.create_own','timesheets.edit_own','timesheets.delete_own','timesheets.submit_own','timesheets.view_all',
    'approvals.view_manager_queue','approvals.approve_manager','approvals.view_partner_queue','approvals.approve_partner',
    'reports.view','reports.export','attendance.view_own','attendance.create_own','attendance.view_reports','attendance.approve_corrections',
    'dashboard.view_self','dashboard.view_team','dashboard.view_firm',
    'udin.view_own','udin.create','udin.update','udin.review','udin.revoke','udin.dashboard.view'
  ],
  manager: [
    'clients.view','staff.view',
    'timesheets.masters.view',
    'timesheets.view_own','timesheets.create_own','timesheets.edit_own','timesheets.delete_own','timesheets.submit_own','timesheets.view_all',
    'approvals.view_manager_queue','approvals.approve_manager',
    'reports.view','reports.export','attendance.view_own','attendance.create_own','attendance.view_reports','attendance.approve_corrections',
    'dashboard.view_self','dashboard.view_team',
    'udin.view_own','udin.create','udin.update','udin.review','udin.revoke','udin.dashboard.view'
  ],
  article: [
    'clients.view',
    'timesheets.view_own','timesheets.create_own','timesheets.edit_own','timesheets.delete_own','timesheets.submit_own',
    'attendance.view_own','attendance.create_own',
    'dashboard.view_self',
    'udin.view_own','udin.create','udin.dashboard.view'
  ]
};

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const OTP_ISSUER = 'Samay';
const MFA_CHALLENGE_TTL_SECONDS = 10 * 60;

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = String(secret || '')
    .toUpperCase()
    .replace(/[\s=-]/g, '');

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of cleaned) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function normalizeOtp(value) {
  return String(value || '').replace(/[\s-]/g, '').trim().toUpperCase();
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function getHotpToken(secret, counter) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  let value = BigInt(counter);

  for (let i = 7; i >= 0; i -= 1) {
    buffer[i] = Number(value & 255n);
    value >>= 8n;
  }

  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (
    ((hmac[offset] & 127) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  ) % (10 ** TOTP_DIGITS);

  return String(code).padStart(TOTP_DIGITS, '0');
}

function verifyTotp(secret, code, window = 1) {
  const normalizedCode = normalizeOtp(code);
  if (!/^\d{6}$/.test(normalizedCode)) return false;

  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    if (getHotpToken(secret, counter + offset) === normalizedCode) {
      return true;
    }
  }

  return false;
}

function buildOtpAuthUrl({ username, secret }) {
  const label = `${OTP_ISSUER}:${String(username || '').trim()}`;
  const params = new URLSearchParams({
    secret,
    issuer: OTP_ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS)
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function createTotpChallenge({ userId, secret, purpose }) {
  return signJwtToken(
    {
      purpose,
      userId,
      secret: String(secret || '').trim()
    },
    { expiresIn: `${MFA_CHALLENGE_TTL_SECONDS}s` }
  );
}

function verifyTotpChallenge(token) {
  try {
    const decoded = verifyJwtToken(token);
    if (!decoded?.userId || !['totp-login', 'totp-setup'].includes(decoded?.purpose)) return null;
    if (decoded.purpose === 'totp-setup' && !decoded.secret) return null;
    return decoded;
  } catch {
    return null;
  }
}

function createTrustedDeviceToken({ userId, deviceId }) {
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedDeviceId) return '';
  return signJwtToken(
    {
      purpose: 'trusted-device',
      userId,
      deviceId: normalizedDeviceId
    },
    { expiresIn: `${TRUSTED_DEVICE_TTL_SECONDS}s` }
  );
}

function verifyTrustedDeviceToken(token) {
  try {
    const decoded = verifyJwtToken(token);
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

function trustedDeviceDocId(userId, deviceId) {
  return `trusted_${String(userId || '').trim()}_${String(deviceId || '').trim()}`;
}

async function upsertTrustedDevice({ userId, deviceId, deviceLabel, userAgent }) {
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedDeviceId) return null;
  const docRef = db.collection('trusted_devices').doc(trustedDeviceDocId(userId, normalizedDeviceId));
  const now = new Date().toISOString();
  const snap = await docRef.get();
  const payload = {
    user_id: userId,
    device_id: normalizedDeviceId,
    device_label: String(deviceLabel || '').trim() || null,
    user_agent: normalizeUserAgent(userAgent) || null,
    last_used_at: now,
    revoked_at: null,
    revoked_by_user_id: null
  };
  if (!snap.exists) {
    await docRef.set({
      ...payload,
      created_at: now
    });
    return docRef.id;
  }
  await docRef.set(payload, { merge: true });
  return docRef.id;
}

async function isTrustedDeviceActive(userId, deviceId) {
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedDeviceId) return false;
  const snap = await db.collection('trusted_devices').doc(trustedDeviceDocId(userId, normalizedDeviceId)).get();
  return !!(snap.exists && !snap.data()?.revoked_at);
}

async function findUserByIdentifierInsensitive(identifier) {
  const lowered = String(identifier || '').trim().toLowerCase();
  const users = await getUsersMap();
  for (const [id, data] of users.entries()) {
    const username = String(data.username || '').trim().toLowerCase();
    const email = String(data.email || '').trim().toLowerCase();
    if (username === lowered || email === lowered) {
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
  const normalized = toE164PhoneNumber(mobileNumber);
  if (!normalized) return null;
  const users = await db.collection('users').get();
  for (const doc of users.docs) {
    if (excludeId && doc.id === excludeId) continue;
    const data = doc.data();
    if (toE164PhoneNumber(data.mobile_number) === normalized) {
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

function normalizePhoneCandidate(value) {
  return String(value || '').trim().replace(/[\s-]/g, '');
}

function toE164PhoneNumber(value) {
  const cleaned = normalizePhoneCandidate(value);
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1).replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : '';
  }

  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return '';
}

function maskPhoneNumber(value) {
  const phone = toE164PhoneNumber(value);
  if (!phone) return '';
  const digits = phone.slice(1);
  if (digits.length <= 4) return phone;
  return `+${digits.slice(0, 2)}${'*'.repeat(Math.max(0, digits.length - 6))}${digits.slice(-4)}`;
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function ensurePermissions(role, permissions) {
  const fallback = ROLE_DEFAULT_PERMISSIONS[normalizeRole(role)] || [];
  const current = Array.isArray(permissions) ? permissions.filter(Boolean) : [];
  const merged = [...new Set([...current, ...fallback])];
  return merged.includes('firm.dashboard.view')
    ? merged
    : [...merged, 'firm.dashboard.view'];
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidMobileNumber(value) {
  if (!value) return true;
  const normalized = normalizePhoneCandidate(value);
  if (/^\+\d{10,15}$/.test(normalized)) return true;
  const digits = normalized.replace(/\D/g, '');
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
    contact_info_required: isContactInfoRequired(user),
    mfa_method: user.mfa_enabled && user.mfa_secret ? 'totp' : 'totp-setup'
  };
}

function issueSessionToken(userId, user, permissions) {
  return signJwtToken({
    id: userId,
    username: user.username,
    role: normalizeRole(user.role),
    name: user.name,
    permissions
  }, { expiresIn: SESSION_TTL });
}

async function getAuthorizedUser(req, res) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  try {
    const decoded = verifyJwtToken(token);
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
  const identifier = String(req.body?.username || req.body?.identifier || '').trim();
  const password = String(req.body?.password || '');
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username or email and password required' });
  }

  try {
    console.log(`[auth/login] start identifier=${identifier}`);
    await seedDefaultAdmin();
    invalidateCache('users:all');

    const foundUser = await findUserByIdentifierInsensitive(identifier);
    if (!foundUser) return res.status(401).json({ error: 'Invalid credentials' });

    const userRef = db.collection('users').doc(foundUser.id);
    const user = foundUser.data;

    if (user.active === false || user.active === 0 || user.active === '0') {
      return res.status(403).json({ error: 'Account disabled' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const userPayload = authUserPayload(foundUser.id, user);
    const token = issueSessionToken(foundUser.id, user, userPayload.permissions);
    console.log(`[auth/login] success identifier=${identifier} userId=${foundUser.id}`);
    res.json({
      token,
      user: userPayload
    });
  } catch (err) {
    console.error(`[auth/login] failed identifier=${identifier}`, err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/refresh-session', async (req, res) => {
  return res.status(410).json({ error: 'Daily login required' });
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
