const express = require('express');
const router = express.Router();
const { db } = require('../db');

// Helper to hydrate timesheets with staff/client names
async function hydrateTimesheets(docs) {
  const userCache = {}; const clientCache = {};
  const results = [];
  for (const doc of docs) {
    const t = doc.data();
    if (!userCache[t.user_id]) {
      const u = await db.collection('users').doc(t.user_id).get();
      userCache[t.user_id] = u.exists ? u.data() : {name:'Unknown', role:'article'};
    }
    if (t.client_id && !clientCache[t.client_id]) {
      const c = await db.collection('clients').doc(t.client_id).get();
      clientCache[t.client_id] = c.exists ? c.data().name : 'Unknown';
    }
    results.push({
      id: doc.id,
      ...t,
      staff_name: userCache[t.user_id].name,
      staff_role: userCache[t.user_id].role,
      client_name: t.client_id ? clientCache[t.client_id] : null
    });
  }
  return results.sort((a,b) => b.entry_date.localeCompare(a.entry_date));
}

router.get('/', async (req, res) => {
  const { from, to, status, user_id } = req.query;
  try {
    let query = db.collection('timesheets');
    if (req.user.role === 'article') { query = query.where('user_id', '==', req.user.id); }
    else if (user_id) { query = query.where('user_id', '==', user_id); }

    if (status) query = query.where('status', '==', status);
    if (from) query = query.where('entry_date', '>=', from);
    if (to) query = query.where('entry_date', '<=', to);

    const snapshot = await query.get();
    const rows = await hydrateTimesheets(snapshot.docs);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/', async (req, res) => {
  const { entry_date, client_id, task_type, description, hours, billable } = req.body;
  if (!entry_date || !task_type || !hours) return res.status(400).json({ error: 'Missing fields' });
  try {
    const docRef = await db.collection('timesheets').add({
      user_id: req.user.id,
      entry_date, client_id: client_id||null, task_type,
      description: description||'', hours: parseFloat(hours),
      billable: billable?1:0,
      status: 'draft',
      created_at: new Date().toISOString()
    });
    res.json({ id: docRef.id });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/:id', async (req, res) => {
  const { entry_date, client_id, task_type, description, hours, billable } = req.body;
  try {
    const ref = db.collection('timesheets').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({error:'Not found'});
    if (doc.data().user_id !== req.user.id && req.user.role !== 'partner') return res.status(403).json({error:'Access denied'});
    
    await ref.update({
      entry_date, client_id: client_id||null, task_type,
      description: description||'', hours: parseFloat(hours),
      billable: billable?1:0
    });
    res.json({ success: true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/:id', async (req, res) => {
  try {
    const ref = db.collection('timesheets').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({error:'Not found'});
    if (doc.data().user_id !== req.user.id && req.user.role !== 'partner') return res.status(403).json({error:'Access denied'});
    await ref.delete();
    res.json({ success: true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/submit', async (req, res) => {
  const { entry_ids } = req.body;
  if (!Array.isArray(entry_ids) || !entry_ids.length) return res.status(400).json({error:'No entries provided'});
  
  const targetStatus = req.user.role === 'article' ? 'pending_manager' 
                     : req.user.role === 'manager' ? 'pending_partner' 
                     : 'approved';
  try {
    const batch = db.batch();
    for (const id of entry_ids) {
      batch.update(db.collection('timesheets').doc(id), { status: targetStatus });
    }
    await batch.commit();
    res.json({ success: true, newStatus: targetStatus });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/review', async (req, res) => {
  if (!['manager','partner'].includes(req.user.role)) return res.status(403).json({error:'Access denied'});
  const { entry_ids, action, rejection_reason } = req.body; // action = 'approve' or 'reject'
  if (!Array.isArray(entry_ids) || !entry_ids.length) return res.status(400).json({error:'No entries provided'});

  try {
    const batch = db.batch();
    for (const id of entry_ids) {
      const ref = db.collection('timesheets').doc(id);
      if (action === 'approve') {
        const targetStatus = req.user.role === 'manager' ? 'pending_partner' : 'approved';
        batch.update(ref, { status: targetStatus, rejection_reason: null });
      } else if (action === 'reject') {
        batch.update(ref, { status: 'rejected', rejection_reason: rejection_reason || 'Rejected without reason' });
      }
    }
    await batch.commit();
    res.json({ success: true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
