const express = require('express');
const router = express.Router();
const { db } = require('../db');

// In Firestore, we must fetch documents and map/reduce them in-memory since complex GROUP BY SUM aggregations are not natively supported easily.

router.get('/utilization', async (req, res) => {
  const { from, to } = req.query;
  try {
    const usersSnap = await db.collection('users').where('active','==',true).get();
    const userMap = {};
    usersSnap.forEach(doc => {
      const u = doc.data();
      userMap[doc.id] = { name: u.name, designation: u.designation, role: u.role, total_hours: 0, billable_hours: 0, non_billable_hours: 0 };
    });

    let tQuery = db.collection('timesheets');
    if (from) tQuery = tQuery.where('entry_date', '>=', from);
    if (to) tQuery = tQuery.where('entry_date', '<=', to);
    
    const tsSnap = await tQuery.get();
    tsSnap.forEach(doc => {
      const t = doc.data();
      if (!userMap[t.user_id]) return;
      const h = parseFloat(t.hours) || 0;
      userMap[t.user_id].total_hours += h;
      if (t.billable) userMap[t.user_id].billable_hours += h;
      else userMap[t.user_id].non_billable_hours += h;
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
  const { from, to } = req.query;
  try {
    const clientSnap = await db.collection('clients').where('active','==',true).get();
    const clientMap = {};
    clientSnap.forEach(doc => {
      const c = doc.data();
      clientMap[doc.id] = { client_name: c.name, code: c.code, billing_rate: c.billing_rate, total_hours: 0, billable_hours: 0, billable_value: 0 };
    });

    let tQuery = db.collection('timesheets');
    if (from) tQuery = tQuery.where('entry_date', '>=', from);
    if (to) tQuery = tQuery.where('entry_date', '<=', to);
    
    const tsSnap = await tQuery.get();
    tsSnap.forEach(doc => {
      const t = doc.data();
      if (!t.client_id || !clientMap[t.client_id]) return;
      const h = parseFloat(t.hours) || 0;
      clientMap[t.client_id].total_hours += h;
      if (t.billable) {
        clientMap[t.client_id].billable_hours += h;
        clientMap[t.client_id].billable_value += h * (clientMap[t.client_id].billing_rate || 0);
      }
    });

    const rows = Object.values(clientMap).sort((a,b) => b.billable_hours - a.billable_hours);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/export', async (req, res) => {
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = 'ca-timesheet-secret-2024';
  if (req.query.token) {
    try { req.user = jwt.verify(req.query.token, JWT_SECRET); } catch { return res.status(401).send('Unauthorized'); }
  }
  if (!req.user) return res.status(401).send('Unauthorized');
  if (!['manager','partner'].includes(req.user.role)) return res.status(403).send('Manager or Partner only');

  const { from, to, user_id, client_id } = req.query;
  try {
    const userCache = {}; const clientCache = {};
    const uSnap = await db.collection('users').get(); uSnap.forEach(d => userCache[d.id] = d.data().name);
    const cSnap = await db.collection('clients').get(); cSnap.forEach(d => clientCache[d.id] = d.data().name);

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
        billable: t.billable ? 'Yes' : 'No',
        status: t.status
      });
    });

    rows.sort((a,b) => a.entry_date.localeCompare(b.entry_date) || a.staff_name.localeCompare(b.staff_name));

    const headers = ['Date', 'Staff', 'Client', 'Task Type', 'Description', 'Hours', 'Billable', 'Status'];
    const csv = [headers.join(','), ...rows.map(r => [
      r.entry_date, `"${r.staff_name || ''}"`, `"${r.client_name || ''}"`,
      `"${r.task_type}"`, `"${(r.description || '').replace(/"/g, '""')}"`,
      r.hours, r.billable, r.status
    ].join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="samay-report.csv"');
    res.send(csv);
  } catch(e) { res.status(500).send(e.message); }
});

module.exports = router;
