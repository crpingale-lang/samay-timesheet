const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

const db = require('./js/database');
const authRoutes = require('./routes/auth');
const staffRoutes = require('./routes/staff');
const clientRoutes = require('./routes/clients');
const timesheetRoutes = require('./routes/timesheets');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'ca-timesheet-secret-2024';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to verify JWT
function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Only partners can manage staff, clients, or see full reports
function partnerOnly(req, res, next) {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Partner access required' });
  next();
}

// Managers and partners can access approval routes
function managerOrAbove(req, res, next) {
  if (!['manager', 'partner'].includes(req.user.role)) return res.status(403).json({ error: 'Manager or Partner access required' });
  next();
}

app.use('/api/auth', authRoutes);
app.use('/api/staff', authMiddleware, partnerOnly, staffRoutes);
app.use('/api/clients', authMiddleware, clientRoutes);
app.use('/api/timesheets', authMiddleware, timesheetRoutes);
app.use('/api/reports', authMiddleware, managerOrAbove, reportRoutes);

// Serve frontend (Express 5 compatible catch-all)
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ Samay Server running at http://localhost:${PORT}`);
  console.log(`   Roles: partner / manager / article`);
  console.log(`   Default logins: partner/admin123  |  manager/manager123\n`);
});

module.exports = { JWT_SECRET };
