const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./js/database');
const { JWT_SECRET } = require('./config');

const authRoutes = require('./routes/auth');
const staffRoutes = require('./routes/staff');
const clientRoutes = require('./routes/clients');
const masterDataRoutes = require('./routes/master-data');
const timesheetMastersRoutes = require('./routes/timesheet-masters');
const attendanceRoutes = require('./routes/attendance');
const timesheetRoutes = require('./routes/timesheets');
const reportRoutes = require('./routes/reports');
const feedbackRoutes = require('./routes/feedback');
const form15cbRoutes = require('./functions/routes/form15cb');
const udinRoutes = require('./routes/udin');

const app = express();

async function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    if (!user || user.active === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: String(user.role || '').trim().toLowerCase(),
      designation: user.designation || '',
      email: user.email || '',
      mobile_number: user.mobile_number || '',
      permissions: user.permissions ? JSON.parse(user.permissions) : []
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function managerOrAbove(req, res, next) {
  if (!['manager', 'partner'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Manager or Partner access required' });
  }
  next();
}

app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/staff', authMiddleware, staffRoutes);
app.use('/api/users', authMiddleware, staffRoutes);
app.use('/api/clients', authMiddleware, clientRoutes);
app.use('/api/master-data', authMiddleware, masterDataRoutes);
app.use('/api/timesheet-masters', authMiddleware, timesheetMastersRoutes);
app.use('/api/attendance', authMiddleware, attendanceRoutes);
app.use('/api/timesheets', authMiddleware, timesheetRoutes);
app.use('/api/reports', authMiddleware, managerOrAbove, reportRoutes);
app.use('/api/feedback', authMiddleware, feedbackRoutes);
app.use('/api/form15cb', authMiddleware, form15cbRoutes);
app.use('/api/udin', authMiddleware, udinRoutes);

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = {
  app,
  backendName: 'SQLite local'
};
