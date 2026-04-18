const express = require('express');
const router = express.Router();
const db = require('../js/database');
const { hasPermission } = require('../js/permissions');

const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const dashboardCache = new Map();

function requirePermission(req, res, permission) {
  if (!hasPermission(req.user, permission)) {
    res.status(403).json({ error: `Permission required: ${permission}` });
    return false;
  }
  return true;
}

function invalidateDashboardCache() {
  for (const key of [...dashboardCache.keys()]) {
    if (key.startsWith('dashboard:')) {
      dashboardCache.delete(key);
    }
  }
}

async function rememberDashboardSummary(key, loader) {
  const now = Date.now();
  const cached = dashboardCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const pendingKey = `${key}:pending`;
  const pending = dashboardCache.get(pendingKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await loader();
      dashboardCache.set(key, { value, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS });
      return value;
    } finally {
      dashboardCache.delete(pendingKey);
    }
  })();

  dashboardCache.set(pendingKey, promise);
  return promise;
}

function canViewAllTimesheets(req) {
  return hasPermission(req.user, 'timesheets.view_all') || hasPermission(req.user, 'reports.view');
}

function approvalStage(req) {
  if (hasPermission(req.user, 'approvals.approve_manager')) return 'manager';
  return null;
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function nextSubmissionStatus(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'article') return 'pending_manager';
  if (normalizedRole === 'manager') return 'approved';
  if (normalizedRole === 'partner') return 'approved';
  return 'pending_manager';
}

function normalizeWorkClassification(workClassification, billable) {
  if (workClassification) return workClassification;
  if (billable === 1 || billable === true) return 'client_work';
  if (billable === 0 || billable === false) return 'internal';
  return 'client_work';
}

function normalizeCollaborators(userIds = [], currentUserId = null) {
  const seen = new Set();
  return (Array.isArray(userIds) ? userIds : [])
    .map(id => parseInt(id, 10))
    .filter(id => Number.isInteger(id) && id > 0)
    .filter(id => id !== currentUserId)
    .filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function timeToMinutes(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function currentIndiaDateTimeParts() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (parseInt(parts.hour, 10) * 60) + parseInt(parts.minute, 10)
  };
}

function parseIsoDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10)
  };
}

function formatIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekBoundsForDate(value) {
  const parts = parseIsoDateParts(value);
  if (!parts) return { from: value, to: value };
  const current = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = current.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  current.setUTCDate(current.getUTCDate() + diff);
  const start = new Date(current);
  const end = new Date(current);
  end.setUTCDate(end.getUTCDate() + 6);
  return { from: formatIsoDate(start), to: formatIsoDate(end) };
}

function monthBoundsForDate(value) {
  const parts = parseIsoDateParts(value);
  if (!parts) return { from: value, to: value };
  return {
    from: `${parts.year}-${String(parts.month).padStart(2, '0')}-01`,
    to: value
  };
}

function validateNotFutureTime(entryDate, startTime, endTime) {
  const current = currentIndiaDateTimeParts();
  if (entryDate !== current.date) return null;
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (startMinutes != null && startMinutes > current.minutes) return 'From time cannot be after the current time';
  if (endMinutes != null && endMinutes > current.minutes) return 'To time cannot be after the current time';
  return null;
}

function validateTimeWindow(startTime, endTime) {
  if (!startTime && !endTime) return null;
  if (!startTime || !endTime) return 'Both start time and end time are required together';
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start == null || end == null) return 'Invalid time value';
  if (end <= start) return 'End time must be after start time';
  return null;
}

function hasOverlap(userId, entryDate, startTime, endTime, excludedId = null) {
  if (!startTime || !endTime) return false;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const existingEntries = db.prepare(`
    SELECT id, start_time, end_time
    FROM timesheet_entries
    WHERE user_id = ? AND entry_date = ? AND start_time IS NOT NULL AND end_time IS NOT NULL
  `).all(userId, entryDate);

  return existingEntries.some(entry => {
    if (excludedId && String(entry.id) === String(excludedId)) return false;
    const entryStart = timeToMinutes(entry.start_time);
    const entryEnd = timeToMinutes(entry.end_time);
    if (entryStart == null || entryEnd == null) return false;
    return start < entryEnd && entryStart < end;
  });
}

