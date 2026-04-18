const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../js/database');
const { hasPermission, ensurePermissions } = require('../js/permissions');
const { JWT_SECRET } = require('../config');
const ONLINE_WINDOW_MS = 15 * 60 * 1000;

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

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function isOnline(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (Date.now() - date.getTime()) <= ONLINE_WINDOW_MS;
}

function formatIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10)
  };
}

function shiftIsoDate(value, deltaDays) {
  const parts = parseIsoDateParts(value);
  if (!parts) return value;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return formatIsoDate(date);
}

function diffIsoDays(from, to) {
  const fromParts = parseIsoDateParts(from);
  const toParts = parseIsoDateParts(to);
  if (!fromParts || !toParts) return null;
  const start = Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day);
  const end = Date.UTC(toParts.year, toParts.month - 1, toParts.day);
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function currentIndiaDate() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatWatchLabel(isoDate) {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kolkata'
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
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

router.get('/firm-login-summary', (req, res) => {
  if (
    !hasPermission(req.user, 'firm.dashboard.view') &&
    !hasPermission(req.user, 'reports.view') &&
    !hasPermission(req.user, 'access.manage')
  ) {
    return res.status(403).json({ error: 'Firm report access required' });
  }

  const rows = db.prepare(`
    SELECT
      u.id,
      u.name,
      u.username,
      u.role,
      u.designation,
      u.email,
      u.mobile_number,
      u.last_login_at,
      u.last_activity_at,
      u.created_at,
      CASE
        WHEN u.last_activity_at IS NOT NULL AND datetime(u.last_activity_at) >= datetime('now', '-15 minutes') THEN 1
        ELSE 0
      END AS is_online
    FROM users u
    WHERE u.active = 1
    ORDER BY CASE u.role WHEN 'partner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name
  `).all().map(user => ({
    ...user,
    last_login_at: formatDateTime(user.last_login_at),
    last_activity_at: formatDateTime(user.last_activity_at),
    is_online: !!user.is_online
  }));

  res.json({
    summary: {
      total_users: rows.length,
      online_users: rows.filter(user => user.is_online).length,
      offline_users: rows.filter(user => !user.is_online).length
    },
    users: rows
  });
});

router.get('/team-update-watch', (req, res) => {
  if (!['manager', 'partner'].includes(String(req.user?.role || '').trim().toLowerCase())) {
    return res.status(403).json({ error: 'Manager or Partner only' });
  }

  const userId = String(req.query.user_id || '').trim();
  const today = currentIndiaDate();
  let from = String(req.query.from || '').trim();
  let to = String(req.query.to || '').trim();

  if (!from && !to) {
    const range = String(req.query.range || '7d').trim().toLowerCase();
    if (range === '30d' || range === '1m' || range === '1month') {
      to = today;
      from = shiftIsoDate(today, -29);
    } else {
      to = today;
      from = shiftIsoDate(today, -6);
    }
  }

  const spanDays = diffIsoDays(from, to);
  if (spanDays == null || spanDays < 0) {
    return res.status(400).json({ error: 'Select a valid date range' });
  }
  if (spanDays > 30) {
    return res.status(400).json({ error: 'Team watch can cover at most 31 days' });
  }

  const dayKeys = [];
  for (let cursor = from; cursor <= to; cursor = shiftIsoDate(cursor, 1)) {
    dayKeys.push(cursor);
    if (cursor === to) break;
  }

  const users = db.prepare(`
    SELECT id, name, role, designation, active
    FROM users
    WHERE active = 1 ${userId ? 'AND id = ?' : ''}
    ORDER BY CASE role WHEN 'partner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, name
  `).all(...(userId ? [userId] : [])).map(user => ({
    id: user.id,
    name: user.name || 'Unknown',
    role: String(user.role || 'article').trim().toLowerCase(),
    designation: user.designation || '',
    active: !!user.active
  }));

  const totals = new Map();
  const queryParams = [from, to];
  let entryQuery = `
    SELECT user_id, entry_date, hours, status
    FROM timesheet_entries
    WHERE entry_date BETWEEN ? AND ?
  `;
  if (userId) {
    entryQuery += ' AND user_id = ?';
    queryParams.push(userId);
  }
  const entries = db.prepare(entryQuery).all(...queryParams);

  for (const row of entries) {
    if (!row || row.status === 'rejected') continue;
    if (!row.user_id || !row.entry_date) continue;
    if (!dayKeys.includes(row.entry_date)) continue;
    const hours = parseFloat(row.hours) || 0;
    if (hours <= 0) continue;
    const key = `${row.user_id}:${row.entry_date}`;
    totals.set(key, (totals.get(key) || 0) + hours);
  }

  const rows = users.map(user => {
    const days = dayKeys.map(date => {
      const hours = totals.get(`${user.id}:${date}`) || 0;
      const status = hours === 0 ? 'missing' : hours < 6 ? 'short' : 'good';
      return { date, hours, status };
    });
    const totalHours = days.reduce((sum, day) => sum + day.hours, 0);
    return {
      ...user,
      total_hours: Number(totalHours.toFixed(2)),
      updated_days: days.filter(day => day.hours > 0).length,
      short_days: days.filter(day => day.status === 'short').length,
      missing_days: days.filter(day => day.status === 'missing').length,
      days
    };
  });

  rows.sort((a, b) => {
    const missingDiff = b.missing_days - a.missing_days;
    if (missingDiff !== 0) return missingDiff;
    const shortDiff = b.short_days - a.short_days;
    if (shortDiff !== 0) return shortDiff;
    const totalDiff = a.total_hours - b.total_hours;
    if (totalDiff !== 0) return totalDiff;
    const roleDiff = (a.role === 'partner' ? 1 : a.role === 'manager' ? 2 : 3) - (b.role === 'partner' ? 1 : b.role === 'manager' ? 2 : 3);
    if (roleDiff !== 0) return roleDiff;
    return a.name.localeCompare(b.name);
  });

  const summary = rows.reduce((acc, row) => {
    acc.team_members += 1;
    acc.updated_members += row.updated_days > 0 ? 1 : 0;
    acc.on_track_members += row.short_days === 0 && row.missing_days === 0 ? 1 : 0;
    acc.short_day_count += row.short_days;
    acc.missing_day_count += row.missing_days;
    acc.total_hours += row.total_hours;
    return acc;
  }, {
    team_members: 0,
    updated_members: 0,
    on_track_members: 0,
    short_day_count: 0,
    missing_day_count: 0,
    total_hours: 0
  });

  res.json({
    range: { from, to },
    days: dayKeys.map(date => ({ date, label: formatWatchLabel(date) })),
    rows,
    summary: {
      ...summary,
      total_hours: Number(summary.total_hours.toFixed(2))
    }
  });
});

router.get('/team-update-watch/export', (req, res) => {
  if (!['manager', 'partner'].includes(String(req.user?.role || '').trim().toLowerCase())) {
    return res.status(403).send('Manager or Partner only');
  }

  const userId = String(req.query.user_id || '').trim();
  const today = currentIndiaDate();
  let from = String(req.query.from || '').trim();
  let to = String(req.query.to || '').trim();

  if (!from && !to) {
    const range = String(req.query.range || '7d').trim().toLowerCase();
    if (range === '30d' || range === '1m' || range === '1month') {
      to = today;
      from = shiftIsoDate(today, -29);
    } else {
      to = today;
      from = shiftIsoDate(today, -6);
    }
  }

  const spanDays = diffIsoDays(from, to);
  if (spanDays == null || spanDays < 0) {
    return res.status(400).send('Select a valid date range');
  }
  if (spanDays > 30) {
    return res.status(400).send('Team watch can cover at most 31 days');
  }

  const dayKeys = [];
  for (let cursor = from; cursor <= to; cursor = shiftIsoDate(cursor, 1)) {
    dayKeys.push(cursor);
    if (cursor === to) break;
  }

  const users = db.prepare(`
    SELECT id, name, role, designation, active
    FROM users
    WHERE active = 1 ${userId ? 'AND id = ?' : ''}
    ORDER BY CASE role WHEN 'partner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, name
  `).all(...(userId ? [userId] : [])).map(user => ({
    id: user.id,
    name: user.name || 'Unknown',
    role: String(user.role || 'article').trim().toLowerCase(),
    designation: user.designation || '',
    active: !!user.active
  }));

  const totals = new Map();
  const queryParams = [from, to];
  let entryQuery = `
    SELECT user_id, entry_date, hours, status
    FROM timesheet_entries
    WHERE entry_date BETWEEN ? AND ?
  `;
  if (userId) {
    entryQuery += ' AND user_id = ?';
    queryParams.push(userId);
  }
  const entries = db.prepare(entryQuery).all(...queryParams);

  for (const row of entries) {
    if (!row || row.status === 'rejected') continue;
    if (!row.user_id || !row.entry_date) continue;
    if (!dayKeys.includes(row.entry_date)) continue;
    const hours = parseFloat(row.hours) || 0;
    if (hours <= 0) continue;
    const key = `${row.user_id}:${row.entry_date}`;
    totals.set(key, (totals.get(key) || 0) + hours);
  }

  const rows = users.map(user => {
    const days = dayKeys.map(date => {
      const hours = totals.get(`${user.id}:${date}`) || 0;
      const status = hours === 0 ? 'missing' : hours < 6 ? 'short' : 'good';
      return { date, hours, status };
    });
    return {
      ...user,
      total_hours: Number(days.reduce((sum, day) => sum + day.hours, 0).toFixed(2)),
      updated_days: days.filter(day => day.hours > 0).length,
      short_days: days.filter(day => day.status === 'short').length,
      missing_days: days.filter(day => day.status === 'missing').length,
      days
    };
  }).sort((a, b) => {
    const missingDiff = b.missing_days - a.missing_days;
    if (missingDiff !== 0) return missingDiff;
    const shortDiff = b.short_days - a.short_days;
    if (shortDiff !== 0) return shortDiff;
    const totalDiff = a.total_hours - b.total_hours;
    if (totalDiff !== 0) return totalDiff;
    const roleDiff = (a.role === 'partner' ? 1 : a.role === 'manager' ? 2 : 3) - (b.role === 'partner' ? 1 : b.role === 'manager' ? 2 : 3);
    if (roleDiff !== 0) return roleDiff;
    return a.name.localeCompare(b.name);
  });

  const headers = [
    'Staff',
    'Role',
    'Designation',
    'Total Hours',
    'Updated Days',
    'Short Days',
    'Missing Days',
    ...dayKeys.map(date => formatWatchLabel(date))
  ];

  const csv = [
    headers.join(','),
    ...rows.map(row => [
      csvEscape(row.name),
      csvEscape(row.role),
      csvEscape(row.designation || ''),
      row.total_hours.toFixed(2),
      row.updated_days,
      row.short_days,
      row.missing_days,
      ...row.days.map(day => {
        if (day.status === 'missing') return csvEscape('No update');
        if (day.status === 'short') return csvEscape(`${day.hours.toFixed(2)} short`);
        return csvEscape(day.hours.toFixed(2));
      })
    ].join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="team-update-watch.csv"');
  res.send(csv);
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
