const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../js/database');

// GET all staff
router.get('/', (req, res) => {
  const staff = db.prepare("SELECT id, name, username, role, designation, department, active, created_at FROM users ORDER BY CASE role WHEN 'partner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, name").all();
  res.json(staff);
});

// POST create staff
router.post('/', (req, res) => {
  const { name, username, password, role, designation, department } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required' });
  const allowedRoles = ['partner', 'manager', 'article'];
  if (!allowedRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare("INSERT INTO users (name, username, password, role, designation, department) VALUES (?, ?, ?, ?, ?, ?)")
      .run(name, username, hash, role || 'article', designation || '', department || '');
    res.json({ id: result.lastInsertRowid, name, username, role: role || 'article' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PUT update staff
router.put('/:id', (req, res) => {
  const { name, designation, department, active, password, role } = req.body;
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET name=?, designation=?, department=?, active=?, password=?, role=? WHERE id=?")
      .run(name, designation, department, active !== undefined ? active : 1, hash, role, req.params.id);
  } else {
    db.prepare("UPDATE users SET name=?, designation=?, department=?, active=?, role=? WHERE id=?")
      .run(name, designation, department, active !== undefined ? active : 1, role, req.params.id);
  }
  res.json({ success: true });
});

// GET staff hours summary
router.get('/hours-summary', (req, res) => {
  const { from, to } = req.query;
  const rows = db.prepare(`
    SELECT u.id, u.name, u.designation, u.role,
      COALESCE(SUM(t.hours), 0) AS total_hours,
      COALESCE(SUM(CASE WHEN t.billable=1 THEN t.hours ELSE 0 END), 0) AS billable_hours
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
