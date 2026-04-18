const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../js/database');
const {
  APP_PERMISSION_GROUPS,
  serializePermissions,
  ensurePermissions,
  hasPermission
} = require('../js/permissions');

function requirePermission(req, res, permission) {
  if (!hasPermission(req.user, permission)) {
    res.status(403).json({ error: `Permission required: ${permission}` });
    return false;
  }
  return true;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMobileNumber(value) {
  return String(value || '').trim();
}

function isValidEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidMobileNumber(value) {
  if (!value) return true;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function normalizeStatusFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['active', 'inactive', 'all'].includes(normalized) ? normalized : '';
}

function isActiveUser(value) {
  return value === true || value === 1 || value === '1' || String(value).trim().toLowerCase() === 'true';
}

function validateUniqueContactFields({ email, mobileNumber, excludeUserId = null }) {
  if (email) {
    const existingEmail = excludeUserId
      ? db.prepare("SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?").get(email, excludeUserId)
      : db.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").get(email);
    if (existingEmail) return 'Email ID is already used by another user';
  }

  if (mobileNumber) {
    const existingMobile = excludeUserId
      ? db.prepare("SELECT id FROM users WHERE mobile_number = ? AND id != ?").get(mobileNumber, excludeUserId)
      : db.prepare("SELECT id FROM users WHERE mobile_number = ?").get(mobileNumber);
    if (existingMobile) return 'Mobile number is already used by another user';
  }

  return null;
}

// GET all staff
router.get('/', (req, res) => {
  if (!requirePermission(req, res, 'staff.view')) return;
  const staff = db.prepare("SELECT id, name, username, role, permissions, mfa_method, email, mobile_number, designation, department, active, created_at FROM users ORDER BY CASE role WHEN 'partner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, name").all()
    .map(user => ({ ...user, permissions: ensurePermissions(user.permissions, user.role) }));
  const query = String(req.query.q || '').trim().toLowerCase();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 50, 1), 200);
  const wantsPagedResponse = !!(req.query.page || req.query.page_size || req.query.q);
  const statusFilter = normalizeStatusFilter(req.query.status);
  const filtered = query
    ? staff.filter(user => [user.name, user.username, user.role, user.designation, user.department, user.email, user.mobile_number].join(' ').toLowerCase().includes(query))
    : staff;
  const statusFiltered = statusFilter === 'active'
    ? filtered.filter(user => isActiveUser(user.active))
    : statusFilter === 'inactive'
      ? filtered.filter(user => !isActiveUser(user.active))
      : filtered;
  if (!wantsPagedResponse) return res.json(statusFiltered);
  const start = (page - 1) * pageSize;
  const items = statusFiltered.slice(start, start + pageSize);
  res.json({
    items,
    total: statusFiltered.length,
    page,
    page_size: pageSize,
    has_more: start + items.length < statusFiltered.length
  });
});

router.get('/access-catalog', (req, res) => {
  if (!requirePermission(req, res, 'access.manage')) return;
  res.json({ groups: APP_PERMISSION_GROUPS });
});

router.get('/trusted-devices', (req, res) => {
  if (!requirePermission(req, res, 'access.manage')) return;
  const query = String(req.query.q || '').trim().toLowerCase();
  const statusFilter = String(req.query.status || 'active').trim().toLowerCase();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 25, 1), 100);
  const rows = db.prepare(`
    SELECT
      td.id,
      td.user_id,
      td.device_id,
      td.device_label,
      td.user_agent,
      td.created_at,
      td.last_used_at,
      td.revoked_at,
      td.revoked_by_user_id,
      u.name,
      u.username,
      u.role
    FROM trusted_devices td
    LEFT JOIN users u ON u.id = td.user_id
    ORDER BY COALESCE(td.last_used_at, td.created_at) DESC, td.created_at DESC
  `).all().map(device => ({
    ...device,
    active: !device.revoked_at
  }));
  const filtered = query
    ? rows.filter(device => [
      device.name,
      device.username,
      device.device_label,
      device.device_id,
      device.user_agent,
      device.role
    ].join(' ').toLowerCase().includes(query))
    : rows;
  const statusFiltered = statusFilter === 'revoked'
    ? filtered.filter(device => !!device.revoked_at)
    : statusFilter === 'all'
      ? filtered
      : filtered.filter(device => !device.revoked_at);
  const activeCount = filtered.filter(device => !device.revoked_at).length;
  const revokedCount = filtered.filter(device => !!device.revoked_at).length;
  const start = (page - 1) * pageSize;
  const items = statusFiltered.slice(start, start + pageSize);
  res.json({
    items,
    total: statusFiltered.length,
    summary: {
      total: filtered.length,
      active: activeCount,
      revoked: revokedCount
    },
    page,
    page_size: pageSize,
    has_more: start + items.length < statusFiltered.length
  });
});

