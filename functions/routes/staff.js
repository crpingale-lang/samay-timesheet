const express = require('express');
const router = express.Router();
const { db, admin } = require('../db');
const { getUsersMap, invalidateCache, invalidateCacheByPrefix } = require('../data-cache');
const bcrypt = require('bcryptjs');

const APP_PERMISSION_GROUPS = [
  {
    key: 'clients',
    label: 'Client Master',
    permissions: [
      { key: 'clients.view', label: 'View' },
      { key: 'clients.create', label: 'Add' },
      { key: 'clients.edit', label: 'Edit' },
      { key: 'clients.delete', label: 'Delete' },
      { key: 'clients.import', label: 'Import' }
    ]
  },
  {
    key: 'staff',
    label: 'User Master',
    permissions: [
      { key: 'staff.view', label: 'View' },
      { key: 'staff.create', label: 'Add' },
      { key: 'staff.edit', label: 'Edit' },
      { key: 'staff.delete', label: 'Delete' },
      { key: 'access.manage', label: 'Access' }
    ]
  },
  {
    key: 'firm',
    label: 'Firm Shell',
    permissions: [
      { key: 'firm.dashboard.view', label: 'Firm Dashboard' },
      { key: 'modules.view', label: 'Go to Module' }
    ]
  },
  {
    key: 'udin',
    label: 'UDIN Tracker',
    permissions: [
      { key: 'udin.view_own', label: 'View Own' },
      { key: 'udin.create', label: 'Create' },
      { key: 'udin.update', label: 'Update' },
      { key: 'udin.review', label: 'Review' },
      { key: 'udin.revoke', label: 'Revoke' },
      { key: 'udin.dashboard.view', label: 'Dashboard' }
    ]
  },
  {
    key: 'feedback',
    label: 'Feedback',
    permissions: [
      { key: 'feedback.view', label: 'View Reports' }
    ]
  },
  {
    key: 'timesheets',
    label: 'Timesheets',
    permissions: [
      { key: 'timesheets.view_own', label: 'View Own' },
      { key: 'timesheets.create_own', label: 'Add Own' },
      { key: 'timesheets.edit_own', label: 'Edit Own' },
      { key: 'timesheets.delete_own', label: 'Delete Own' },
      { key: 'timesheets.submit_own', label: 'Submit Own' },
      { key: 'timesheets.view_all', label: 'View All' }
    ]
  },
  {
    key: 'timesheet_masters',
    label: 'Timesheet Masters',
    permissions: [
      { key: 'timesheets.masters.view', label: 'View' },
      { key: 'timesheets.masters.create', label: 'Add' },
      { key: 'timesheets.masters.edit', label: 'Edit' },
      { key: 'timesheets.masters.delete', label: 'Delete' },
      { key: 'timesheets.masters.import', label: 'Import' }
    ]
  },
  {
    key: 'attendance',
    label: 'Attendance',
    permissions: [
      { key: 'attendance.view_own', label: 'View Own' },
      { key: 'attendance.create_own', label: 'Check In/Out' },
      { key: 'attendance.view_reports', label: 'View Reports' },
      { key: 'attendance.approve_corrections', label: 'Approve Corrections' }
    ]
  },
  {
    key: 'approvals',
    label: 'Approvals',
    permissions: [
      { key: 'approvals.view_manager_queue', label: 'Manager Queue' },
      { key: 'approvals.approve_manager', label: 'Manager Approve' },
      { key: 'approvals.view_partner_queue', label: 'Partner Queue' },
      { key: 'approvals.approve_partner', label: 'Partner Approve' }
    ]
  },
  {
    key: 'reports',
    label: 'Reports',
    permissions: [
      { key: 'reports.view', label: 'View Reports' },
      { key: 'reports.export', label: 'Export' }
    ]
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    permissions: [
      { key: 'dashboard.view_self', label: 'Self View' },
      { key: 'dashboard.view_team', label: 'Team View' },
      { key: 'dashboard.view_firm', label: 'Firm View' }
    ]
  }
];

function managerOrAbove(req) {
  return ['manager', 'partner'].includes(req.user.role);
}

