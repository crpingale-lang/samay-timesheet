const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getUsersMap, getClientsMap } = require('../data-cache');
const { JWT_SECRET } = require('../config');

function normalizeWorkClassification(workClassification, billable) {
  if (workClassification) return workClassification;
  if (billable === 1 || billable === true) return 'client_work';
  if (billable === 0 || billable === false) return 'internal';
  return 'client_work';
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

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function roleSortOrder(role) {
  switch (normalizeRole(role)) {
    case 'partner':
      return 1;
    case 'manager':
      return 2;
    default:
      return 3;
  }
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

// In Firestore, we must fetch documents and map/reduce them in-memory since complex GROUP BY SUM aggregations are not natively supported easily.

router.get('/utilization', async (req, res) => {
  const { from, to, user_id } = req.query;
  try {
    const usersSnap = await getUsersMap();
    const userMap = {};
    usersSnap.forEach((u, id) => {
      if (user_id && id !== user_id) return;
      userMap[id] = {
        name: u.name || 'Unknown',
        designation: u.designation || '',
        role: u.role || 'article',
        total_hours: 0,
        billable_hours: 0,
        non_billable_hours: 0,
        client_work_hours: 0,
        non_client_hours: 0
      };
    });

    let tQuery = db.collection('timesheets');
    if (from) tQuery = tQuery.where('entry_date', '>=', from);
    if (to) tQuery = tQuery.where('entry_date', '<=', to);
    
    const tsSnap = await tQuery.get();
    tsSnap.forEach(doc => {
      const t = doc.data();
      if (t.status !== 'approved') return;
      if (user_id && t.user_id !== user_id) return;
      if (!userMap[t.user_id]) {
        userMap[t.user_id] = {
          name: 'Unknown',
          designation: '',
          role: 'article',
          total_hours: 0,
          billable_hours: 0,
          non_billable_hours: 0,
          client_work_hours: 0,
          non_client_hours: 0
        };
      }
      if (!userMap[t.user_id]) return;
      const h = parseFloat(t.hours) || 0;
      const workClassification = normalizeWorkClassification(t.work_classification, t.billable);
      userMap[t.user_id].total_hours += h;
      if (workClassification === 'client_work') {
        userMap[t.user_id].billable_hours += h;
        userMap[t.user_id].client_work_hours += h;
      } else {
        userMap[t.user_id].non_billable_hours += h;
        userMap[t.user_id].non_client_hours += h;
      }
    });

    // Object to Array, sort by role
    const rows = Object.values(userMap);
    rows.sort((a,b) => {
      const rA = a.role==='partner'?1:a.role==='manager'?2:3;
      const rB = b.role==='partner'?1:b.role==='manager'?2:3;
      return rA - rB || a.name.localeCompare(b.name);
    });
    
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/team-update-watch', async (req, res) => {
  if (!['manager', 'partner'].includes(normalizeRole(req.user?.role))) {
    return res.status(403).json({ error: 'Manager or Partner only' });
  }

  try {
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

    const usersMap = await getUsersMap();
    const users = [];
    usersMap.forEach((user, id) => {
      const active = user.active !== false && user.active !== 0 && user.active !== '0';
      if (!userId && !active) return;
      if (userId && String(id) !== userId) return;

      users.push({
        id,
        name: user.name || 'Unknown',
        role: normalizeRole(user.role) || 'article',
        designation: user.designation || '',
        active
      });
    });

    const timesheetSnap = await db.collection('timesheets')
      .where('entry_date', '>=', from)
      .where('entry_date', '<=', to)
      .get();

    const dailyTotals = new Map();
    timesheetSnap.forEach(doc => {
      const row = doc.data();
      if (!row || row.status === 'rejected') return;
      if (userId && String(row.user_id || '') !== userId) return;
      if (!row.user_id || !row.entry_date) return;
      if (!dayKeys.includes(row.entry_date)) return;
      const hours = parseFloat(row.hours) || 0;
      if (hours <= 0) return;
      const key = `${row.user_id}:${row.entry_date}`;
      dailyTotals.set(key, (dailyTotals.get(key) || 0) + hours);
    });

    const rows = users.map(user => {
      const days = dayKeys.map(date => {
        const hours = dailyTotals.get(`${user.id}:${date}`) || 0;
        const status = hours === 0 ? 'missing' : hours < 6 ? 'short' : 'good';
        return { date, hours, status };
      });

      const totalHours = days.reduce((sum, day) => sum + day.hours, 0);
      const updatedDays = days.filter(day => day.hours > 0).length;
      const shortDays = days.filter(day => day.status === 'short').length;
      const missingDays = days.filter(day => day.status === 'missing').length;

      return {
        ...user,
        total_hours: Number(totalHours.toFixed(2)),
        updated_days: updatedDays,
        short_days: shortDays,
        missing_days: missingDays,
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
      const roleDiff = roleSortOrder(a.role) - roleSortOrder(b.role);
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
      range: {
        from,
        to
      },
      days: dayKeys.map(date => ({
        date,
        label: formatWatchLabel(date)
      })),
      rows,
      summary: {
        ...summary,
        total_hours: Number(summary.total_hours.toFixed(2))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/team-update-watch/export', async (req, res) => {
  if (!['manager', 'partner'].includes(normalizeRole(req.user?.role))) {
    return res.status(403).send('Manager or Partner only');
  }

  try {
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

    const usersMap = await getUsersMap();
    const users = [];
    usersMap.forEach((user, id) => {
      const active = user.active !== false && user.active !== 0 && user.active !== '0';
      if (!userId && !active) return;
      if (userId && String(id) !== userId) return;
      users.push({
        id,
        name: user.name || 'Unknown',
        role: normalizeRole(user.role) || 'article',
        designation: user.designation || '',
        active
      });
    });

    const timesheetSnap = await db.collection('timesheets')
      .where('entry_date', '>=', from)
      .where('entry_date', '<=', to)
      .get();

    const dailyTotals = new Map();
    timesheetSnap.forEach(doc => {
      const row = doc.data();
      if (!row || row.status === 'rejected') return;
      if (userId && String(row.user_id || '') !== userId) return;
      if (!row.user_id || !row.entry_date) return;
      if (!dayKeys.includes(row.entry_date)) return;
      const hours = parseFloat(row.hours) || 0;
      if (hours <= 0) return;
      const key = `${row.user_id}:${row.entry_date}`;
      dailyTotals.set(key, (dailyTotals.get(key) || 0) + hours);
    });

    const rows = users.map(user => {
      const days = dayKeys.map(date => {
        const hours = dailyTotals.get(`${user.id}:${date}`) || 0;
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
      const roleDiff = roleSortOrder(a.role) - roleSortOrder(b.role);
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
  } catch (error) {
    res.status(500).send(error.message);
  }
});

router.get('/by-client', async (req, res) => {
  const { from, to, user_id } = req.query;
  try {
    const clientSnap = await getClientsMap();
    const clientMap = {};
    clientSnap.forEach((c, id) => {
      if (c.active === false) return;
      clientMap[id] = {
        client_name: c.name,
        code: c.code,
        billing_rate: c.billing_rate,
        total_hours: 0,
        billable_hours: 0,
        billable_value: 0,
        client_work_hours: 0,
        client_work_value: 0
      };
    });

    let tQuery = db.collection('timesheets');
    if (from) tQuery = tQuery.where('entry_date', '>=', from);
    if (to) tQuery = tQuery.where('entry_date', '<=', to);
    
    const tsSnap = await tQuery.get();
    tsSnap.forEach(doc => {
      const t = doc.data();
      if (t.status !== 'approved') return;
      if (user_id && t.user_id !== user_id) return;
      if (!t.client_id || !clientMap[t.client_id]) return;
      const h = parseFloat(t.hours) || 0;
      const workClassification = normalizeWorkClassification(t.work_classification, t.billable);
      clientMap[t.client_id].total_hours += h;
      if (workClassification === 'client_work') {
        clientMap[t.client_id].billable_hours += h;
        clientMap[t.client_id].billable_value += h * (clientMap[t.client_id].billing_rate || 0);
        clientMap[t.client_id].client_work_hours += h;
        clientMap[t.client_id].client_work_value += h * (clientMap[t.client_id].billing_rate || 0);
      }
    });

    const rows = Object.values(clientMap).sort((a,b) => b.client_work_hours - a.client_work_hours);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/export', async (req, res) => {
  const jwt = require('jsonwebtoken');
  if (req.query.token) {
    try { req.user = jwt.verify(req.query.token, JWT_SECRET); } catch { return res.status(401).send('Unauthorized'); }
  }
  if (!req.user) return res.status(401).send('Unauthorized');
  if (!['manager','partner'].includes(req.user.role)) return res.status(403).send('Manager or Partner only');

  const { from, to, user_id, client_id } = req.query;
  try {
    const [usersMap, clientsMap] = await Promise.all([getUsersMap(), getClientsMap()]);
    const userCache = {};
    const clientCache = {};
    usersMap.forEach((data, id) => { userCache[id] = data.name; });
    clientsMap.forEach((data, id) => { clientCache[id] = data.name; });

    let tQuery = db.collection('timesheets');
    if (from) tQuery = tQuery.where('entry_date', '>=', from);
    if (to) tQuery = tQuery.where('entry_date', '<=', to);
    if (user_id) tQuery = tQuery.where('user_id', '==', user_id);
    if (client_id) tQuery = tQuery.where('client_id', '==', client_id);

    const tsSnap = await tQuery.get();
    const rows = [];
    tsSnap.forEach(doc => {
      const t = doc.data();
      rows.push({
        entry_date: t.entry_date,
        staff_name: userCache[t.user_id] || 'Unknown',
        client_name: t.client_id ? clientCache[t.client_id] : 'Internal',
        task_type: t.task_type,
        description: t.description || '',
        hours: t.hours,
        work_classification: normalizeWorkClassification(t.work_classification, t.billable),
        status: t.status
      });
    });

    rows.sort((a,b) => a.entry_date.localeCompare(b.entry_date) || a.staff_name.localeCompare(b.staff_name));

    const headers = ['Date', 'Staff', 'Client', 'Task Type', 'Description', 'Hours', 'Work Classification', 'Status'];
    const csv = [headers.join(','), ...rows.map(r => [
      r.entry_date, `"${r.staff_name || ''}"`, `"${r.client_name || ''}"`,
      `"${r.task_type}"`, `"${(r.description || '').replace(/"/g, '""')}"`,
      r.hours, formatWorkClassification(r.work_classification), r.status
    ].join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="samay-report.csv"');
    res.send(csv);
  } catch(e) { res.status(500).send(e.message); }
});

module.exports = router;
