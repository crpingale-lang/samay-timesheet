const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getUsersMap, getClientsMap, remember, invalidateCacheByPrefix } = require('../data-cache');

const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function invalidateDashboardCache() {
  invalidateCacheByPrefix('dashboard:');
}

function hasPermission(req, permission) {
  return Array.isArray(req.user?.permissions) && req.user.permissions.includes(permission);
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
    .map(id => String(id || '').trim())
    .filter(id => id)
    .filter(id => id !== String(currentUserId))
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

function monthStartForDate(value) {
  const parts = parseIsoDateParts(value);
  if (!parts) return value;
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-01`;
}

function roleSortWeight(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'partner') return 1;
  if (normalized === 'manager') return 2;
  return 3;
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

function hasOverlap(startTime, endTime, existingEntries, excludedId = null) {
  if (!startTime || !endTime) return false;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return existingEntries.some(entry => {
    if (excludedId && entry.id === excludedId) return false;
    if (!entry.start_time || !entry.end_time) return false;
    const entryStart = timeToMinutes(entry.start_time);
    const entryEnd = timeToMinutes(entry.end_time);
    if (entryStart == null || entryEnd == null) return false;
    return start < entryEnd && entryStart < end;
  });
}

async function getActiveCollaboratorIds(ids) {
  if (!ids.length) return [];
  const users = await Promise.all(ids.map(id => db.collection('users').doc(id).get()));
  return users
    .filter(doc => {
      if (!doc.exists) return false;
      const active = doc.data().active;
      return active !== false && active !== 0 && active !== '0';
    })
    .map(doc => doc.id);
}

async function hydrateTimesheets(docs) {
  const [userCache, clientRows] = await Promise.all([getUsersMap(), getClientsMap()]);
  const clientCache = new Map();
  clientRows.forEach((data, id) => {
    clientCache.set(id, data.name);
  });
  const results = [];

  for (const doc of docs) {
    const t = doc.data();
    const workedWithIds = Array.isArray(t.worked_with_user_ids) ? t.worked_with_user_ids : [];
    const workedWith = workedWithIds.map(userId => ({
      id: userId,
      name: (userCache.get(userId) || { name: 'Unknown' }).name
    }));

    results.push({
      id: doc.id,
      ...t,
      worked_with_user_ids: workedWithIds,
      worked_with: workedWith,
      work_classification: normalizeWorkClassification(t.work_classification, t.billable),
      staff_name: (userCache.get(t.user_id) || { name: 'Unknown' }).name,
      staff_role: (userCache.get(t.user_id) || { role: 'article' }).role,
      client_name: t.client_id ? clientCache.get(t.client_id) : null
    });
  }

  return results.sort((a, b) => {
    const dateCmp = String(b.entry_date || '').localeCompare(String(a.entry_date || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

async function buildUtilizationSummary(from, to) {
  const [usersMap, timesheetSnap] = await Promise.all([
    getUsersMap(),
    db.collection('timesheets')
      .where('entry_date', '>=', from)
      .where('entry_date', '<=', to)
      .get()
  ]);

  const rowsByUser = new Map();
  usersMap.forEach((user, id) => {
    const active = user.active;
    if (active === false || active === 0 || active === '0') return;
    rowsByUser.set(id, {
      id,
      name: user.name || 'Unknown',
      designation: user.designation || '',
      role: normalizeRole(user.role),
      total_hours: 0,
      billable_hours: 0,
      non_billable_hours: 0,
      client_work_hours: 0,
      non_client_hours: 0
    });
  });

  timesheetSnap.forEach(doc => {
    const entry = doc.data();
    if (entry.status !== 'approved') return;
    const existing = rowsByUser.get(entry.user_id) || {
      id: entry.user_id,
      name: 'Unknown',
      designation: '',
      role: 'article',
      total_hours: 0,
      billable_hours: 0,
      non_billable_hours: 0,
      client_work_hours: 0,
      non_client_hours: 0
    };
    const sourceUser = usersMap.get(entry.user_id);
    const sourceActive = sourceUser?.active;
    if (sourceActive === false || sourceActive === 0 || sourceActive === '0') return;
    const hours = parseFloat(entry.hours) || 0;
    const workClassification = normalizeWorkClassification(entry.work_classification, entry.billable);
    existing.total_hours += hours;
    if (workClassification === 'client_work') {
      existing.billable_hours += hours;
      existing.client_work_hours += hours;
    } else {
      existing.non_billable_hours += hours;
      existing.non_client_hours += hours;
    }
    rowsByUser.set(entry.user_id, existing);
  });

  return [...rowsByUser.values()].sort((a, b) => {
    const roleDiff = roleSortWeight(a.role) - roleSortWeight(b.role);
    if (roleDiff !== 0) return roleDiff;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

async function syncCollaborationRequests(sourceEntryId, sourceUserId, payload, collaboratorIds) {
  const activeIds = await getActiveCollaboratorIds(collaboratorIds);
  const activeSet = new Set(activeIds);
  const snapshot = await db.collection('timesheet_collaboration_requests').where('source_entry_id', '==', sourceEntryId).get();
  const existingByTarget = new Map();
  snapshot.forEach(doc => {
    existingByTarget.set(doc.data().target_user_id, { id: doc.id, ...doc.data() });
  });

  const batch = db.batch();
  for (const userId of collaboratorIds) {
    if (!activeSet.has(userId)) continue;
    const existing = existingByTarget.get(userId);
    const nextPayload = {
      source_entry_id: sourceEntryId,
      source_user_id: sourceUserId,
      target_user_id: userId,
      entry_date: payload.entry_date,
      client_id: payload.client_id || null,
      task_type: payload.task_type,
      description: payload.description || '',
      start_time: payload.start_time || null,
      end_time: payload.end_time || null,
      hours: payload.hours,
      work_classification: payload.work_classification,
      updated_at: new Date().toISOString()
    };

    if (existing) {
      if (existing.status === 'pending') {
        batch.update(db.collection('timesheet_collaboration_requests').doc(existing.id), nextPayload);
      }
      continue;
    }

    batch.set(db.collection('timesheet_collaboration_requests').doc(), {
      ...nextPayload,
      status: 'pending',
      created_at: new Date().toISOString()
    });
  }

  for (const [targetUserId, existing] of existingByTarget.entries()) {
    if (!collaboratorIds.includes(targetUserId) && existing.status === 'pending') {
      batch.update(db.collection('timesheet_collaboration_requests').doc(existing.id), {
        status: 'cancelled',
        updated_at: new Date().toISOString()
      });
    }
  }

  await batch.commit();
}

router.get('/collaborators', async (req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const users = [];
    snapshot.forEach(doc => {
      if (doc.id === req.user.id) return;
      const user = doc.data();
      const active = user.active;
      if (active === false || active === 0 || active === '0') return;
      users.push({ id: doc.id, name: user.name, role: user.role, designation: user.designation || '' });
    });
    users.sort((a, b) => a.name.localeCompare(b.name));
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/collaboration-requests', async (req, res) => {
  try {
    const snapshot = await db.collection('timesheet_collaboration_requests')
      .where('target_user_id', '==', req.user.id)
      .where('status', '==', 'pending')
      .get();

    const sourceCache = new Map();
    const clientCache = new Map();
    const rows = [];

    for (const doc of snapshot.docs) {
      const request = doc.data();
      if (!sourceCache.has(request.source_user_id)) {
        const sourceDoc = await db.collection('users').doc(request.source_user_id).get();
        sourceCache.set(request.source_user_id, sourceDoc.exists ? sourceDoc.data() : { name: 'Unknown', role: 'article' });
      }
      if (request.client_id && !clientCache.has(request.client_id)) {
        const clientDoc = await db.collection('clients').doc(request.client_id).get();
        clientCache.set(request.client_id, clientDoc.exists ? clientDoc.data().name : 'Unknown');
      }
      rows.push({
        id: doc.id,
        ...request,
        source_user_name: sourceCache.get(request.source_user_id).name,
        source_user_role: sourceCache.get(request.source_user_id).role,
        client_name: request.client_id ? clientCache.get(request.client_id) : null
      });
    }

    rows.sort((a, b) => String(b.entry_date || '').localeCompare(String(a.entry_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/collaboration-requests/:id/accept', async (req, res) => {
  try {
    const requestRef = db.collection('timesheet_collaboration_requests').doc(req.params.id);
    const requestDoc = await requestRef.get();
    if (!requestDoc.exists) return res.status(404).json({ error: 'Collaboration request not found' });

    const request = requestDoc.data();
    if (request.target_user_id !== req.user.id || request.status !== 'pending') {
      return res.status(404).json({ error: 'Collaboration request not found' });
    }

    const sameDaySnap = await db.collection('timesheets')
      .where('user_id', '==', req.user.id)
      .where('entry_date', '==', request.entry_date)
      .get();
    const existingEntries = sameDaySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const overlaps = hasOverlap(request.start_time, request.end_time, existingEntries);

    const entryPayload = {
      user_id: req.user.id,
      entry_date: request.entry_date,
      client_id: request.client_id || null,
      task_type: request.task_type,
      description: request.description || '',
      start_time: request.start_time || null,
      end_time: request.end_time || null,
      hours: request.hours,
      work_classification: request.work_classification,
      billable: request.work_classification === 'client_work' ? 1 : 0,
      status: 'draft',
      collaboration_source_entry_id: request.source_entry_id,
      collaboration_request_id: requestDoc.id,
      requires_time_confirmation: overlaps,
      worked_with_user_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const entryRef = await db.collection('timesheets').add(entryPayload);
    await requestRef.update({
      status: 'accepted',
      accepted_entry_id: entryRef.id,
      updated_at: new Date().toISOString()
    });

    const entryDoc = await entryRef.get();
    const [entry] = await hydrateTimesheets([entryDoc]);
    res.json({
      success: true,
      overlap_warning: overlaps ? 'Time overlaps existing entries. Update the time before saving or submitting this entry.' : null,
      entry
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/collaboration-requests/:id/reject', async (req, res) => {
  try {
    const requestRef = db.collection('timesheet_collaboration_requests').doc(req.params.id);
    const requestDoc = await requestRef.get();
    if (!requestDoc.exists) return res.status(404).json({ error: 'Collaboration request not found' });
    const request = requestDoc.data();
    if (request.target_user_id !== req.user.id || request.status !== 'pending') {
      return res.status(404).json({ error: 'Collaboration request not found' });
    }
    await requestRef.update({ status: 'rejected', updated_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/dashboard-summary', async (req, res) => {
  if (!hasPermission(req, 'dashboard.view_self')) {
    return res.status(403).json({ error: 'Dashboard access required' });
  }

  try {
    const current = currentIndiaDateTimeParts();
    const today = current.date;
    const cacheKey = `dashboard:${req.user.id}:${today}`;
    const payload = await remember(cacheKey, DASHBOARD_CACHE_TTL_MS, async () => {
      const weekBounds = weekBoundsForDate(today);
      const monthStart = monthStartForDate(today);
      const userId = req.user.id;
      const pendingStatuses = new Set(['pending_manager', 'pending_partner']);

      const userEntriesSnap = await db.collection('timesheets').where('user_id', '==', userId).get();
      const userDocs = userEntriesSnap.docs;
      const userEntries = userDocs.map(doc => ({ id: doc.id, ...doc.data() }));

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

      const recentEntries = (await hydrateTimesheets(userDocs)).slice(0, 10);

      const collaborationSnap = await db.collection('timesheet_collaboration_requests')
        .where('target_user_id', '==', userId)
        .where('status', '==', 'pending')
        .get();

      let pendingApprovals = userEntries.filter(entry => pendingStatuses.has(entry.status)).length;
      if (hasPermission(req, 'approvals.approve_manager')) {
        const [pendingManagerSnap, pendingPartnerSnap] = await Promise.all([
          db.collection('timesheets').where('status', '==', 'pending_manager').get(),
          db.collection('timesheets').where('status', '==', 'pending_partner').get()
        ]);
        pendingApprovals = pendingManagerSnap.size + pendingPartnerSnap.size;
      }

      let utilization = [];
      if (hasPermission(req, 'dashboard.view_team') || hasPermission(req, 'dashboard.view_firm')) {
        utilization = await buildUtilizationSummary(monthStart, today);
      }

      return {
        today,
        week_from: weekBounds.from,
        week_to: weekBounds.to,
        today_hours: todayHours,
        week_hours: weekHours,
        pending_approvals: pendingApprovals,
        draft_count: draftCount,
        collaboration_requests: collaborationSnap.size,
        week_breakdown: weekBreakdown,
        recent_entries: recentEntries,
        utilization
      };
    });

    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/', async (req, res) => {
  const { from, to, status, user_id } = req.query;
  try {
    const normalizedRole = normalizeRole(req.user.role);
    const scopedUserId = normalizedRole === 'article' ? req.user.id : (user_id || null);
    const scopedStatus = status || null;
    const pendingStatuses = new Set(['pending_manager', 'pending_partner']);
    let docs = [];

    if (scopedStatus === 'pending_approval' && !scopedUserId) {
      const [pendingManagerSnap, pendingPartnerSnap] = await Promise.all([
        db.collection('timesheets').where('status', '==', 'pending_manager').get(),
        db.collection('timesheets').where('status', '==', 'pending_partner').get()
      ]);
      docs = [...pendingManagerSnap.docs, ...pendingPartnerSnap.docs];
    } else {
      let query = db.collection('timesheets');
      if (scopedUserId) query = query.where('user_id', '==', scopedUserId);
      else if (scopedStatus) query = query.where('status', '==', scopedStatus);
      const snapshot = await query.get();
      docs = snapshot.docs;
    }

    let rows = await hydrateTimesheets(docs);

    if (scopedUserId) rows = rows.filter(row => row.user_id === scopedUserId);
    if (scopedStatus === 'pending_approval') rows = rows.filter(row => pendingStatuses.has(row.status));
    else if (scopedStatus) rows = rows.filter(row => row.status === scopedStatus);
    if (from) rows = rows.filter(row => row.entry_date >= from);
    if (to) rows = rows.filter(row => row.entry_date <= to);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { entry_date, client_id, task_type, description, hours, billable, work_classification, start_time, end_time, worked_with_user_ids } = req.body;
  if (!entry_date || !task_type || !hours) return res.status(400).json({ error: 'Missing fields' });
  try {
    const timeValidationError = validateTimeWindow(start_time, end_time);
    if (timeValidationError) return res.status(400).json({ error: timeValidationError });
    const futureTimeError = validateNotFutureTime(entry_date, start_time, end_time);
    if (futureTimeError) return res.status(400).json({ error: futureTimeError });

    if (start_time && end_time) {
      const sameDaySnap = await db.collection('timesheets')
        .where('user_id', '==', req.user.id)
        .where('entry_date', '==', entry_date)
        .get();
      const existingEntries = sameDaySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (hasOverlap(start_time, end_time, existingEntries)) {
        return res.status(400).json({ error: 'This time overlaps another entry for the day' });
      }
    }

    const normalizedClassification = normalizeWorkClassification(work_classification, billable);
    const normalizedHours = start_time && end_time
      ? (timeToMinutes(end_time) - timeToMinutes(start_time)) / 60
      : parseFloat(hours);
    const collaboratorIds = normalizeCollaborators(worked_with_user_ids, req.user.id);
    const docRef = await db.collection('timesheets').add({
      user_id: req.user.id,
      entry_date,
      client_id: client_id || null,
      task_type,
      description: description || '',
      hours: normalizedHours,
      start_time: start_time || null,
      end_time: end_time || null,
      work_classification: normalizedClassification,
      billable: normalizedClassification === 'client_work' ? 1 : 0,
      worked_with_user_ids: collaboratorIds,
      requires_time_confirmation: false,
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await syncCollaborationRequests(docRef.id, req.user.id, {
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
    res.json({ id: docRef.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  const { entry_date, client_id, task_type, description, hours, billable, work_classification, start_time, end_time, worked_with_user_ids } = req.body;
  try {
    const ref = db.collection('timesheets').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    const existing = doc.data();
    if (existing.user_id !== req.user.id && normalizeRole(req.user.role) !== 'partner') return res.status(403).json({ error: 'Access denied' });
    if (existing.status === 'approved') return res.status(400).json({ error: 'Cannot edit an approved entry' });

    const timeValidationError = validateTimeWindow(start_time, end_time);
    if (timeValidationError) return res.status(400).json({ error: timeValidationError });
    const futureTimeError = validateNotFutureTime(entry_date, start_time, end_time);
    if (futureTimeError) return res.status(400).json({ error: futureTimeError });

    if (start_time && end_time) {
      const sameDaySnap = await db.collection('timesheets')
        .where('user_id', '==', existing.user_id)
        .where('entry_date', '==', entry_date)
        .get();
      const existingEntries = sameDaySnap.docs.map(item => ({ id: item.id, ...item.data() }));
      if (hasOverlap(start_time, end_time, existingEntries, req.params.id)) {
        return res.status(400).json({ error: 'This time overlaps another entry for the day' });
      }
    }

    if (existing.requires_time_confirmation) {
      const timeChanged = existing.entry_date !== entry_date
        || (existing.start_time || null) !== (start_time || null)
        || (existing.end_time || null) !== (end_time || null)
        || String(existing.hours) !== String(hours);
      if (!timeChanged) {
        return res.status(400).json({ error: 'This shared entry overlaps existing time. Update the time before saving.' });
      }
    }

    const normalizedClassification = normalizeWorkClassification(work_classification, billable);
    const normalizedHours = start_time && end_time
      ? (timeToMinutes(end_time) - timeToMinutes(start_time)) / 60
      : parseFloat(hours);
    const updates = {
      entry_date,
      client_id: client_id || null,
      task_type,
      description: description || '',
      hours: normalizedHours,
      start_time: start_time || null,
      end_time: end_time || null,
      work_classification: normalizedClassification,
      billable: normalizedClassification === 'client_work' ? 1 : 0,
      requires_time_confirmation: false,
      updated_at: new Date().toISOString()
    };

    if (!existing.collaboration_source_entry_id) {
      const collaboratorIds = normalizeCollaborators(worked_with_user_ids, req.user.id);
      updates.worked_with_user_ids = collaboratorIds;
      await syncCollaborationRequests(req.params.id, req.user.id, {
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

    await ref.update(updates);
    invalidateDashboardCache();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const ref = db.collection('timesheets').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    const existing = doc.data();
    if (existing.user_id !== req.user.id && normalizeRole(req.user.role) !== 'partner') return res.status(403).json({ error: 'Access denied' });
    if (existing.status === 'approved') return res.status(400).json({ error: 'Cannot delete an approved timesheet' });

    const pendingRequests = await db.collection('timesheet_collaboration_requests').where('source_entry_id', '==', req.params.id).where('status', '==', 'pending').get();
    const batch = db.batch();
    pendingRequests.forEach(item => {
      batch.update(item.ref, { status: 'cancelled', updated_at: new Date().toISOString() });
    });
    batch.delete(ref);
    await batch.commit();
    invalidateDashboardCache();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/submit', async (req, res) => {
  const { entry_ids } = req.body;
  if (!Array.isArray(entry_ids) || !entry_ids.length) return res.status(400).json({ error: 'No entries provided' });

  try {
    const docs = await Promise.all(entry_ids.map(id => db.collection('timesheets').doc(id).get()));
    const invalid = docs.find(doc => !doc.exists || doc.data().user_id !== req.user.id || doc.data().requires_time_confirmation || !['draft', 'rejected'].includes(doc.data().status));
    if (invalid?.exists && invalid.data().requires_time_confirmation) {
      return res.status(400).json({ error: 'Update overlapping shared entries before submitting them' });
    }

    const targetStatus = nextSubmissionStatus(req.user.role);
    const batch = db.batch();
    for (const doc of docs) {
      if (!doc.exists) continue;
      const entry = doc.data();
      if (entry.user_id !== req.user.id || !['draft', 'rejected'].includes(entry.status)) continue;
      const updates = {
        status: targetStatus,
        rejection_reason: null,
        updated_at: new Date().toISOString()
      };
      if (targetStatus === 'approved') {
        if (normalizeRole(req.user.role) === 'manager') updates.approved_by_manager = req.user.id;
        else updates.approved_by_partner = req.user.id;
      }
      batch.update(doc.ref, updates);
    }
    await batch.commit();
    invalidateDashboardCache();
    res.json({ success: true, newStatus: targetStatus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/review', async (req, res) => {
  const canApproveManagerQueue = hasPermission(req, 'approvals.approve_manager');
  if (!canApproveManagerQueue) return res.status(403).json({ error: 'Access denied' });
  const { entry_ids, action, rejection_reason } = req.body;
  if (!Array.isArray(entry_ids) || !entry_ids.length) return res.status(400).json({ error: 'No entries provided' });

  try {
    const batch = db.batch();
    for (const id of entry_ids) {
      const ref = db.collection('timesheets').doc(id);
      const doc = await ref.get();
      if (!doc.exists) continue;
      const entry = doc.data();
      if (action === 'approve') {
        if (!['pending_manager', 'pending_partner'].includes(entry.status)) continue;
        const updates = {
          status: 'approved',
          approved_by_manager: req.user.id,
          rejection_reason: null,
          updated_at: new Date().toISOString()
        };
        batch.update(ref, updates);
      } else if (action === 'reject') {
        if (!['pending_manager', 'pending_partner'].includes(entry.status)) continue;
        batch.update(ref, { status: 'rejected', rejection_reason: rejection_reason || 'Rejected without reason', updated_at: new Date().toISOString() });
      }
    }
    await batch.commit();
    invalidateDashboardCache();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/stats', async (req, res) => {
  if (!hasPermission(req, 'dashboard.view_self')) {
    return res.status(403).json({ error: 'Dashboard access required' });
  }

  try {
    const today = currentIndiaDateTimeParts().date;
    const parts = today.split('-').map(Number);
    const weekStart = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    const weekday = weekStart.getUTCDay();
    const diff = weekday === 0 ? -6 : 1 - weekday;
    weekStart.setUTCDate(weekStart.getUTCDate() + diff);
    const weekStartStr = formatIsoDate(weekStart);
    const userId = req.user.id;

    const userEntriesSnap = await db.collection('timesheets').where('user_id', '==', userId).get();
    const userEntries = userEntriesSnap.docs.map(doc => doc.data());

    const todayHours = userEntries
      .filter(entry => entry.entry_date === today)
      .reduce((sum, entry) => sum + (parseFloat(entry.hours) || 0), 0);

    const weekHours = userEntries
      .filter(entry => String(entry.entry_date || '') >= weekStartStr)
      .reduce((sum, entry) => sum + (parseFloat(entry.hours) || 0), 0);

    const draftCount = userEntries.filter(entry => entry.status === 'draft').length;

    let pendingQuery = db.collection('timesheets');
    if (hasPermission(req, 'approvals.approve_manager')) {
      const pendingManagerSnap = await db.collection('timesheets').where('status', '==', 'pending_manager').get();
      const pendingPartnerSnap = await db.collection('timesheets').where('status', '==', 'pending_partner').get();
      const pendingCount = pendingManagerSnap.size + pendingPartnerSnap.size;
      const collaborationSnap = await db.collection('timesheet_collaboration_requests')
        .where('target_user_id', '==', userId)
        .where('status', '==', 'pending')
        .get();

      return res.json({
        today_hours: todayHours,
        week_hours: weekHours,
        pending_approvals: pendingCount,
        draft_count: draftCount,
        collaboration_requests: collaborationSnap.size
      });
    } else {
      pendingQuery = pendingQuery.where('user_id', '==', userId);
    }

    const pendingSnap = await pendingQuery.get();
    const pendingCount = hasPermission(req, 'approvals.approve_manager')
      ? pendingSnap.size
      : pendingSnap.docs.filter(doc => ['pending_manager', 'pending_partner'].includes(doc.data().status)).length;

    const collaborationSnap = await db.collection('timesheet_collaboration_requests')
      .where('target_user_id', '==', userId)
      .where('status', '==', 'pending')
      .get();

    res.json({
      today_hours: todayHours,
      week_hours: weekHours,
      pending_approvals: pendingCount,
      draft_count: draftCount,
      collaboration_requests: collaborationSnap.size
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
