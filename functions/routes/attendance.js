const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();
const { db } = require('../db');
const { getUsersMap, getClientsMap, getLocationMasterItems } = require('../data-cache');

const DEFAULT_SHIFT = { id: '', label: 'General Day Shift', start_time: '10:00', end_time: '18:30' };

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function hasPermission(user, permission) {
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

function canViewReports(user) {
  return hasPermission(user, 'attendance.view_reports') || hasPermission(user, 'staff.view');
}

function canViewOwn(user) {
  return hasPermission(user, 'attendance.view_own') || hasPermission(user, 'attendance.create_own') || canViewReports(user);
}

function canCreateOwn(user) {
  return hasPermission(user, 'attendance.create_own') || canViewReports(user);
}

function canApproveCorrections(user) {
  return canViewReports(user) || hasPermission(user, 'attendance.approve_corrections') || ['manager', 'partner'].includes(normalize(user?.role));
}

function requireAccess(req, res, allowed, permission) {
  if (allowed) return true;
  res.status(403).json({ error: `Permission required: ${permission}` });
  return false;
}

function nowIso() {
  return new Date().toISOString();
}

function currentIndiaDateTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    minutes: (hour * 60) + minute
  };
}

function minutesFromTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function normalizeTime(value) {
  const minutes = minutesFromTime(value);
  if (minutes == null) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function roundCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Number(num.toFixed(6)) : null;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const coords = [lat1, lon1, lat2, lon2].map(Number);
  if (coords.some(value => !Number.isFinite(value))) return null;
  [lat1, lon1, lat2, lon2] = coords;
  const toRad = deg => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeBool(value) {
  return value === true || value === 1 || value === '1';
}

async function getDefaultShift() {
  const snap = await db.collection('timesheet_shifts').get();
  const shifts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return shifts.find(shift => normalizeBool(shift.active) && normalizeBool(shift.default_for_new_clients)) ||
    shifts.find(shift => normalizeBool(shift.active)) ||
    DEFAULT_SHIFT;
}

async function getShiftMap() {
  const snap = await db.collection('timesheet_shifts').get();
  const map = new Map();
  snap.docs.forEach(doc => map.set(String(doc.id), { id: doc.id, ...doc.data() }));
  return map;
}

function normalizeOfficeLocation(item, defaultShift) {
  const label = String(item.location || item.label || item.name || '').trim();
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  if (!label || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    id: `office:${item.id}`,
    raw_id: item.id,
    type: 'office',
    label,
    latitude,
    longitude,
    radius_meters: Math.max(parseInt(item.radius_meters, 10) || 50, 1),
    shift_id: defaultShift.id || '',
    shift_label: defaultShift.label || DEFAULT_SHIFT.label,
    shift_start: normalizeTime(defaultShift.start_time) || DEFAULT_SHIFT.start_time,
    shift_end: normalizeTime(defaultShift.end_time) || DEFAULT_SHIFT.end_time,
    active: item.active !== false && item.active !== 0 && item.active !== '0'
  };
}

function normalizeClientSite(doc, clientsMap, shiftMap, defaultShift) {
  const row = doc.data();
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const client = clientsMap.get(String(row.client_id)) || {};
  const shift = row.shift_id ? shiftMap.get(String(row.shift_id)) : null;
  const start = normalizeTime(row.shift_start) || normalizeTime(shift?.start_time) || normalizeTime(defaultShift.start_time) || DEFAULT_SHIFT.start_time;
  const end = normalizeTime(row.shift_end) || normalizeTime(shift?.end_time) || normalizeTime(defaultShift.end_time) || DEFAULT_SHIFT.end_time;
  return {
    id: `site:${doc.id}`,
    raw_id: doc.id,
    type: 'client_site',
    label: `${client.name || 'Client'} - ${row.site_name || 'Site'}`,
    latitude,
    longitude,
    radius_meters: Math.max(parseInt(row.radius_meters, 10) || 50, 1),
    client_id: row.client_id || '',
    client_name: client.name || '',
    shift_id: row.shift_id || shift?.id || defaultShift.id || '',
    shift_label: shift?.label || defaultShift.label || DEFAULT_SHIFT.label,
    shift_start: start,
    shift_end: end,
    active: row.active !== false && row.active !== 0 && row.active !== '0'
  };
}

async function getAttendanceLocations() {
  const [officeItems, siteSnap, clientsMap, shiftMap, defaultShift] = await Promise.all([
    getLocationMasterItems(),
    db.collection('timesheet_client_sites').get(),
    getClientsMap(),
    getShiftMap(),
    getDefaultShift()
  ]);
  const offices = officeItems.map(item => normalizeOfficeLocation(item, defaultShift)).filter(item => item?.active);
  const sites = siteSnap.docs.map(doc => normalizeClientSite(doc, clientsMap, shiftMap, defaultShift)).filter(item => item?.active);
  return [...offices, ...sites].sort((a, b) => a.label.localeCompare(b.label));
}

async function resolveLocation(locationId) {
  const locations = await getAttendanceLocations();
  return locations.find(item => String(item.id) === String(locationId) || String(item.raw_id) === String(locationId)) || null;
}

function calculatePolicy({ entryTime, exitTime, shiftStart, shiftEnd }) {
  const entry = minutesFromTime(entryTime);
  const exit = minutesFromTime(exitTime);
  const start = minutesFromTime(shiftStart) ?? minutesFromTime(DEFAULT_SHIFT.start_time);
  const end = minutesFromTime(shiftEnd) ?? minutesFromTime(DEFAULT_SHIFT.end_time);
  const hoursWorked = entry != null && exit != null && exit >= entry ? Number(((exit - entry) / 60).toFixed(2)) : 0;
  return {
    entry_minutes: entry,
    exit_minutes: exit,
    entry_diff_minutes: entry == null || start == null ? null : entry - start,
    exit_diff_minutes: exit == null || end == null ? null : exit - end,
    late_mark_entry: entry != null && start != null && entry > start ? 'Yes' : 'No',
    late_mark_exit: exit != null && end != null && exit < end ? 'Yes' : 'No',
    hours_worked: hoursWorked
  };
}

function attendanceStatus(row = {}, todayDate = currentIndiaDateTimeParts().date) {
  if (!row.id) return 'not_checked_in';
  if (row.attendance_date < todayDate && !row.exit_time) return 'missed_checkout';
  if (row.exit_time) return 'checked_out';
  return 'checked_in';
}

function projectAttendanceRow(row, todayDate = currentIndiaDateTimeParts().date) {
  const policy = calculatePolicy({
    entryTime: row.entry_time,
    exitTime: row.exit_time,
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end
  });
  return {
    id: row.id,
    user_id: String(row.user_id || ''),
    person_name: row.person_name || row.display_name || '',
    display_name: row.display_name || row.person_name || '',
    username: row.username || '',
    user_role: row.user_role || '',
    user_active: row.user_active === false || row.user_active === 0 ? 0 : 1,
    attendance_date: row.attendance_date || '',
    entry_time: row.entry_time || '',
    exit_time: row.exit_time || '',
    location: row.location || row.check_in_location || '',
    location_id: row.location_id || '',
    location_type: row.location_type || '',
    check_in_location: row.check_in_location || row.location || '',
    check_out_location: row.check_out_location || '',
    shift_start: row.shift_start || DEFAULT_SHIFT.start_time,
    shift_end: row.shift_end || DEFAULT_SHIFT.end_time,
    hours_worked: Number(row.hours_worked ?? policy.hours_worked) || 0,
    attendance_status: row.attendance_status || attendanceStatus(row, todayDate),
    late_mark_entry: row.late_mark_entry || policy.late_mark_entry,
    late_mark_exit: row.late_mark_exit || (row.exit_time ? policy.late_mark_exit : '-'),
    entry_diff_minutes: row.entry_diff_minutes ?? policy.entry_diff_minutes,
    exit_diff_minutes: row.exit_diff_minutes ?? (row.exit_time ? policy.exit_diff_minutes : null),
    check_in_distance_meters: row.check_in_distance_meters ?? row.distance_meters ?? null,
    check_out_distance_meters: row.check_out_distance_meters ?? null,
    record_source: row.record_source || 'manual',
    approved: row.approved || 'system',
    correction_status: row.correction_status || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

async function loadAttendanceRows({ from = '', to = '', userId = '', canViewAll = false, currentUserId = '' } = {}) {
  const [usersMap, snap] = await Promise.all([getUsersMap(), db.collection('attendance_records').get()]);
  const todayDate = currentIndiaDateTimeParts().date;
  const rows = [];
  snap.docs.forEach(doc => {
    const raw = doc.data() || {};
    if (from && raw.attendance_date < from) return;
    if (to && raw.attendance_date > to) return;
    if (!canViewAll && String(raw.user_id || '') !== String(currentUserId)) return;
    if (userId && String(raw.user_id || '') !== String(userId)) return;
    const user = usersMap.get(String(raw.user_id)) || {};
    rows.push(projectAttendanceRow({
      id: doc.id,
      ...raw,
      display_name: user.name || raw.display_name || raw.person_name,
      username: user.username || raw.username || '',
      user_role: user.role || raw.user_role || '',
      user_active: user.active === false || user.active === 0 ? 0 : 1
    }, todayDate));
  });
  return rows.sort((a, b) =>
    (b.attendance_date || '').localeCompare(a.attendance_date || '') ||
    (a.display_name || '').localeCompare(b.display_name || '') ||
    (b.entry_time || '').localeCompare(a.entry_time || '')
  );
}

function matchRow(row, query, status, locationId) {
  if (status && row.attendance_status !== status && row.late_mark_entry !== status && row.late_mark_exit !== status) return false;
  if (locationId && String(row.location_id) !== String(locationId)) return false;
  if (!query) return true;
  return [
    row.display_name,
    row.username,
    row.user_role,
    row.location,
    row.check_in_location,
    row.check_out_location,
    row.attendance_status,
    row.late_mark_entry,
    row.late_mark_exit
  ].join(' ').toLowerCase().includes(query);
}

async function getTodayRecord(userId, date = currentIndiaDateTimeParts().date) {
  const snap = await db.collection('attendance_records').where('user_id', '==', String(userId)).get();
  const match = snap.docs.find(doc => (doc.data() || {}).attendance_date === date);
  return match ? { id: match.id, ...match.data() } : null;
}

function validateGeo(location, lat, lon) {
  const distance = haversineMeters(lat, lon, location.latitude, location.longitude);
  if (distance == null) return { ok: false, error: 'Unable to verify your location' };
  if (distance > location.radius_meters) {
    return {
      ok: false,
      distance,
      error: `You are ${Math.round(distance)} metres away from ${location.label}. Move within ${location.radius_meters} metres to save attendance.`
    };
  }
  return { ok: true, distance };
}

router.get('/locations', async (req, res) => {
  if (!requireAccess(req, res, canViewOwn(req.user), 'attendance.view_own')) return;
  try {
    res.json({ items: await getAttendanceLocations() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/today', async (req, res) => {
  if (!requireAccess(req, res, canViewOwn(req.user), 'attendance.view_own')) return;
  try {
    const current = currentIndiaDateTimeParts();
    const record = await getTodayRecord(req.user.id, current.date);
    const projected = record ? projectAttendanceRow(record, current.date) : null;
    res.json({
      date: current.date,
      time: current.time,
      record: projected,
      can_check_in: canCreateOwn(req.user) && !record,
      can_check_out: canCreateOwn(req.user) && !!record && !record.exit_time,
      locations: await getAttendanceLocations()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/check-in', async (req, res) => {
  if (!requireAccess(req, res, canCreateOwn(req.user), 'attendance.create_own')) return;
  try {
    const current = currentIndiaDateTimeParts();
    const existing = await getTodayRecord(req.user.id, current.date);
    if (existing) return res.status(400).json({ error: 'Attendance already recorded for today' });

    const location = await resolveLocation(String(req.body?.location_id || '').trim());
    if (!location) return res.status(400).json({ error: 'Selected location is not available' });
    const latitude = roundCoordinate(req.body?.user_latitude);
    const longitude = roundCoordinate(req.body?.user_longitude);
    if (latitude == null || longitude == null) return res.status(400).json({ error: 'Current location is required' });
    const geo = validateGeo(location, latitude, longitude);
    if (!geo.ok) return res.status(400).json({ error: geo.error });

    const policy = calculatePolicy({ entryTime: current.time, shiftStart: location.shift_start, shiftEnd: location.shift_end });
    const payload = {
      user_id: String(req.user.id),
      person_name: req.user.name || req.user.username || 'Unknown',
      display_name: req.user.name || req.user.username || 'Unknown',
      username: req.user.username || '',
      user_role: normalize(req.user.role) || 'article',
      user_active: 1,
      attendance_date: current.date,
      entry_time: current.time,
      exit_time: '',
      location: location.label,
      location_id: location.id,
      location_type: location.type,
      check_in_location: location.label,
      check_out_location: '',
      shift_start: location.shift_start,
      shift_end: location.shift_end,
      check_in_latitude: latitude,
      check_in_longitude: longitude,
      check_in_distance_meters: Number(geo.distance.toFixed(2)),
      check_out_latitude: null,
      check_out_longitude: null,
      check_out_distance_meters: null,
      hours_worked: 0,
      attendance_status: 'checked_in',
      late_mark_entry: policy.late_mark_entry,
      late_mark_exit: '-',
      entry_diff_minutes: policy.entry_diff_minutes,
      exit_diff_minutes: null,
      record_source: 'manual',
      approved: 'system',
      created_at: nowIso(),
      updated_at: nowIso()
    };
    const docRef = await db.collection('attendance_records').add(payload);
    res.json({ success: true, record: projectAttendanceRow({ id: docRef.id, ...payload }, current.date) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/check-out', async (req, res) => {
  if (!requireAccess(req, res, canCreateOwn(req.user), 'attendance.create_own')) return;
  try {
    const current = currentIndiaDateTimeParts();
    const record = await getTodayRecord(req.user.id, current.date);
    if (!record) return res.status(400).json({ error: 'Check in before checking out' });
    if (record.exit_time) return res.status(400).json({ error: 'Attendance is already checked out for today' });

    const location = await resolveLocation(String(req.body?.location_id || record.location_id || '').trim());
    if (!location) return res.status(400).json({ error: 'Selected location is not available' });
    const latitude = roundCoordinate(req.body?.user_latitude);
    const longitude = roundCoordinate(req.body?.user_longitude);
    if (latitude == null || longitude == null) return res.status(400).json({ error: 'Current location is required' });
    const geo = validateGeo(location, latitude, longitude);
    if (!geo.ok) return res.status(400).json({ error: geo.error });

    const policy = calculatePolicy({
      entryTime: record.entry_time,
      exitTime: current.time,
      shiftStart: record.shift_start || location.shift_start,
      shiftEnd: record.shift_end || location.shift_end
    });
    const patch = {
      exit_time: current.time,
      check_out_location: location.label,
      check_out_location_id: location.id,
      check_out_latitude: latitude,
      check_out_longitude: longitude,
      check_out_distance_meters: Number(geo.distance.toFixed(2)),
      hours_worked: policy.hours_worked,
      attendance_status: 'checked_out',
      late_mark_exit: policy.late_mark_exit,
      exit_diff_minutes: policy.exit_diff_minutes,
      updated_at: nowIso()
    };
    await db.collection('attendance_records').doc(record.id).update(patch);
    res.json({ success: true, record: projectAttendanceRow({ ...record, ...patch }, current.date) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/live', async (req, res) => {
  if (!requireAccess(req, res, canViewReports(req.user), 'attendance.view_reports')) return;
  try {
    const current = currentIndiaDateTimeParts();
    const [usersMap, rows] = await Promise.all([
      getUsersMap(),
      loadAttendanceRows({ from: current.date, to: current.date, canViewAll: true })
    ]);
    const byUser = new Map(rows.map(row => [String(row.user_id), row]));
    const items = [];
    usersMap.forEach((user, id) => {
      if (user.active === false || user.active === 0) return;
      const record = byUser.get(String(id));
      items.push(record || {
        id: '',
        user_id: String(id),
        display_name: user.name || user.username || 'User',
        username: user.username || '',
        user_role: user.role || '',
        attendance_date: current.date,
        entry_time: '',
        exit_time: '',
        location: '',
        attendance_status: 'not_checked_in',
        late_mark_entry: '-',
        late_mark_exit: '-',
        hours_worked: 0
      });
    });
    const summary = {
      total_staff: items.length,
      checked_in: items.filter(item => item.attendance_status === 'checked_in').length,
      checked_out: items.filter(item => item.attendance_status === 'checked_out').length,
      not_checked_in: items.filter(item => item.attendance_status === 'not_checked_in').length,
      late: items.filter(item => item.late_mark_entry === 'Yes').length,
      missed_checkout: items.filter(item => item.attendance_status === 'missed_checkout').length
    };
    res.json({ date: current.date, items: items.sort((a, b) => a.display_name.localeCompare(b.display_name)), summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/corrections', async (req, res) => {
  if (!requireAccess(req, res, canViewOwn(req.user), 'attendance.view_own')) return;
  try {
    const recordId = String(req.body?.record_id || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!recordId || !reason) return res.status(400).json({ error: 'Attendance record and reason are required' });
    const recordDoc = await db.collection('attendance_records').doc(recordId).get();
    if (!recordDoc.exists) return res.status(404).json({ error: 'Attendance record not found' });
    const record = recordDoc.data();
    if (!canViewReports(req.user) && String(record.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Access denied' });

    const payload = {
      record_id: recordId,
      user_id: String(record.user_id),
      requested_by_user_id: String(req.user.id),
      requested_by_name: req.user.name || req.user.username || '',
      reason,
      requested_entry_time: normalizeTime(req.body?.requested_entry_time),
      requested_exit_time: normalizeTime(req.body?.requested_exit_time),
      requested_location_note: String(req.body?.requested_location_note || '').trim(),
      status: 'pending',
      created_at: nowIso(),
      updated_at: nowIso()
    };
    const docRef = await db.collection('attendance_corrections').add(payload);
    await recordDoc.ref.update({ correction_status: 'pending', updated_at: nowIso() });
    res.json({ success: true, correction: { id: docRef.id, ...payload } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function resolveCorrection(req, res, status) {
  if (!requireAccess(req, res, canApproveCorrections(req.user), 'attendance.approve_corrections')) return;
  try {
    const correctionDoc = await db.collection('attendance_corrections').doc(req.params.id).get();
    if (!correctionDoc.exists) return res.status(404).json({ error: 'Correction request not found' });
    const correction = correctionDoc.data();
    if (correction.status !== 'pending') return res.status(400).json({ error: 'Correction request is already resolved' });
    const recordRef = db.collection('attendance_records').doc(correction.record_id);
    const recordDoc = await recordRef.get();
    if (!recordDoc.exists) return res.status(404).json({ error: 'Attendance record not found' });

    const resolution = {
      status,
      resolved_by_user_id: String(req.user.id),
      resolved_by_name: req.user.name || req.user.username || '',
      resolution_note: String(req.body?.note || '').trim(),
      resolved_at: nowIso(),
      updated_at: nowIso()
    };
    await correctionDoc.ref.update(resolution);
    if (status === 'approved') {
      const record = recordDoc.data();
      const patch = {
        correction_status: 'approved',
        corrected_by_user_id: String(req.user.id),
        corrected_by_name: req.user.name || req.user.username || '',
        corrected_at: nowIso(),
        updated_at: nowIso()
      };
      if (correction.requested_entry_time) patch.entry_time = correction.requested_entry_time;
      if (correction.requested_exit_time) patch.exit_time = correction.requested_exit_time;
      const policy = calculatePolicy({
        entryTime: patch.entry_time || record.entry_time,
        exitTime: patch.exit_time || record.exit_time,
        shiftStart: record.shift_start,
        shiftEnd: record.shift_end
      });
      patch.hours_worked = policy.hours_worked;
      patch.late_mark_entry = policy.late_mark_entry;
      patch.late_mark_exit = patch.exit_time || record.exit_time ? policy.late_mark_exit : '-';
      patch.entry_diff_minutes = policy.entry_diff_minutes;
      patch.exit_diff_minutes = patch.exit_time || record.exit_time ? policy.exit_diff_minutes : null;
      patch.attendance_status = patch.exit_time || record.exit_time ? 'checked_out' : 'checked_in';
      await recordRef.update(patch);
    } else {
      await recordRef.update({ correction_status: 'rejected', updated_at: nowIso() });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

router.post('/corrections/:id/approve', (req, res) => resolveCorrection(req, res, 'approved'));
router.post('/corrections/:id/reject', (req, res) => resolveCorrection(req, res, 'rejected'));

router.get('/corrections', async (req, res) => {
  if (!requireAccess(req, res, canViewOwn(req.user), 'attendance.view_own')) return;
  try {
    const canAll = canViewReports(req.user);
    const snap = await db.collection('attendance_corrections').get();
    const items = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => canAll || String(item.user_id) === String(req.user.id) || String(item.requested_by_user_id) === String(req.user.id))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/export', async (req, res) => {
  if (!requireAccess(req, res, canViewReports(req.user), 'attendance.view_reports')) return;
  try {
    const rows = await loadAttendanceRows({
      from: String(req.query.from || '').trim(),
      to: String(req.query.to || '').trim(),
      userId: String(req.query.user_id || '').trim(),
      canViewAll: true
    });
    const data = rows.map(row => ({
      Date: row.attendance_date,
      Name: row.display_name,
      Username: row.username,
      Entry: row.entry_time,
      Exit: row.exit_time,
      Hours: row.hours_worked,
      Location: row.location,
      Status: row.attendance_status,
      Late: row.late_mark_entry,
      EarlyExit: row.late_mark_exit,
      ShiftStart: row.shift_start,
      ShiftEnd: row.shift_end
    }));
    if (String(req.query.format || '').toLowerCase() === 'xlsx') {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Attendance');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="attendance-report.xlsx"');
      return res.send(buffer);
    }
    const sheet = XLSX.utils.json_to_sheet(data);
    const csv = XLSX.utils.sheet_to_csv(sheet);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance-report.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  if (!requireAccess(req, res, canViewOwn(req.user), 'attendance.view_own')) return;
  try {
    const query = normalize(req.query.q);
    const status = String(req.query.status || '').trim();
    const locationId = String(req.query.location_id || '').trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 50, 1), 200);
    const canAll = canViewReports(req.user);
    const rows = await loadAttendanceRows({
      from: String(req.query.from || '').trim(),
      to: String(req.query.to || '').trim(),
      userId: String(req.query.user_id || '').trim(),
      canViewAll: canAll,
      currentUserId: req.user.id
    });
    const filtered = rows.filter(row => matchRow(row, query, status, locationId));
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);
    const summary = {
      total_records: filtered.length,
      present_days: filtered.filter(row => row.entry_time).length,
      checked_in: filtered.filter(row => row.attendance_status === 'checked_in').length,
      checked_out: filtered.filter(row => row.attendance_status === 'checked_out').length,
      missed_checkout: filtered.filter(row => row.attendance_status === 'missed_checkout').length,
      late_entries: filtered.filter(row => row.late_mark_entry === 'Yes').length,
      early_exits: filtered.filter(row => row.late_mark_exit === 'Yes').length,
      total_hours: Number(filtered.reduce((sum, row) => sum + (Number(row.hours_worked) || 0), 0).toFixed(2))
    };
    res.json({
      items,
      total: filtered.length,
      page,
      page_size: pageSize,
      has_more: start + items.length < filtered.length,
      summary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  req.url = '/check-in';
  router.handle(req, res);
});

module.exports = router;
