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
