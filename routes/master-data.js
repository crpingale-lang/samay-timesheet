const express = require('express');
const router = express.Router();
const db = require('../js/database');

const ALLOWED_CATEGORIES = new Set(['work_category', 'work_classification', 'udin_assignment', 'financial_year']);

function canManageMasters(req) {
  return req.user?.role === 'partner' || req.user?.permissions?.includes('access.manage');
}

function listCategory(category) {
  return db.prepare(`
    SELECT id, key, label, short_label, sort_order, active
    FROM master_data_options
    WHERE category = ?
    ORDER BY sort_order ASC, label ASC
  `).all(category);
}

router.get('/', (req, res) => {
  res.json({
    work_categories: listCategory('work_category'),
    work_classifications: listCategory('work_classification'),
    udin_assignments: listCategory('udin_assignment'),
    financial_years: listCategory('financial_year'),
    udin_locations: db.prepare(`
      SELECT id, location AS label, short_name, active
      FROM udin_location_master
      WHERE active = 1
      ORDER BY location ASC
    `).all()
  });
});

router.get('/all/:category', (req, res) => {
  const { category } = req.params;
  if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid category' });
  const items = db.prepare(`
    SELECT id, key, label, short_label, sort_order, active
    FROM master_data_options
    WHERE category = ?
    ORDER BY active DESC, sort_order ASC, label ASC
  `).all(category);
  res.json({ items });
});

router.post('/category/:category', (req, res) => {
  if (!canManageMasters(req)) return res.status(403).json({ error: 'Access denied' });
  const { category } = req.params;
  if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid category' });

  const { key, label, short_label, sort_order, active } = req.body;
  if (!key || !label) return res.status(400).json({ error: 'Key and label are required' });

  try {
    const result = db.prepare(`
      INSERT INTO master_data_options (category, key, label, short_label, sort_order, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(category, key, label, short_label || null, sort_order || 0, active === undefined ? 1 : (active ? 1 : 0));
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Key already exists for this category' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/category/:category/:id', (req, res) => {
  if (!canManageMasters(req)) return res.status(403).json({ error: 'Access denied' });
  const { category, id } = req.params;
  if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid category' });

  const { key, label, short_label, sort_order, active } = req.body;
  if (!key || !label) return res.status(400).json({ error: 'Key and label are required' });

  try {
    db.prepare(`
      UPDATE master_data_options
      SET key = ?, label = ?, short_label = ?, sort_order = ?, active = ?, updated_at = datetime('now')
      WHERE id = ? AND category = ?
    `).run(key, label, short_label || null, sort_order || 0, active ? 1 : 0, id, category);
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Key already exists for this category' });
    res.status(500).json({ error: e.message });
  }
});

router.get('/locations/all', (req, res) => {
  const items = db.prepare(`
    SELECT id, location AS label, short_name, active
    FROM udin_location_master
    ORDER BY active DESC, location ASC
  `).all();
  res.json({ items });
});

router.post('/locations', (req, res) => {
  if (!canManageMasters(req)) return res.status(403).json({ error: 'Access denied' });
  const { label, short_name, active } = req.body || {};
  const location = String(label || '').trim();
  if (!location) return res.status(400).json({ error: 'Location name is required' });
  try {
    const result = db.prepare(`
      INSERT INTO udin_location_master (location, short_name, active, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(
      location,
      String(short_name || '').trim() || null,
      active === undefined ? 1 : (active ? 1 : 0)
    );
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Location already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/locations/:id', (req, res) => {
  if (!canManageMasters(req)) return res.status(403).json({ error: 'Access denied' });
  const { label, short_name, active } = req.body || {};
  const location = String(label || '').trim();
  if (!location) return res.status(400).json({ error: 'Location name is required' });
  try {
    db.prepare(`
      UPDATE udin_location_master
      SET location = ?, short_name = ?, active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      location,
      String(short_name || '').trim() || null,
      active ? 1 : 0,
      req.params.id
    );
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Location already exists' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
