const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getClientsMap, invalidateCache } = require('../data-cache');

function hasPermission(req, permission) {
  return Array.isArray(req.user?.permissions) && req.user.permissions.includes(permission);
}

function normalizeCode(code) {
  return (code || '').trim().toUpperCase();
}

function clientScore(data = {}) {
  return ['name', 'contact_person', 'email', 'phone'].reduce((score, key) => score + (data[key] ? 1 : 0), 0) +
    ((parseFloat(data.billing_rate) || 0) > 0 ? 1 : 0);
}

function chooseCanonical(group) {
  return [...group].sort((a, b) => {
    const scoreDiff = clientScore(b.data) - clientScore(a.data);
    if (scoreDiff !== 0) return scoreDiff;
    return a.id.localeCompare(b.id);
  })[0];
}

router.get('/', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 50, 1), 200);
    const wantsPagedResponse = !!(req.query.page || req.query.page_size || req.query.q);
    const snapshot = await getClientsMap();
    const clients = [];
    snapshot.forEach((data, id) => clients.push({ id, ...data }));
    clients.sort((a,b) => a.name.localeCompare(b.name));
    const filtered = query
      ? clients.filter(client => [client.name, client.code, client.contact_person, client.email, client.phone].join(' ').toLowerCase().includes(query))
      : clients;

    if (!wantsPagedResponse) {
      return res.json(filtered);
    }

    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);
    res.json({
      items,
      total: filtered.length,
      page,
      page_size: pageSize,
      has_more: start + items.length < filtered.length
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/', async (req, res) => {
  if (!hasPermission(req, 'clients.create')) return res.status(403).json({ error: 'Permission required: clients.create' });
  const { name, code, contact_person, email, phone, billing_rate } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Name and code required' });
  try {
    const normalizedCode = normalizeCode(code);
    const exists = await db.collection('clients').where('code','==',normalizedCode).limit(1).get();
    if (!exists.empty) return res.status(400).json({ error: 'Client code exists' });

    const docRef = await db.collection('clients').add({
      name: name.trim(), code: normalizedCode,
      contact_person: contact_person||'',
      email: email||'', phone: phone||'',
      billing_rate: parseFloat(billing_rate)||0,
      active: true
    });
    invalidateCache('clients:all');
    res.json({ id: docRef.id });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/:id', async (req, res) => {
  if (!hasPermission(req, 'clients.edit')) return res.status(403).json({ error: 'Permission required: clients.edit' });
  const { name, contact_person, email, phone, billing_rate, active } = req.body;
  try {
    await db.collection('clients').doc(req.params.id).update({
      name, contact_person: contact_person||'',
      email: email||'', phone: phone||'',
      billing_rate: parseFloat(billing_rate)||0,
      active: active!==undefined?active:true
    });
    invalidateCache('clients:all');
    res.json({ success: true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete('/:id', async (req, res) => {
  if (!hasPermission(req, 'clients.delete')) return res.status(403).json({ error: 'Permission required: clients.delete' });
  try {
    const clientDoc = await db.collection('clients').doc(req.params.id).get();
    if (!clientDoc.exists) return res.status(404).json({ error: 'Client not found' });

    const usageSnap = await db.collection('timesheets').where('client_id', '==', req.params.id).limit(1).get();
    if (!usageSnap.empty) {
      return res.status(400).json({ error: 'Client is already used in timesheets. Archive it instead of deleting.' });
    }

    await db.collection('clients').doc(req.params.id).delete();
    invalidateCache('clients:all');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/import', async (req, res) => {
  if (!hasPermission(req, 'clients.import')) return res.status(403).json({ error: 'Permission required: clients.import' });
  const { clients, update_existing } = req.body;
  if (!Array.isArray(clients) || !clients.length) return res.status(400).json({error:'No data'});

  let inserted=0, updated=0, skipped=0;
  const errors = [];

  const existingSnap = await db.collection('clients').get();
  const existingByCode = new Map();
  existingSnap.forEach(doc => {
    const data = doc.data();
    const code = normalizeCode(data.code);
    if (!code) return;
    const candidate = { id: doc.id, ref: doc.ref, data };
    const current = existingByCode.get(code);
    if (!current || clientScore(candidate.data) > clientScore(current.data)) {
      existingByCode.set(code, candidate);
    }
  });

  let batch = db.batch();
  let batchCount = 0;
  async function flushBatch() {
    if (!batchCount) return;
    await batch.commit();
    batch = db.batch();
    batchCount = 0;
  }

  for (const row of clients) {
    const code = normalizeCode(row.code);
    const name = (row.name || '').trim();
    if (!code || !name) {
      errors.push(`Missing name or code for row: ${JSON.stringify(row)}`);
      continue;
    }

    const payload = {
      name,
      code,
      contact_person: row.contact_person || '',
      phone: row.phone || '',
      email: row.email || '',
      billing_rate: parseFloat(row.billing_rate) || 0,
      active: true
    };

    const existing = existingByCode.get(code);
    if (existing) {
      if (update_existing) {
        batch.update(existing.ref, payload);
        existingByCode.set(code, { ...existing, data: { ...existing.data, ...payload } });
        updated++;
        batchCount++;
      } else {
        skipped++;
      }
    } else {
      const newRef = db.collection('clients').doc();
      batch.set(newRef, payload);
      existingByCode.set(code, { id: newRef.id, ref: newRef, data: payload });
      inserted++;
      batchCount++;
    }

    if (batchCount >= 400) await flushBatch();
  }

  await flushBatch();
  invalidateCache('clients:all');
  res.json({ inserted, updated, skipped, errors });
});

router.get('/duplicates-preview', async (req, res) => {
  if (!hasPermission(req, 'clients.delete')) return res.status(403).json({ error: 'Permission required: clients.delete' });
  try {
    const snap = await db.collection('clients').get();
    const byCode = new Map();
    snap.forEach(doc => {
      const data = doc.data();
      const code = normalizeCode(data.code);
      if (!code) return;
      const arr = byCode.get(code) || [];
      arr.push({ id: doc.id, data });
      byCode.set(code, arr);
    });

    const groups = [];
    let duplicateDocuments = 0;
    for (const [code, group] of byCode.entries()) {
      if (group.length < 2) continue;
      const keep = chooseCanonical(group);
      const remove = group.filter(item => item.id !== keep.id);
      duplicateDocuments += remove.length;
      groups.push({
        code,
        count: group.length,
        keep: { id: keep.id, name: keep.data.name, score: clientScore(keep.data) },
        remove: remove.map(item => ({ id: item.id, name: item.data.name, score: clientScore(item.data) }))
      });
    }

    groups.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
    res.json({
      total_groups: groups.length,
      duplicate_documents: duplicateDocuments,
      groups
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/deduplicate', async (req, res) => {
  if (!hasPermission(req, 'clients.delete')) return res.status(403).json({ error: 'Permission required: clients.delete' });
  try {
    const snap = await db.collection('clients').get();
    const byCode = new Map();
    snap.forEach(doc => {
      const data = doc.data();
      const code = normalizeCode(data.code);
      if (!code) return;
      const arr = byCode.get(code) || [];
      arr.push({ id: doc.id, ref: doc.ref, data });
      byCode.set(code, arr);
    });

    const replacements = new Map();
    const deleteRefs = [];

    for (const [, group] of byCode.entries()) {
      if (group.length < 2) continue;
      const keep = chooseCanonical(group);
      for (const item of group) {
        if (item.id === keep.id) continue;
        replacements.set(item.id, keep.id);
        deleteRefs.push(item.ref);
      }
    }

    const timesheetsSnap = await db.collection('timesheets').get();
    let batch = db.batch();
    let ops = 0;
    let updatedTimesheets = 0;
    async function flushBatch() {
      if (!ops) return;
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }

    timesheetsSnap.forEach(doc => {
      const data = doc.data();
      const replacement = replacements.get(data.client_id);
      if (!replacement) return;
      batch.update(doc.ref, { client_id: replacement });
      updatedTimesheets++;
      ops++;
    });

    for (const ref of deleteRefs) {
      if (ops >= 400) {
        await flushBatch();
      }
      batch.delete(ref);
      ops++;
    }

    await flushBatch();
    invalidateCache('clients:all');
    res.json({ success: true, deleted: deleteRefs.length, updated_timesheets: updatedTimesheets });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/template', (req, res) => {
  if (!hasPermission(req, 'clients.import')) return res.status(403).json({ error: 'Permission required: clients.import' });
  const csv = ['Name,Code,Contact Person,Phone,Email,Billing Rate (INR/hr)', '"ABC Traders Pvt Ltd","ABC001","Rajesh Shah","9876543210","rajesh@abc.com","2500"'].join('\n');
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="client-import-template.csv"');
  res.send(csv);
});

module.exports = router;