const entryBaseSelect = `
  SELECT t.*, u.name as staff_name, u.role as staff_role,
         c.name as client_name,
         mu.name as manager_name, pu.name as partner_name
  FROM timesheet_entries t
  LEFT JOIN users u ON t.user_id = u.id
  LEFT JOIN clients c ON t.client_id = c.id
  LEFT JOIN users mu ON t.approved_by_manager = mu.id
  LEFT JOIN users pu ON t.approved_by_partner = pu.id
`;

function attachCollaborators(entries) {
  if (!entries.length) return entries;
  const ids = entries.map(entry => entry.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT tec.entry_id, tec.user_id, u.name
    FROM timesheet_entry_collaborators tec
    JOIN users u ON u.id = tec.user_id
    WHERE tec.entry_id IN (${placeholders})
    ORDER BY u.name
  `).all(...ids);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.entry_id)) grouped.set(row.entry_id, []);
    grouped.get(row.entry_id).push({ id: row.user_id, name: row.name });
  }
  return entries.map(entry => ({
    ...entry,
    worked_with_user_ids: (grouped.get(entry.id) || []).map(item => item.id),
    worked_with: grouped.get(entry.id) || []
  }));
}

function syncEntryCollaborators(entryId, collaboratorIds) {
  db.prepare('DELETE FROM timesheet_entry_collaborators WHERE entry_id = ?').run(entryId);
  const insert = db.prepare('INSERT INTO timesheet_entry_collaborators (entry_id, user_id) VALUES (?, ?)');
  for (const userId of collaboratorIds) {
    insert.run(entryId, userId);
  }
}

function syncCollaborationRequests(entryId, sourceUserId, payload, collaboratorIds) {
  const existing = db.prepare(`
    SELECT id, target_user_id, status
    FROM timesheet_collaboration_requests
    WHERE source_entry_id = ?
  `).all(entryId);

  const activeIds = collaboratorIds.length
    ? db.prepare(`SELECT id FROM users WHERE active = 1 AND id IN (${collaboratorIds.map(() => '?').join(',')})`).all(...collaboratorIds).map(row => row.id)
    : [];
  const activeSet = new Set(activeIds);
  const existingByTarget = new Map(existing.map(row => [row.target_user_id, row]));

  const updatePending = db.prepare(`
    UPDATE timesheet_collaboration_requests
    SET entry_date = ?, client_id = ?, task_type = ?, description = ?, start_time = ?, end_time = ?, hours = ?, work_classification = ?, updated_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `);
  const insertRequest = db.prepare(`
    INSERT INTO timesheet_collaboration_requests (
      source_entry_id, source_user_id, target_user_id, entry_date, client_id, task_type, description, start_time, end_time, hours, work_classification, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `);
  const cancelPending = db.prepare(`
    UPDATE timesheet_collaboration_requests
    SET status = 'cancelled', updated_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `);

  for (const userId of collaboratorIds) {
    if (!activeSet.has(userId)) continue;
    const existingRow = existingByTarget.get(userId);
    if (existingRow) {
      updatePending.run(
        payload.entry_date,
        payload.client_id || null,
        payload.task_type,
        payload.description || '',
        payload.start_time || null,
        payload.end_time || null,
        payload.hours,
        payload.work_classification,
        existingRow.id
      );
      continue;
    }

    insertRequest.run(
      entryId,
      sourceUserId,
      userId,
      payload.entry_date,
      payload.client_id || null,
      payload.task_type,
      payload.description || '',
      payload.start_time || null,
      payload.end_time || null,
      payload.hours,
      payload.work_classification
    );
  }

  for (const row of existing) {
    if (!collaboratorIds.includes(row.target_user_id)) {
      cancelPending.run(row.id);
    }
  }
}

router.get('/collaborators', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.view_own')) return;
  const users = db.prepare(`
    SELECT id, name, role, designation
    FROM users
    WHERE active = 1 AND id != ?
    ORDER BY name
  `).all(req.user.id);
  res.json(users);
});

router.get('/collaboration-requests', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.view_own')) return;
  const rows = db.prepare(`
    SELECT r.*, su.name AS source_user_name, su.role AS source_user_role, c.name AS client_name
    FROM timesheet_collaboration_requests r
    JOIN users su ON su.id = r.source_user_id
    LEFT JOIN clients c ON c.id = r.client_id
    WHERE r.target_user_id = ? AND r.status = 'pending'
    ORDER BY r.entry_date DESC, r.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

router.post('/collaboration-requests/:id/accept', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.create_own')) return;
  const request = db.prepare(`
    SELECT *
    FROM timesheet_collaboration_requests
    WHERE id = ? AND target_user_id = ? AND status = 'pending'
  `).get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: 'Collaboration request not found' });

  const overlaps = hasOverlap(req.user.id, request.entry_date, request.start_time, request.end_time);
  const result = db.prepare(`
    INSERT INTO timesheet_entries (
      user_id, entry_date, client_id, task_type, description, start_time, end_time, hours,
      work_classification, billable, status, collaboration_source_entry_id, collaboration_request_id,
      requires_time_confirmation
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(
    req.user.id,
    request.entry_date,
    request.client_id || null,
    request.task_type,
    request.description || '',
    request.start_time || null,
    request.end_time || null,
    request.hours,
    request.work_classification,
    request.work_classification === 'client_work' ? 1 : 0,
    request.source_entry_id,
    request.id,
    overlaps ? 1 : 0
  );

  db.prepare(`
    UPDATE timesheet_collaboration_requests
    SET status = 'accepted', accepted_entry_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(result.lastInsertRowid, request.id);

  const entry = db.prepare(`${entryBaseSelect} WHERE t.id = ?`).get(result.lastInsertRowid);
  res.json({
    success: true,
    overlap_warning: overlaps ? 'Time overlaps existing entries. Update the time before saving or submitting this entry.' : null,
    entry: attachCollaborators([entry])[0]
  });
});

router.post('/collaboration-requests/:id/reject', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.view_own')) return;
  const result = db.prepare(`
    UPDATE timesheet_collaboration_requests
    SET status = 'rejected', updated_at = datetime('now')
    WHERE id = ? AND target_user_id = ? AND status = 'pending'
  `).run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Collaboration request not found' });
  res.json({ success: true });
});

