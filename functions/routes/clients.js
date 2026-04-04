const express = require('express');
const router = express.Router();
const { db } = require('../db');

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('clients').get();
    const clients = [];
    snapshot.forEach(doc => clients.push({ id: doc.id, ...doc.data() }));
    clients.sort((a,b) => a.name.localeCompare(b.name));
    res.json(clients);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/', async (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Partner only' });
  const { name, code, contact_person, email, phone, billing_rate } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Name and code required' });
  try {
    const exists = await db.collection('clients').where('code','==',code.toUpperCase()).limit(1).get();
    if (!exists.empty) return res.status(400).json({ error: 'Client code exists' });

    const docRef = await db.collection('clients').add({
      name, code: code.toUpperCase(),
      contact_person: contact_person||'',
      email: email||'', phone: phone||'',
      billing_rate: parseFloat(billing_rate)||0,
      active: true
    });
    res.json({ id: docRef.id });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/:id', async (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Partner only' });
  const { name, contact_person, email, phone, billing_rate, active } = req.body;
  try {
    await db.collection('clients').doc(req.params.id).update({
      name, contact_person: contact_person||'',
      email: email||'', phone: phone||'',
      billing_rate: parseFloat(billing_rate)||0,
      active: active!==undefined?active:true
    });
    res.json({ success: true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/import', async (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Partner only' });
  const { clients, update_existing } = req.body;
  if (!Array.isArray(clients) || !clients.length) return res.status(400).json({error:'No data'});

  let inserted=0, updated=0, skipped=0;
  const errors = [];

  const batch = db.batch();
  let batchCount = 0;

  for (const row of clients) {
    const code = (row.code||'').trim().toUpperCase();
    if (!code) continue;
    const exists = await db.collection('clients').where('code','==',code).limit(1).get();
    if (!exists.empty) {
      if (update_existing) {
        batch.update(exists.docs[0].ref, {
          name: row.name.trim(), contact_person: row.contact_person||'',
          phone: row.phone||'', email: row.email||'', billing_rate: parseFloat(row.billing_rate)||0
        });
        updated++; batchCount++;
      } else { skipped++; }
    } else {
      const newRef = db.collection('clients').doc();
      batch.set(newRef, {
        name: row.name.trim(), code, contact_person: row.contact_person||'',
        phone: row.phone||'', email: row.email||'', billing_rate: parseFloat(row.billing_rate)||0, active: true
      });
      inserted++; batchCount++;
    }
    if (batchCount > 400) { await batch.commit(); batchCount=0; }
  }
  if (batchCount > 0) await batch.commit();
  res.json({ inserted, updated, skipped, errors });
});

router.post('/deduplicate', async (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Partner only' });
  try {
    const snap = await db.collection('clients').get();
    const codes = {};
    const deleteBatch = db.batch();
    let deletedCount = 0;

    snap.forEach(doc => {
      const data = doc.data();
      const code = (data.code || '').trim().toUpperCase();
      if (!codes[code]) {
        codes[code] = doc;
      } else {
        // keep the one with more data or arbitrarily the first one
        const existing = codes[code].data();
        const scoreA = (existing.contact_person?1:0) + (existing.email?1:0) + (existing.phone?1:0);
        const scoreB = (data.contact_person?1:0) + (data.email?1:0) + (data.phone?1:0);
        if (scoreB > scoreA) {
          deleteBatch.delete(codes[code].ref);
          codes[code] = doc;
        } else {
          deleteBatch.delete(doc.ref);
        }
        deletedCount++;
      }
    });

    if (deletedCount > 0) await deleteBatch.commit();
    res.json({ success: true, deleted: deletedCount });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/template', (req, res) => {
  const csv = ['Name,Code,Contact Person,Phone,Email,Billing Rate (INR/hr)', '"ABC Traders Pvt Ltd","ABC001","Rajesh Shah","9876543210","rajesh@abc.com","2500"'].join('\n');
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="client-import-template.csv"');
  res.send(csv);
});

module.exports = router;
