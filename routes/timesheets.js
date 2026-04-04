const express = require('express');
const router = express.Router();
const db = require('../js/database');

// GET all timesheets - role-aware
router.get('/', (req, res) => {
  const { from, to, user_id, status } = req.query;
  let query = `
    SELECT t.*, u.name as staff_name, u.role as staff_role,
           c.name as client_name,
           mu.name as manager_name, pu.name as partner_name
    FROM timesheet_entries t
    LEFT JOIN users u ON t.user_id = u.id
    LEFT JOIN clients c ON t.client_id = c.id
    LEFT JOIN users mu ON t.approved_by_manager = mu.id
    LEFT JOIN users pu ON t.approved_by_partner = pu.id
    WHERE 1=1
  `;
  const params = [];

  // Articles only see their own; managers and partners see all (or filtered)
  if (req.user.role === 'article') {
    query += ' AND t.user_id = ?'; params.push(req.user.id);
  } else if (user_id) {
    query += ' AND t.user_id = ?'; params.push(user_id);
  }
  if (from) { query += ' AND t.entry_date >= ?'; params.push(from); }
  if (to) { query += ' AND t.entry_date <= ?'; params.push(to); }
  if (status) { query += ' AND t.status = ?'; params.push(status); }

  query += ' ORDER BY t.entry_date DESC, t.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

// POST create entry
router.post('/', (req, res) => {
  const { entry_date, client_id, task_type, description, hours, billable } = req.body;
  if (!entry_date || !task_type || hours == null) return res.status(400).json({ error: 'Date, task type and hours are required' });
  const result = db.prepare(`
    INSERT INTO timesheet_entries (user_id, entry_date, client_id, task_type, description, hours, billable, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(req.user.id, entry_date, client_id || null, task_type, description || '', parseFloat(hours), billable ? 1 : 0);
  res.json({ id: result.lastInsertRowid });
});

// PUT update entry
router.put('/:id', (req, res) => {
  const entry = db.prepare("SELECT * FROM timesheet_entries WHERE id = ?").get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  if (req.user.role === 'article' && entry.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (entry.status === 'approved') return res.status(400).json({ error: 'Cannot edit an approved entry' });
  const { entry_date, client_id, task_type, description, hours, billable } = req.body;
  db.prepare(`
    UPDATE timesheet_entries SET entry_date=?, client_id=?, task_type=?, description=?, hours=?, billable=?, updated_at=datetime('now') WHERE id=?
  `).run(entry_date, client_id || null, task_type, description, parseFloat(hours), billable ? 1 : 0, req.params.id);
  res.json({ success: true });
});

// DELETE entry
router.delete('/:id', (req, res) => {
  const entry = db.prepare("SELECT * FROM timesheet_entries WHERE id = ?").get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'article' && entry.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (entry.status === 'approved') return res.status(400).json({ error: 'Cannot delete an approved entry' });
  db.prepare("DELETE FROM timesheet_entries WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// POST submit — Articles submit to manager, Managers submit directly to partner
router.post('/submit', (req, res) => {
  const { entry_ids } = req.body;
  if (!entry_ids || !entry_ids.length) return res.status(400).json({ error: 'No entries specified' });
  const placeholders = entry_ids.map(() => '?').join(',');

  if (req.user.role === 'article') {
    // Article → pending_manager
    db.prepare(`UPDATE timesheet_entries SET status='pending_manager', updated_at=datetime('now')
      WHERE id IN (${placeholders}) AND user_id=? AND status IN ('draft','rejected')`)
      .run(...entry_ids, req.user.id);
  } else if (req.user.role === 'manager') {
    // Manager own timesheets → pending_partner
    db.prepare(`UPDATE timesheet_entries SET status='pending_partner', updated_at=datetime('now')
      WHERE id IN (${placeholders}) AND user_id=? AND status IN ('draft','rejected')`)
      .run(...entry_ids, req.user.id);
  } else if (req.user.role === 'partner') {
    // Partner self-approves instantly
    db.prepare(`UPDATE timesheet_entries SET status='approved', approved_by_partner=?, updated_at=datetime('now')
      WHERE id IN (${placeholders}) AND user_id=? AND status IN ('draft','rejected')`)
      .run(req.user.id, ...entry_ids, req.user.id);
  }
  res.json({ success: true });
});

// POST review — Manager approves pending_manager → pending_partner; Partner approves pending_partner → approved
router.post('/review', (req, res) => {
  const role = req.user.role;
  if (!['manager', 'partner'].includes(role)) return res.status(403).json({ error: 'Manager or Partner access required' });

  const { entry_ids, action, rejection_reason } = req.body;
  if (!entry_ids || !action) return res.status(400).json({ error: 'entry_ids and action required' });
  const placeholders = entry_ids.map(() => '?').join(',');

  if (action === 'approve') {
    if (role === 'manager') {
      // Manager first-level approval → move to pending_partner
      db.prepare(`UPDATE timesheet_entries SET status='pending_partner', approved_by_manager=?, updated_at=datetime('now')
        WHERE id IN (${placeholders}) AND status='pending_manager'`)
        .run(req.user.id, ...entry_ids);
    } else if (role === 'partner') {
      // Partner final approval
      db.prepare(`UPDATE timesheet_entries SET status='approved', approved_by_partner=?, updated_at=datetime('now')
        WHERE id IN (${placeholders}) AND status='pending_partner'`)
        .run(req.user.id, ...entry_ids);
    }
  } else {
    // Reject — both manager and partner can reject
    const requiredStatus = role === 'manager' ? 'pending_manager' : 'pending_partner';
    db.prepare(`UPDATE timesheet_entries SET status='rejected', rejection_reason=?, updated_at=datetime('now')
      WHERE id IN (${placeholders}) AND status=?`)
      .run(rejection_reason || 'Rejected', ...entry_ids, requiredStatus);
  }
  res.json({ success: true });
});

// GET stats — role-aware
router.get('/stats', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay()+6)%7));
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const role = req.user.role;
  const userId = req.user.id;

  let myHoursFilter = role === 'article' ? 'AND user_id = ?' : '';
  let myParams = role === 'article' ? [userId] : [];

  const todayHours = db.prepare(`SELECT COALESCE(SUM(hours),0) as h FROM timesheet_entries WHERE entry_date=? ${myHoursFilter}`).get(today, ...myParams);
  const weekHours = db.prepare(`SELECT COALESCE(SUM(hours),0) as h FROM timesheet_entries WHERE entry_date>=? ${myHoursFilter}`).get(weekStartStr, ...myParams);

  let pendingCount = 0;
  if (role === 'manager') {
    pendingCount = db.prepare("SELECT COUNT(*) as cnt FROM timesheet_entries WHERE status='pending_manager'").get().cnt;
  } else if (role === 'partner') {
    pendingCount = db.prepare("SELECT COUNT(*) as cnt FROM timesheet_entries WHERE status='pending_partner'").get().cnt;
  } else {
    pendingCount = db.prepare("SELECT COUNT(*) as cnt FROM timesheet_entries WHERE status IN ('pending_manager','pending_partner') AND user_id=?").get(userId).cnt;
  }

  const draftCount = db.prepare(`SELECT COUNT(*) as cnt FROM timesheet_entries WHERE status='draft' AND user_id=?`).get(userId).cnt;

  res.json({
    today_hours: todayHours.h,
    week_hours: weekHours.h,
    pending_approvals: pendingCount,
    draft_count: draftCount
  });
});

module.exports = router;
