const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../js/database');
const { hasPermission, ensurePermissions } = require('../js/permissions');
const JWT_SECRET = 'ca-timesheet-secret-2024';

function requirePermission(req, res, permission) {
  if (!hasPermission(req.user, permission)) {
    res.status(403).json({ error: `Permission required: ${permission}` });
    return false;
  }
  return true;
}

function formatWorkClassification(value) {
  const labels = {
    client_work: 'Client Work',
    internal: 'Internal',
    admin: 'Admin',
    business_development: 'Business Development',
    learning: 'Learning'
  };
  return labels[value] || value || 'Client Work';
}

router.get('/utilization', (req, res) => {
  if (!requirePermission(req, res, 'reports.view')) return;

  const { from, to, user_id } = req.query;
  let query = `
    SELECT u.name, u.designation, u.role,
      COALESCE(SUM(t.hours), 0) AS total_hours,
      COALESCE(SUM(CASE WHEN t.work_classification='client_work' THEN t.hours ELSE 0 END), 0) AS billable_hours,
      COALESCE(SUM(CASE WHEN t.work_classification!='client_work' THEN t.hours ELSE 0 END), 0) AS non_billable_hours,
      COALESCE(SUM(CASE WHEN t.work_classification='client_work' THEN t.hours ELSE 0 END), 0) AS client_work_hours
    FROM users u
    LEFT JOIN timesheet_entries t ON t.user_id = u.id
      AND t.entry_date BETWEEN ? AND ?
      AND t.status = 'approved'
    WHERE 1 = 1
  `;
  const params = [from || '2000-01-01', to || '2099-12-31'];
  if (user_id) {
    query += ' AND u.id = ?';
    params.push(user_id);
  }
  query += " GROUP BY u.id ORDER BY CASE u.role WHEN 'partner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name";
  res.json(db.prepare(query).all(...params));
});

router.get('/by-client', (req, res) => {
  if (!requirePermission(req, res, 'reports.view')) return;

  const { from, to, user_id } = req.query;
  let query = `
    SELECT c.name as client_name, c.code, c.billing_rate,
      COALESCE(SUM(t.hours), 0) AS total_hours,
      COALESCE(SUM(CASE WHEN t.work_classification='client_work' THEN t.hours ELSE 0 END), 0) AS billable_hours,
      COALESCE(SUM(CASE WHEN t.work_classification='client_work' THEN t.hours * c.billing_rate ELSE 0 END), 0) AS billable_value,
      COALESCE(SUM(CASE WHEN t.work_classification='client_work' THEN t.hours ELSE 0 END), 0) AS client_work_hours,
      COALESCE(SUM(CASE WHEN t.work_classification='client_work' THEN t.hours * c.billing_rate ELSE 0 END), 0) AS client_work_value
    FROM clients c
    LEFT JOIN timesheet_entries t ON t.client_id = c.id
      AND t.entry_date BETWEEN ? AND ?
      AND t.status = 'approved'
  `;
  const params = [from || '2000-01-01', to || '2099-12-31'];
  if (user_id) {
    query += ' AND t.user_id = ?';
    params.push(user_id);
  }
  query += ' WHERE c.active = 1 GROUP BY c.id ORDER BY billable_hours DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/export', (req, res) => {
  let exportUser = req.user;
  if (!exportUser && req.query.token) {
    try {
      const decoded = jwt.verify(req.query.token, JWT_SECRET);
      const dbUser = db.prepare("SELECT id, username, name, role, designation, permissions, active FROM users WHERE id = ?").get(decoded.id);
      if (!dbUser || !dbUser.active) return res.status(401).send('Unauthorized');
      exportUser = {
        id: dbUser.id,
        username: dbUser.username,
        name: dbUser.name,
        role: dbUser.role,
        designation: dbUser.designation,
        permissions: ensurePermissions(dbUser.permissions, dbUser.role)
      };
    } catch {
      return res.status(401).send('Unauthorized');
    }
  }
  if (!exportUser) return res.status(401).send('Unauthorized');
  if (!hasPermission(exportUser, 'reports.export')) return res.status(403).send('Report export access required');

  const { from, to, user_id, client_id } = req.query;
  let query = `
    SELECT t.entry_date, u.name as staff_name, c.name as client_name,
      t.task_type, t.description, t.hours,
      COALESCE(t.work_classification, CASE WHEN t.billable=1 THEN 'client_work' ELSE 'internal' END) as work_classification,
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
  const headers = ['Date', 'Staff', 'Client', 'Task Type', 'Description', 'Hours', 'Work Classification', 'Status'];
  const csv = [headers.join(','), ...rows.map(r => [
    r.entry_date, `"${r.staff_name || ''}"`, `"${r.client_name || 'Internal'}"`,
    `"${r.task_type}"`, `"${(r.description || '').replace(/"/g, '""')}"`,
    r.hours, formatWorkClassification(r.work_classification), r.status
  ].join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="timesheet-report.csv"');
  res.send(csv);
});

module.exports = router;