router.get('/dashboard-summary', (req, res) => {
  if (!requirePermission(req, res, 'dashboard.view_self')) return;

  const current = currentIndiaDateTimeParts();
  const today = current.date;
  const cacheKey = `dashboard:${req.user.id}:${today}`;

  try {
    const payload = rememberDashboardSummary(cacheKey, async () => {
      const weekBounds = weekBoundsForDate(today);
      const userId = req.user.id;
      const userEntries = attachCollaborators(db.prepare(`${entryBaseSelect} WHERE t.user_id = ? ORDER BY t.entry_date DESC, t.created_at DESC`).all(userId));

      const todayHours = userEntries
        .filter(entry => entry.entry_date === today)
        .reduce((sum, entry) => sum + (parseFloat(entry.hours) || 0), 0);
      const weekHours = userEntries
        .filter(entry => entry.entry_date >= weekBounds.from && entry.entry_date <= weekBounds.to)
        .reduce((sum, entry) => sum + (parseFloat(entry.hours) || 0), 0);
      const draftCount = userEntries.filter(entry => entry.status === 'draft').length;
      const weekBreakdown = [0, 0, 0, 0, 0, 0, 0];

      userEntries.forEach(entry => {
        if (entry.entry_date < weekBounds.from || entry.entry_date > weekBounds.to) return;
        const parts = parseIsoDateParts(entry.entry_date);
        if (!parts) return;
        const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
        const index = (date.getUTCDay() + 6) % 7;
        weekBreakdown[index] += parseFloat(entry.hours) || 0;
      });

      let pendingApprovals = userEntries.filter(entry => ['pending_manager', 'pending_partner'].includes(entry.status)).length;
      if (hasPermission(req.user, 'approvals.approve_manager')) {
        pendingApprovals = db.prepare("SELECT COUNT(*) as cnt FROM timesheet_entries WHERE status IN ('pending_manager','pending_partner')").get().cnt;
      }

      let utilization = [];
      if (hasPermission(req.user, 'dashboard.view_team') || hasPermission(req.user, 'dashboard.view_firm')) {
        const monthBounds = monthBoundsForDate(today);
        utilization = db.prepare(`
          SELECT u.name, u.role,
            COALESCE(SUM(t.hours), 0) AS total_hours,
            COALESCE(SUM(CASE WHEN t.work_classification='client_work' THEN t.hours ELSE 0 END), 0) AS client_work_hours
          FROM users u
          LEFT JOIN timesheet_entries t ON t.user_id = u.id
            AND t.entry_date BETWEEN ? AND ?
            AND t.status = 'approved'
          WHERE u.active = 1
          GROUP BY u.id
          HAVING COALESCE(SUM(t.hours), 0) > 0
          ORDER BY CASE u.role WHEN 'partner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name
        `).all(monthBounds.from, monthBounds.to);
      }

      const collaborationCount = db.prepare(`
        SELECT COUNT(*) as cnt
        FROM timesheet_collaboration_requests
        WHERE target_user_id = ? AND status = 'pending'
      `).get(userId).cnt;

      return {
        today,
        week_from: weekBounds.from,
        week_to: weekBounds.to,
        today_hours: todayHours,
        week_hours: weekHours,
        pending_approvals: pendingApprovals,
        draft_count: draftCount,
        collaboration_requests: collaborationCount,
        week_breakdown: weekBreakdown,
        recent_entries: userEntries.slice(0, 10),
        utilization
      };
    });

    Promise.resolve(payload)
      .then(data => res.json(data))
      .catch(error => res.status(500).json({ error: error.message }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', (req, res) => {
  if (!hasPermission(req.user, 'timesheets.view_own') && !hasPermission(req.user, 'reports.view')) {
    return res.status(403).json({ error: 'Timesheet view access required' });
  }

  const { from, to, user_id, status } = req.query;
  let query = `${entryBaseSelect} WHERE 1=1`;
  const params = [];

  if (!canViewAllTimesheets(req)) {
    query += ' AND t.user_id = ?';
    params.push(req.user.id);
  } else if (user_id) {
    query += ' AND t.user_id = ?';
    params.push(user_id);
  }
  if (from) { query += ' AND t.entry_date >= ?'; params.push(from); }
  if (to) { query += ' AND t.entry_date <= ?'; params.push(to); }
  if (status === 'pending_approval') {
    query += " AND t.status = 'pending_manager'";
  } else if (status) {
    query += ' AND t.status = ?';
    params.push(status);
  }

  query += ' ORDER BY t.entry_date DESC, t.created_at DESC';
  res.json(attachCollaborators(db.prepare(query).all(...params)));
});

router.post('/', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.create_own')) return;

  const { entry_date, client_id, task_type, description, start_time, end_time, hours, billable, work_classification, worked_with_user_ids } = req.body;
  if (!entry_date || !task_type || hours == null) return res.status(400).json({ error: 'Date, task type and hours are required' });
  const timeValidationError = validateTimeWindow(start_time, end_time);
  if (timeValidationError) return res.status(400).json({ error: timeValidationError });
  const futureTimeError = validateNotFutureTime(entry_date, start_time, end_time);
  if (futureTimeError) return res.status(400).json({ error: futureTimeError });
  if (hasOverlap(req.user.id, entry_date, start_time, end_time)) {
    return res.status(400).json({ error: 'This time overlaps another entry for the day' });
  }
  const normalizedClassification = normalizeWorkClassification(work_classification, billable);
  const normalizedHours = start_time && end_time
    ? (timeToMinutes(end_time) - timeToMinutes(start_time)) / 60
    : parseFloat(hours);
  const collaboratorIds = normalizeCollaborators(worked_with_user_ids, req.user.id);
  const result = db.prepare(`
    INSERT INTO timesheet_entries (
      user_id, entry_date, client_id, task_type, description, start_time, end_time, hours, work_classification, billable, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(
    req.user.id,
    entry_date,
    client_id || null,
    task_type,
    description || '',
    start_time || null,
    end_time || null,
    normalizedHours,
    normalizedClassification,
    normalizedClassification === 'client_work' ? 1 : 0
  );
  syncEntryCollaborators(result.lastInsertRowid, collaboratorIds);
  syncCollaborationRequests(result.lastInsertRowid, req.user.id, {
    entry_date,
    client_id,
    task_type,
    description,
    start_time,
    end_time,
    hours: normalizedHours,
    work_classification: normalizedClassification
  }, collaboratorIds);
  invalidateDashboardCache();
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.edit_own')) return;

  const entry = db.prepare('SELECT * FROM timesheet_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  if (entry.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (entry.status === 'approved') return res.status(400).json({ error: 'Cannot edit an approved entry' });

  const { entry_date, client_id, task_type, description, start_time, end_time, hours, billable, work_classification, worked_with_user_ids } = req.body;
  const timeValidationError = validateTimeWindow(start_time, end_time);
  if (timeValidationError) return res.status(400).json({ error: timeValidationError });
  const futureTimeError = validateNotFutureTime(entry_date, start_time, end_time);
  if (futureTimeError) return res.status(400).json({ error: futureTimeError });
  if (hasOverlap(entry.user_id, entry_date, start_time, end_time, req.params.id)) {
    return res.status(400).json({ error: 'This time overlaps another entry for the day' });
  }
  if (entry.requires_time_confirmation) {
    const timeChanged = entry.entry_date !== entry_date
      || (entry.start_time || null) !== (start_time || null)
      || (entry.end_time || null) !== (end_time || null)
      || String(entry.hours) !== String(hours);
    if (!timeChanged) {
      return res.status(400).json({ error: 'This shared entry overlaps existing time. Update the time before saving.' });
    }
  }
  const normalizedClassification = normalizeWorkClassification(work_classification, billable);
  const normalizedHours = start_time && end_time
    ? (timeToMinutes(end_time) - timeToMinutes(start_time)) / 60
    : parseFloat(hours);
  db.prepare(`
    UPDATE timesheet_entries
    SET entry_date=?, client_id=?, task_type=?, description=?, start_time=?, end_time=?, hours=?, work_classification=?, billable=?, requires_time_confirmation=0, updated_at=datetime('now')
    WHERE id=?
  `).run(
    entry_date,
    client_id || null,
    task_type,
    description || '',
    start_time || null,
    end_time || null,
    normalizedHours,
    normalizedClassification,
    normalizedClassification === 'client_work' ? 1 : 0,
    req.params.id
  );

  if (!entry.collaboration_source_entry_id) {
    const collaboratorIds = normalizeCollaborators(worked_with_user_ids, req.user.id);
    syncEntryCollaborators(entry.id, collaboratorIds);
    syncCollaborationRequests(entry.id, req.user.id, {
      entry_date,
      client_id,
      task_type,
      description,
      start_time,
      end_time,
      hours: normalizedHours,
      work_classification: normalizedClassification
    }, collaboratorIds);
  }
  invalidateDashboardCache();
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.delete_own')) return;

  const entry = db.prepare('SELECT * FROM timesheet_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (entry.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (entry.status === 'approved') return res.status(400).json({ error: 'Cannot delete an approved entry' });

  db.prepare(`
    UPDATE timesheet_collaboration_requests
    SET status = 'cancelled', updated_at = datetime('now')
    WHERE source_entry_id = ? AND status = 'pending'
  `).run(req.params.id);
  db.prepare('DELETE FROM timesheet_entry_collaborators WHERE entry_id = ?').run(req.params.id);
  db.prepare('DELETE FROM timesheet_entries WHERE id = ?').run(req.params.id);
  invalidateDashboardCache();
  res.json({ success: true });
});

router.post('/submit', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.submit_own')) return;

  const { entry_ids } = req.body;
  if (!entry_ids || !entry_ids.length) return res.status(400).json({ error: 'No entries specified' });
  const unresolved = db.prepare(`
    SELECT id
    FROM timesheet_entries
    WHERE user_id = ? AND requires_time_confirmation = 1 AND id IN (${entry_ids.map(() => '?').join(',')})
  `).all(req.user.id, ...entry_ids);
  if (unresolved.length) {
    return res.status(400).json({ error: 'Update overlapping shared entries before submitting them' });
  }
  const placeholders = entry_ids.map(() => '?').join(',');
  const nextStatus = nextSubmissionStatus(req.user.role);

  if (nextStatus === 'approved') {
    const approvalColumn = normalizeRole(req.user.role) === 'manager' ? 'approved_by_manager' : 'approved_by_partner';
    db.prepare(`
      UPDATE timesheet_entries
      SET status='approved', ${approvalColumn}=?, updated_at=datetime('now')
      WHERE id IN (${placeholders}) AND user_id=? AND status IN ('draft','rejected')
    `).run(req.user.id, ...entry_ids, req.user.id);
  } else {
    db.prepare(`
      UPDATE timesheet_entries
      SET status=?, rejection_reason=NULL, updated_at=datetime('now')
      WHERE id IN (${placeholders}) AND user_id=? AND status IN ('draft','rejected')
    `).run(nextStatus, ...entry_ids, req.user.id);
  }
  invalidateDashboardCache();
  res.json({ success: true });
});

router.post('/review', (req, res) => {
  const stage = approvalStage(req);
  if (!stage) return res.status(403).json({ error: 'Approval access required' });

  const { entry_ids, action, rejection_reason } = req.body;
  if (!entry_ids || !action) return res.status(400).json({ error: 'entry_ids and action required' });
  const placeholders = entry_ids.map(() => '?').join(',');

  if (action === 'approve') {
    db.prepare(`
      UPDATE timesheet_entries
      SET status='approved', approved_by_manager=?, rejection_reason=NULL, updated_at=datetime('now')
      WHERE id IN (${placeholders}) AND status IN ('pending_manager','pending_partner')
    `).run(req.user.id, ...entry_ids);
  } else {
    db.prepare(`
      UPDATE timesheet_entries
      SET status='rejected', rejection_reason=?, updated_at=datetime('now')
      WHERE id IN (${placeholders}) AND status=?
    `).run(rejection_reason || 'Rejected', ...entry_ids, 'pending_manager');
    db.prepare(`
      UPDATE timesheet_entries
      SET status='rejected', rejection_reason=?, updated_at=datetime('now')
      WHERE id IN (${placeholders}) AND status=?
    `).run(rejection_reason || 'Rejected', ...entry_ids, 'pending_partner');
  }
  invalidateDashboardCache();
  res.json({ success: true });
});

router.get('/stats', (req, res) => {
  if (!requirePermission(req, res, 'dashboard.view_self')) return;

  const today = currentIndiaDateTimeParts().date;
  const { from: weekStartStr } = weekBoundsForDate(today);
  const userId = req.user.id;

  const todayHours = db.prepare('SELECT COALESCE(SUM(hours),0) as h FROM timesheet_entries WHERE entry_date=? AND user_id = ?').get(today, userId);
  const weekHours = db.prepare('SELECT COALESCE(SUM(hours),0) as h FROM timesheet_entries WHERE entry_date>=? AND user_id = ?').get(weekStartStr, userId);

  let pendingCount = 0;
  if (hasPermission(req.user, 'approvals.approve_manager')) {
    pendingCount = db.prepare("SELECT COUNT(*) as cnt FROM timesheet_entries WHERE status IN ('pending_manager','pending_partner')").get().cnt;
  } else {
    pendingCount = db.prepare("SELECT COUNT(*) as cnt FROM timesheet_entries WHERE status IN ('pending_manager','pending_partner') AND user_id=?").get(userId).cnt;
  }

  const draftCount = db.prepare("SELECT COUNT(*) as cnt FROM timesheet_entries WHERE status='draft' AND user_id=?").get(userId).cnt;
  const collaborationCount = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM timesheet_collaboration_requests
    WHERE target_user_id = ? AND status = 'pending'
  `).get(userId).cnt;

  res.json({
    today_hours: todayHours.h,
    week_hours: weekHours.h,
    pending_approvals: pendingCount,
    draft_count: draftCount,
    collaboration_requests: collaborationCount
  });
});

module.exports = router;
