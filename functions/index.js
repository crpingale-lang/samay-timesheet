const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const staffRoutes = require('./routes/staff');
const clientRoutes = require('./routes/clients');
const timesheetRoutes = require('./routes/timesheets');
const reportRoutes = require('./routes/reports');

const app = express();
const JWT_SECRET = 'ca-timesheet-secret-2024';

app.use(cors({ origin: true }));
app.use(express.json());

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

// Only partners
function partnerOnly(req, res, next) {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Partner access required' });
  next();
}

// Managers and partners
function managerOrAbove(req, res, next) {
  if (!['manager', 'partner'].includes(req.user.role)) return res.status(403).json({ error: 'Manager or Partner access required' });
  next();
}

app.use('/api/auth', authRoutes);
app.use('/api/staff', authMiddleware, partnerOnly, staffRoutes);
app.use('/api/clients', authMiddleware, clientRoutes);
app.use('/api/timesheets', authMiddleware, timesheetRoutes);
app.use('/api/reports', authMiddleware, managerOrAbove, reportRoutes);

exports.api = functions.https.onRequest(app);