router.post('/trusted-devices/:id/revoke', (req, res) => {
  if (!requirePermission(req, res, 'access.manage')) return;
  const device = db.prepare('SELECT id, revoked_at FROM trusted_devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (device.revoked_at) return res.json({ success: true });
  db.prepare(`
    UPDATE trusted_devices
    SET revoked_at = datetime('now'),
        revoked_by_user_id = ?
    WHERE id = ?
  `).run(req.user.id, req.params.id);
  res.json({ success: true });
});

router.post('/:id/reset-authenticator', (req, res) => {
  if (!requirePermission(req, res, 'access.manage')) return;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare(`
    UPDATE users
    SET mfa_method = 'sms',
        mfa_secret = NULL,
        mfa_confirmed_at = NULL
    WHERE id = ?
  `).run(req.params.id);
  res.json({ success: true });
});

// POST create staff
router.post('/', (req, res) => {
  if (!requirePermission(req, res, 'staff.create')) return;
  const { name, username, password, role, designation, department, permissions } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required' });
  const normalizedUsername = username.trim();
  const email = normalizeEmail(req.body?.email);
  const mobileNumber = normalizeMobileNumber(req.body?.mobile_number);
  const allowedRoles = ['partner', 'manager', 'article'];
  if (!allowedRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (permissions && !hasPermission(req.user, 'access.manage')) {
    return res.status(403).json({ error: 'Permission required: access.manage' });
  }
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email ID' });
  if (!isValidMobileNumber(mobileNumber)) return res.status(400).json({ error: 'Enter a valid mobile number' });
  try {
    const existing = db.prepare("SELECT id FROM users WHERE lower(username) = lower(?)").get(normalizedUsername);
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const contactError = validateUniqueContactFields({ email, mobileNumber });
    if (contactError) return res.status(400).json({ error: contactError });
    const hash = bcrypt.hashSync(password, 10);
    const normalizedPermissions = ensurePermissions(permissions, role || 'article');
    const result = db.prepare("INSERT INTO users (name, username, password, role, permissions, email, mobile_number, designation, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(name, normalizedUsername, hash, role || 'article', serializePermissions(normalizedPermissions), email || null, mobileNumber || null, designation || '', department || '');
    res.json({
      id: result.lastInsertRowid,
      name,
      username: normalizedUsername,
      role: role || 'article',
      email,
      mobile_number: mobileNumber,
      permissions: normalizedPermissions
    });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PUT update staff
router.put('/:id', (req, res) => {
  if (!requirePermission(req, res, 'staff.edit')) return;
  const { name, username, designation, department, active, password, role, permissions } = req.body;
  const email = normalizeEmail(req.body?.email);
  const mobileNumber = normalizeMobileNumber(req.body?.mobile_number);
  const user = db.prepare("SELECT id, role, permissions FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (permissions && !hasPermission(req.user, 'access.manage')) {
    return res.status(403).json({ error: 'Permission required: access.manage' });
  }
  const normalizedUsername = (username || '').trim();
  if (!normalizedUsername) return res.status(400).json({ error: 'Username is required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email ID' });
  if (!isValidMobileNumber(mobileNumber)) return res.status(400).json({ error: 'Enter a valid mobile number' });
  const existing = db.prepare("SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?").get(normalizedUsername, req.params.id);
  if (existing) return res.status(400).json({ error: 'Username already exists' });
  const contactError = validateUniqueContactFields({ email, mobileNumber, excludeUserId: req.params.id });
  if (contactError) return res.status(400).json({ error: contactError });
  const normalizedPermissions = permissions ? ensurePermissions(permissions, role || user.role) : ensurePermissions(user.permissions, role || user.role);
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET name=?, username=?, designation=?, department=?, email=?, mobile_number=?, active=?, password=?, role=?, permissions=? WHERE id=?")
      .run(name, normalizedUsername, designation, department, email || null, mobileNumber || null, active !== undefined ? active : 1, hash, role, serializePermissions(normalizedPermissions), req.params.id);
  } else {
    db.prepare("UPDATE users SET name=?, username=?, designation=?, department=?, email=?, mobile_number=?, active=?, role=?, permissions=? WHERE id=?")
      .run(name, normalizedUsername, designation, department, email || null, mobileNumber || null, active !== undefined ? active : 1, role, serializePermissions(normalizedPermissions), req.params.id);
  }
  res.json({ success: true });
});

// GET staff hours summary
router.get('/hours-summary', (req, res) => {
  if (!requirePermission(req, res, 'staff.view')) return;
  const { from, to } = req.query;
  const rows = db.prepare(`
    SELECT u.id, u.name, u.designation, u.role,
      COALESCE(SUM(t.hours), 0) AS total_hours,
      COALESCE(SUM(CASE WHEN t.work_classification='client_work' THEN t.hours ELSE 0 END), 0) AS client_work_hours
    FROM users u
    LEFT JOIN timesheet_entries t ON t.user_id = u.id
      AND t.entry_date BETWEEN ? AND ?
      AND t.status = 'approved'
    WHERE u.active = 1
    GROUP BY u.id ORDER BY CASE u.role WHEN 'partner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name
  `).all(from || '2000-01-01', to || '2099-12-31');
  res.json(rows);
});

module.exports = router;
