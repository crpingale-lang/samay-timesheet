const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const db = require('../js/database');
const { hasPermission } = require('../js/permissions');
const {
  buildDraftEntries,
  groupEntriesByDate,
  normalizeTimerInput
} = require('../functions/lib/focus-timer-core');

function requirePermission(req, res, permission) {
  if (!hasPermission(req.user, permission)) {
    res.status(403).json({ error: `Permission required: ${permission}` });
    return false;
  }
  return true;
}

function getSession(userId) {
  return db.prepare(`
    SELECT s.*, c.name AS client_name, c.code AS client_code
    FROM time_sessions s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.user_id = ?
  `).get(userId);
}

function activeSession(userId) {
  const session = getSession(userId);
  return session?.status === 'running' ? session : null;
}

function validateLinkedData(input) {
  if (!input.task_type) return 'Work category is required';
  const task = db.prepare(`
    SELECT id FROM master_data_options
    WHERE category = 'work_category' AND label = ? AND active = 1
  `).get(input.task_type);
  if (!task) return 'Select an active work category';

  const classification = db.prepare(`
    SELECT id FROM master_data_options
    WHERE category = 'work_classification' AND key = ? AND active = 1
  `).get(input.work_classification);
  if (!classification) return 'Select an active work classification';

  if (input.work_classification === 'client_work' && !input.client_id) {
    return 'Client is required for client work';
  }
  if (input.client_id) {
    const client = db.prepare('SELECT id FROM clients WHERE id = ? AND active = 1').get(input.client_id);
    if (!client) return 'Select an active client';
  }
  return '';
}

router.get('/active', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.view_own')) return;
  res.json({
    active: activeSession(req.user.id),
    server_now: new Date().toISOString()
  });
});

router.post('/start', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.create_own')) return;
  const input = normalizeTimerInput(req.body);
  const validationError = validateLinkedData(input);
  if (validationError) return res.status(400).json({ error: validationError });

  const existing = activeSession(req.user.id);
  if (existing) {
    return res.status(409).json({
      error: 'A timer is already running',
      active: existing,
      server_now: new Date().toISOString()
    });
  }

  const now = new Date().toISOString();
  const sessionId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO time_sessions (
      user_id, session_id, client_id, task_type, description, work_classification,
      source, status, started_at, stopped_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, NULL, datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      session_id = excluded.session_id,
      client_id = excluded.client_id,
      task_type = excluded.task_type,
      description = excluded.description,
      work_classification = excluded.work_classification,
      source = excluded.source,
      status = 'running',
      started_at = excluded.started_at,
      stopped_at = NULL,
      created_at = datetime('now'),
      updated_at = datetime('now')
  `).run(
    req.user.id,
    sessionId,
    input.client_id || null,
    input.task_type,
    input.description,
    input.work_classification,
    input.source,
    now
  );

  res.status(201).json({
    active: activeSession(req.user.id),
    server_now: now
  });
});

router.post('/stop', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.create_own')) return;
  const session = activeSession(req.user.id);
  if (!session) return res.status(409).json({ error: 'No running timer was found' });

  const finalDescription = req.body.description === undefined
    ? session.description
    : String(req.body.description || '').trim().slice(0, 2000);
  const stoppedAt = new Date().toISOString();
  const existing = db.prepare(`
    SELECT entry_date, start_time, end_time
    FROM timesheet_entries
    WHERE user_id = ? AND start_time IS NOT NULL AND end_time IS NOT NULL
  `).all(req.user.id);
  const result = buildDraftEntries(
    { ...session, description: finalDescription },
    stoppedAt,
    groupEntriesByDate(existing)
  );

  const insertEntry = db.prepare(`
    INSERT INTO timesheet_entries (
      user_id, entry_date, client_id, task_type, description, start_time, end_time,
      hours, work_classification, billable, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `);
  const stopSession = db.prepare(`
    UPDATE time_sessions
    SET description = ?, status = 'stopped', stopped_at = ?, updated_at = datetime('now')
    WHERE user_id = ? AND session_id = ? AND status = 'running'
  `);

  const commitStop = db.transaction(() => {
    const entryIds = result.entries.map(entry => insertEntry.run(
      req.user.id,
      entry.entry_date,
      entry.client_id,
      entry.task_type,
      entry.description,
      entry.start_time,
      entry.end_time,
      entry.hours,
      entry.work_classification,
      entry.billable
    ).lastInsertRowid);
    const update = stopSession.run(finalDescription, stoppedAt, req.user.id, session.session_id);
    if (!update.changes) throw new Error('Timer changed before it could be stopped');
    return entryIds;
  });

  try {
    const entryIds = commitStop();
    res.json({
      success: true,
      entry_ids: entryIds,
      entries: result.entries.map((entry, index) => ({ id: entryIds[index], ...entry })),
      warning: result.warning,
      elapsed_seconds: result.elapsed_seconds
    });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

router.post('/discard', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.create_own')) return;
  const session = activeSession(req.user.id);
  if (!session) return res.status(409).json({ error: 'No running timer was found' });
  const stoppedAt = new Date().toISOString();
  const result = db.prepare(`
    UPDATE time_sessions
    SET status = 'discarded', stopped_at = ?, updated_at = datetime('now')
    WHERE user_id = ? AND session_id = ? AND status = 'running'
  `).run(stoppedAt, req.user.id, session.session_id);
  if (!result.changes) return res.status(409).json({ error: 'Timer changed before it could be discarded' });
  res.json({ success: true, stopped_at: stoppedAt });
});

module.exports = router;
