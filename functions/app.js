const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { db } = require('./db');
const { JWT_SECRET } = require('./config');

const authRoutes = require('./routes/auth');
const staffRoutes = require('./routes/staff');
const clientRoutes = require('./routes/clients');
const masterDataRoutes = require('./routes/master-data');
const attendanceRoutes = require('./routes/attendance');
const timesheetRoutes = require('./routes/timesheets');
const reportRoutes = require('./routes/reports');

const app = express();
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

app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function ensurePermissions(role, permissions) {
  return Array.isArray(permissions) && permissions.length
    ? permissions
    : (ROLE_DEFAULT_PERMISSIONS[normalizeRole(role)] || []);
}

async function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userDoc = await db.collection('users').doc(decoded.id).get();
    if (!userDoc.exists) return res.status(401).json({ error: 'Unauthorized' });

    const user = userDoc.data();
    if (user.active === false || user.active === 0 || user.active === '0') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = {
      id: userDoc.id,
      username: user.username,
      name: user.name,
      role: normalizeRole(user.role),
      designation: user.designation || '',
      email: user.email || '',
      mobile_number: user.mobile_number || '',
      permissions: ensurePermissions(user.role, user.permissions)
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function managerOrAbove(req, res, next) {
  if (!['manager', 'partner'].includes(req.user.role)) return res.status(403).json({ error: 'Manager or Partner access required' });
  next();
}

app.use('/api/auth', authRoutes);
app.use('/api/staff', authMiddleware, staffRoutes);
app.use('/api/clients', authMiddleware, clientRoutes);
app.use('/api/master-data', authMiddleware, masterDataRoutes);
app.use('/api/attendance', authMiddleware, attendanceRoutes);
app.use('/api/timesheets', authMiddleware, timesheetRoutes);
app.use('/api/reports', authMiddleware, managerOrAbove, reportRoutes);

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = {
  app,
  authMiddleware,
  managerOrAbove
};
