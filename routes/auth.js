const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../js/database');

const JWT_SECRET = 'ca-timesheet-secret-2024';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role, designation: user.designation } });
});

// POST /api/auth/change-password
router.post('/change-password', (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  let user;
  try { user = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }

  const { currentPassword, newPassword } = req.body;
  const dbUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  if (!bcrypt.compareSync(currentPassword, dbUser.password)) return res.status(400).json({ error: 'Current password is incorrect' });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, user.id);
  res.json({ success: true });
});

module.exports = router;
