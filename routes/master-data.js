const express = require('express');
const router = express.Router();
const db = require('../js/database');

const ALLOWED_CATEGORIES = new Set(['work_category', 'work_classification']);

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
    work_classifications: listCategory('work_classification')
  });
});

router.post('/:category', (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Partner only' });
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

router.put('/:category/:id', (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Partner only' });
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

module.exports = router;
