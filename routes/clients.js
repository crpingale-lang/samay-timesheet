const express = require('express');
const router = express.Router();
const db = require('../js/database');
const { hasPermission } = require('../js/permissions');

function requirePermission(req, res, permission) {
  if (!hasPermission(req.user, permission)) {
    res.status(403).json({ error: `Permission required: ${permission}` });
    return false;
  }
  return true;
}

// GET all clients
router.get('/', (req, res) => {
  if (!requirePermission(req, res, 'clients.view')) return;
  const query = String(req.query.q || '').trim().toLowerCase();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 50, 1), 200);
  const wantsPagedResponse = !!(req.query.page || req.query.page_size || req.query.q);
  const clients = db.prepare("SELECT * FROM clients ORDER BY name").all();
  const filtered = query
    ? clients.filter(client => [client.name, client.code, client.contact_person, client.email, client.phone].join(' ').toLowerCase().includes(query))
    : clients;
  if (!wantsPagedResponse) return res.json(filtered);
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  res.json({
    items,
    total: filtered.length,
    page,
    page_size: pageSize,
    has_more: start + items.length < filtered.length
  });
});

// POST create client (partner only)
router.post('/', (req, res) => {
  if (!requirePermission(req, res, 'clients.create')) return;
  const { name, code, contact_person, email, phone, billing_rate } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });
  try {
    const result = db.prepare("INSERT INTO clients (name, code, contact_person, email, phone, billing_rate) VALUES (?,?,?,?,?,?)")
      .run(name, code.toUpperCase(), contact_person || '', email || '', phone || '', billing_rate || 0);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Client code already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PUT update client (partner only)
router.put('/:id', (req, res) => {
  if (!requirePermission(req, res, 'clients.edit')) return;
  const { name, contact_person, email, phone, billing_rate, active } = req.body;
  db.prepare("UPDATE clients SET name=?, contact_person=?, email=?, phone=?, billing_rate=?, active=? WHERE id=?")
    .run(name, contact_person || '', email || '', phone || '', billing_rate || 0, active !== undefined ? active : 1, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  if (!requirePermission(req, res, 'clients.delete')) return;
  const client = db.prepare("SELECT id FROM clients WHERE id = ?").get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const usage = db.prepare("SELECT COUNT(*) as cnt FROM timesheet_entries WHERE client_id = ?").get(req.params.id);
  if (usage.cnt > 0) {
    return res.status(400).json({ error: 'Client is already used in timesheets. Archive it instead of deleting.' });
  }
  db.prepare("DELETE FROM clients WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// POST bulk import clients from CSV rows (partner only)
// Expects: { clients: [{name, code, contact_person, email, phone, billing_rate}] }
// Strategy: skip existing codes, insert new ones, return summary
router.post('/import', (req, res) => {
  if (!requirePermission(req, res, 'clients.import')) return;
  const { clients, update_existing } = req.body;
  if (!Array.isArray(clients) || clients.length === 0) {
    return res.status(400).json({ error: 'No client data provided' });
  }

  const inserted = [], skipped = [], updated = [], errors = [];

  const insert = db.prepare("INSERT INTO clients (name, code, contact_person, email, phone, billing_rate) VALUES (?,?,?,?,?,?)");
  const update = db.prepare("UPDATE clients SET name=?, contact_person=?, email=?, phone=?, billing_rate=? WHERE code=?");
  const findByCode = db.prepare("SELECT id, name FROM clients WHERE code=?");

  const importAll = db.transaction(() => {
    for (const row of clients) {
      const name = (row.name || '').trim();
      const code = (row.code || '').trim().toUpperCase();
      if (!name || !code) { errors.push(`Row missing name or code: ${JSON.stringify(row)}`); continue; }

      const existing = findByCode.get(code);
      if (existing) {
        if (update_existing) {
          update.run(name, row.contact_person || '', row.email || '', row.phone || '', parseFloat(row.billing_rate) || 0, code);
          updated.push(code);
        } else {
          skipped.push(code);
        }
      } else {
        try {
          insert.run(name, code, row.contact_person || '', row.email || '', row.phone || '', parseFloat(row.billing_rate) || 0);
          inserted.push(code);
        } catch (e) {
          errors.push(`${code}: ${e.message}`);
        }
      }
    }
  });

  try {
    importAll();
    res.json({ inserted: inserted.length, updated: updated.length, skipped: skipped.length, errors, inserted_codes: inserted, updated_codes: updated, skipped_codes: skipped });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET CSV template
router.get('/template', (req, res) => {
  if (!requirePermission(req, res, 'clients.import')) return;
  const csv = [
    'Name,Code,Contact Person,Phone,Email,Billing Rate (INR/hr)',
    '"ABC Traders Pvt Ltd","ABC001","Rajesh Shah","9876543210","rajesh@abc.com","2500"',
    '"XYZ Industries Ltd","XYZ002","Priya Kumar","9123456789","priya@xyz.com","3000"',
    '"Internal","INT001","","","","0"'
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="client-import-template.csv"');
  res.send(csv);
});

module.exports = router;