function hasPermission(req, permission) {
  return Array.isArray(req.user.permissions) && req.user.permissions.includes(permission);
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
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

function ensurePermissions(role, permissions) {
  const normalizedRole = normalizeRole(role);
  const fallback = {
    partner: [
      'clients.view','clients.create','clients.edit','clients.delete','clients.import',
      'staff.view','staff.create','staff.edit','staff.delete','access.manage',
      'modules.view','firm.dashboard.view',
      'timesheets.view_own','timesheets.create_own','timesheets.edit_own','timesheets.delete_own','timesheets.submit_own','timesheets.view_all',
      'approvals.view_manager_queue','approvals.approve_manager','approvals.view_partner_queue','approvals.approve_partner',
      'reports.view','reports.export','attendance.view_own','attendance.create_own','attendance.view_reports','attendance.approve_corrections','dashboard.view_self','dashboard.view_team','dashboard.view_firm',
      'udin.view_own','udin.create','udin.update','udin.review','udin.revoke','udin.dashboard.view'
    ],
    manager: [
      'clients.view','staff.view',
      'modules.view','firm.dashboard.view',
      'timesheets.view_own','timesheets.create_own','timesheets.edit_own','timesheets.delete_own','timesheets.submit_own','timesheets.view_all',
      'approvals.view_manager_queue','approvals.approve_manager',
      'reports.view','reports.export','attendance.view_own','attendance.create_own','attendance.view_reports','attendance.approve_corrections','dashboard.view_self','dashboard.view_team',
      'udin.view_own','udin.create','udin.update','udin.review','udin.revoke','udin.dashboard.view'
    ],
    article: [
      'clients.view',
      'modules.view',
      'firm.dashboard.view',
      'timesheets.view_own','timesheets.create_own','timesheets.edit_own','timesheets.delete_own','timesheets.submit_own','attendance.view_own','attendance.create_own','dashboard.view_self',
      'udin.view_own','udin.create','udin.dashboard.view'
      ]
    };
  const current = Array.isArray(permissions) ? permissions.filter(Boolean) : [];
  return [...new Set([...current, ...(fallback[normalizedRole] || [])])];
}

function isValidEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidMobileNumber(value) {
  if (!value) return true;
  const normalized = normalizePhoneCandidate(value);
  if (/^\+\d{10,15}$/.test(normalized)) return true;
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function normalizeStatusFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['active', 'inactive', 'all'].includes(normalized) ? normalized : '';
}

function isActiveUser(value) {
  return value === true || value === 1 || value === '1' || String(value).trim().toLowerCase() === 'true';
}

async function usernameExistsInsensitive(username, excludeId = null) {
  const lowered = String(username || '').trim().toLowerCase();
  const users = await getUsersMap();
  for (const [id, data] of users.entries()) {
    if (excludeId && id === excludeId) continue;
    if (String(data.username || '').trim().toLowerCase() === lowered) return true;
  }
  return false;
}

async function emailExistsInsensitive(email, excludeId = null) {
  const lowered = normalizeEmail(email);
  if (!lowered) return false;
  const users = await getUsersMap();
  for (const [id, data] of users.entries()) {
    if (excludeId && id === excludeId) continue;
    if (normalizeEmail(data.email) === lowered) return true;
  }
  return false;
}

async function mobileNumberExists(mobileNumber, excludeId = null) {
  const normalized = toE164PhoneNumber(mobileNumber) || normalizeMobileNumber(mobileNumber);
  if (!normalized) return false;
  const users = await getUsersMap();
  for (const [id, data] of users.entries()) {
    if (excludeId && id === excludeId) continue;
    const existing = toE164PhoneNumber(data.mobile_number) || normalizeMobileNumber(data.mobile_number);
    if (existing === normalized) return true;
  }
  return false;
}

router.get('/access-catalog', async (req, res) => {
  if (!(req.user.permissions || []).includes('access.manage')) {
    return res.status(403).json({ error: 'Access management permission required' });
  }
  res.json({ groups: APP_PERMISSION_GROUPS });
});

router.get('/trusted-devices', async (req, res) => {
  if (!(req.user.permissions || []).includes('access.manage')) {
    return res.status(403).json({ error: 'Access management permission required' });
  }

  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || 'active').trim().toLowerCase();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 25, 1), 100);
    const [trustedDevicesSnap, usersMap] = await Promise.all([
      db.collection('trusted_devices').get(),
      getUsersMap()
    ]);

    const rows = trustedDevicesSnap.docs.map(doc => {
      const data = doc.data() || {};
      const user = usersMap.get(data.user_id) || {};
      return {
        id: doc.id,
        user_id: data.user_id,
        device_id: data.device_id || '',
        device_label: data.device_label || '',
        user_agent: data.user_agent || '',
        created_at: data.created_at || '',
        last_used_at: data.last_used_at || '',
        revoked_at: data.revoked_at || null,
        revoked_by_user_id: data.revoked_by_user_id || null,
        name: user.name || '',
        username: user.username || '',
        role: user.role || '',
        active: !data.revoked_at
      };
    }).sort((a, b) => String(b.last_used_at || b.created_at || '').localeCompare(String(a.last_used_at || a.created_at || '')));

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/trusted-devices/:id/revoke', async (req, res) => {
  if (!(req.user.permissions || []).includes('access.manage')) {
    return res.status(403).json({ error: 'Access management permission required' });
  }

  try {
    const docRef = db.collection('trusted_devices').doc(String(req.params.id || '').trim());
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Device not found' });
    }
    if (snap.data()?.revoked_at) {
      return res.json({ success: true });
    }
    await docRef.set({
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: req.user.id
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  if (!managerOrAbove(req)) return res.status(403).json({ error: 'Manager or Partner access required' });
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 50, 1), 200);
    const wantsPagedResponse = !!(req.query.page || req.query.page_size || req.query.q);
    const statusFilter = normalizeStatusFilter(req.query.status);
    const snapshot = await getUsersMap();
    const users = [];
    snapshot.forEach((value, id) => {
      const u = { ...value };
      delete u.password;
      users.push({
        id,
        ...u,
        role: normalizeRole(u.role),
        permissions: ensurePermissions(u.role, u.permissions),
        email: normalizeEmail(u.email),
        mobile_number: normalizeMobileNumber(u.mobile_number)
      });
    });
    users.sort((a,b) => a.name.localeCompare(b.name));
    const filtered = query
      ? users.filter(user => [user.name, user.username, user.role, user.designation, user.department, user.email, user.mobile_number].join(' ').toLowerCase().includes(query))
      : users;
    const statusFiltered = statusFilter === 'active'
      ? filtered.filter(user => isActiveUser(user.active))
      : statusFilter === 'inactive'
        ? filtered.filter(user => !isActiveUser(user.active))
        : filtered;

    if (!wantsPagedResponse) {
      return res.json(statusFiltered);
    }

    const start = (page - 1) * pageSize;
    const items = statusFiltered.slice(start, start + pageSize);
    res.json({
      items,
      total: statusFiltered.length,
      page,
      page_size: pageSize,
      has_more: start + items.length < statusFiltered.length
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/', async (req, res) => {
  if (!hasPermission(req, 'staff.create')) return res.status(403).json({ error: 'Permission required: staff.create' });
  const { name, username, password, role, designation, department, active, permissions } = req.body;
  const email = normalizeEmail(req.body?.email);
  const mobileNumber = normalizeMobileNumber(req.body?.mobile_number);
  if (!name || !username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (permissions && !hasPermission(req, 'access.manage')) {
    return res.status(403).json({ error: 'Permission required: access.manage' });
  }
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email ID' });
  if (!isValidMobileNumber(mobileNumber)) return res.status(400).json({ error: 'Enter a valid mobile number' });
  try {
    const normalizedUsername = username.trim();
    if (await usernameExistsInsensitive(normalizedUsername)) {
      return res.status(400).json({ error: 'Username taken' });
    }
    if (await emailExistsInsensitive(email)) {
      return res.status(400).json({ error: 'Email ID is already used by another user' });
    }
    if (await mobileNumberExists(mobileNumber)) {
      return res.status(400).json({ error: 'Mobile number is already used by another user' });
    }

    const hash = await bcrypt.hash(password, 10);
    const docRef = await db.collection('users').add({
      name, username: normalizedUsername, password: hash,
      role: normalizeRole(role || 'article'),
      permissions: ensurePermissions(role || 'article', permissions),
      email,
      mobile_number: mobileNumber,
      mfa_secret: '',
      mfa_enabled: false,
      mfa_recovery_code_hashes: [],
      designation: designation || '',
      department: department || '',
      active: active !== undefined ? active : true,
        created_at: new Date()
      });
    invalidateCache('users:all');
    invalidateCacheByPrefix('dashboard:');
    res.json({ id: docRef.id });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/:id', async (req, res) => {
  if (!hasPermission(req, 'staff.edit')) return res.status(403).json({ error: 'Permission required: staff.edit' });
  const { name, username, password, role, designation, department, active, permissions } = req.body;
  const email = normalizeEmail(req.body?.email);
  const mobileNumber = normalizeMobileNumber(req.body?.mobile_number);
  if (permissions && !hasPermission(req, 'access.manage')) {
    return res.status(403).json({ error: 'Permission required: access.manage' });
  }
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email ID' });
  if (!isValidMobileNumber(mobileNumber)) return res.status(400).json({ error: 'Enter a valid mobile number' });
  const updates = {
    name,
    username: (username || '').trim(),
    role: normalizeRole(role),
    permissions: ensurePermissions(role, permissions),
    email,
    mobile_number: mobileNumber,
    designation: designation||'',
    department: department||'',
    active: active!==undefined?active:true
  };
  try {
    if (!updates.username) return res.status(400).json({ error: 'Username is required' });
    if (await usernameExistsInsensitive(updates.username, req.params.id)) {
      return res.status(400).json({ error: 'Username taken' });
    }
    if (await emailExistsInsensitive(email, req.params.id)) {
      return res.status(400).json({ error: 'Email ID is already used by another user' });
    }
    if (await mobileNumberExists(mobileNumber, req.params.id)) {
      return res.status(400).json({ error: 'Mobile number is already used by another user' });
    }
    if (password) updates.password = await bcrypt.hash(password, 10);
    await db.collection('users').doc(req.params.id).update(updates);
    invalidateCache('users:all');
    invalidateCacheByPrefix('dashboard:');
    res.json({ success: true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
