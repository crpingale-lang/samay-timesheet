const express = require('express');
const router = express.Router();
const db = require('../js/database');

// GET utilization report
router.get('/utilization', (req, res) => {
  const { from, to } = req.query;
  const rows = db.prepare(`
    SELECT u.name, u.designation, u.role,
      COALESCE(SUM(t.hours), 0) AS total_hours,
      COALESCE(SUM(CASE WHEN t.billable=1 THEN t.hours ELSE 0 END), 0) AS billable_hours,
      COALESCE(SUM(CASE WHEN t.billable=0 THEN t.hours ELSE 0 END), 0) AS non_billable_hours
    FROM users u
    LEFT JOIN timesheet_entries t ON t.user_id = u.id
      AND t.entry_date BETWEEN ? AND ?
    WHERE u.active = 1
    GROUP BY u.id ORDER BY CASE u.role WHEN 'partner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name
  `).all(from || '2000-01-01', to || '2099-12-31');
  res.json(rows);
});

// GET client report
router.get('/by-client', (req, res) => {
  const { from, to } = req.query;
  const rows = db.prepare(`
    SELECT c.name as client_name, c.code, c.billing_rate,
      COALESCE(SUM(t.hours), 0) AS total_hours,
      COALESCE(SUM(CASE WHEN t.billable=1 THEN t.hours ELSE 0 END), 0) AS billable_hours,
      COALESCE(SUM(CASE WHEN t.billable=1 THEN t.hours * c.billing_rate ELSE 0 END), 0) AS billable_value
    FROM clients c
    LEFT JOIN timesheet_entries t ON t.client_id = c.id
      AND t.entry_date BETWEEN ? AND ?
    WHERE c.active = 1
    GROUP BY c.id ORDER BY billable_hours DESC
  `).all(from || '2000-01-01', to || '2099-12-31');
  res.json(rows);
});

// GET detailed entries for export (token can be passed as query param for browser download)
router.get('/export', (req, res) => {
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = 'ca-timesheet-secret-2024';
  if (req.query.token) {
    try { req.user = jwt.verify(req.query.token, JWT_SECRET); } catch { return res.status(401).send('Unauthorized'); }
  }
  if (!req.user) return res.status(401).send('Unauthorized');
  if (!['manager','partner'].includes(req.user.role)) return res.status(403).send('Manager or Partner only');

  const { from, to, user_id, client_id } = req.query;
  let query = `
    SELECT t.entry_date, u.name as staff_name, c.name as client_name,
      t.task_type, t.description, t.hours,
      CASE WHEN t.billable=1 THEN 'Yes' ELSE 'No' END as billable,
      t.status
    FROM timesheet_entries t
    LEFT JOIN users u ON t.user_id = u.id
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (from) { query += ' AND t.entry_date >= ?'; params.push(from); }
  if (to) { query += ' AND t.entry_date <= ?'; params.push(to); }
  if (user_id) { query += ' AND t.user_id = ?'; params.push(user_id); }
  if (client_id) { query += ' AND t.client_id = ?'; params.push(client_id); }
  query += ' ORDER BY t.entry_date, u.name';

  const rows = db.prepare(query).all(...params);

  // Build CSV
  const headers = ['Date', 'Staff', 'Client', 'Task Type', 'Description', 'Hours', 'Billable', 'Status'];
  const csv = [headers.join(','), ...rows.map(r => [
    r.entry_date, `"${r.staff_name || ''}"`, `"${r.client_name || 'Internal'}"`,
    `"${r.task_type}"`, `"${(r.description || '').replace(/"/g, '""')}"`,
    r.hours, r.billable, r.status
  ].join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="timesheet-report.csv"');
  res.send(csv);
});

module.exports = router;
