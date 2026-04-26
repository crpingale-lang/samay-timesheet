const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();
const db = require('../js/database');
const { hasPermission } = require('../js/permissions');

const DEFAULT_SHIFT = { id: '', label: 'General Day Shift', start_time: '10:00', end_time: '18:30' };

function normalize(value) {
  return String(value || '').trim().toLowerCase();
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
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    minutes: (parseInt(parts.hour, 10) * 60) + parseInt(parts.minute, 10)
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

function getDefaultShift() {
  return db.prepare(`
    SELECT *
    FROM timesheet_shifts
    WHERE active = 1
    ORDER BY default_for_new_clients DESC, id ASC
    LIMIT 1
  `).get() || DEFAULT_SHIFT;
}

function getAttendanceLocations() {
  const defaultShift = getDefaultShift();
  const offices = db.prepare(`
    SELECT id, location, latitude, longitude, radius_meters, active
    FROM location_master
    WHERE active = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL
  `).all().map(item => ({
    id: `office:${item.id}`,
    raw_id: String(item.id),
    type: 'office',
    label: item.location,
    latitude: Number(item.latitude),
    longitude: Number(item.longitude),
    radius_meters: Math.max(parseInt(item.radius_meters, 10) || 50, 1),
    shift_id: String(defaultShift.id || ''),
    shift_label: defaultShift.label || DEFAULT_SHIFT.label,
    shift_start: normalizeTime(defaultShift.start_time) || DEFAULT_SHIFT.start_time,
    shift_end: normalizeTime(defaultShift.end_time) || DEFAULT_SHIFT.end_time,
    active: 1
  }));
  const sites = db.prepare(`
    SELECT s.*, c.name AS client_name, c.code AS client_code, sh.label AS shift_label, sh.start_time AS master_shift_start, sh.end_time AS master_shift_end
    FROM timesheet_client_sites s
    JOIN clients c ON c.id = s.client_id
    LEFT JOIN timesheet_shifts sh ON sh.id = s.shift_id
    WHERE s.active = 1 AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
  `).all().map(row => ({
    id: `site:${row.id}`,
    raw_id: String(row.id),
    type: 'client_site',
    label: `${row.client_name || 'Client'} - ${row.site_name || 'Site'}`,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radius_meters: Math.max(parseInt(row.radius_meters, 10) || 50, 1),
    client_id: String(row.client_id || ''),
    client_name: row.client_name || '',
    shift_id: String(row.shift_id || defaultShift.id || ''),
    shift_label: row.shift_label || defaultShift.label || DEFAULT_SHIFT.label,
    shift_start: normalizeTime(row.shift_start) || normalizeTime(row.master_shift_start) || normalizeTime(defaultShift.start_time) || DEFAULT_SHIFT.start_time,
    shift_end: normalizeTime(row.shift_end) || normalizeTime(row.master_shift_end) || normalizeTime(defaultShift.end_time) || DEFAULT_SHIFT.end_time,
    active: 1
  }));
  return [...offices, ...sites].sort((a, b) => a.label.localeCompare(b.label));
}

function resolveLocation(locationId) {
  return getAttendanceLocations().find(item => String(item.id) === String(locationId) || String(item.raw_id) === String(locationId)) || null;
}

function calculatePolicy({ entryTime, exitTime, shiftStart, shiftEnd }) {
  const entry = minutesFromTime(entryTime);
  const exit = minutesFromTime(exitTime);
  const start = minutesFromTime(shiftStart) ?? minutesFromTime(DEFAULT_SHIFT.start_time);
  const end = minutesFromTime(shiftEnd) ?? minutesFromTime(DEFAULT_SHIFT.end_time);
  const hoursWorked = entry != null && exit != null && exit >= entry ? Number(((exit - entry) / 60).toFixed(2)) : 0;
  return {
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
    id: row.id ? String(row.id) : '',
    user_id: String(row.user_id || ''),
    person_name: row.person_name || row.display_name || '',
    display_name: row.display_name || row.person_name || '',
    username: row.username || '',
    user_role: row.user_role || '',
    user_active: row.user_active === 0 ? 0 : 1,
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
    check_in_distance_meters: row.check_in_distance_meters ?? null,
    check_out_distance_meters: row.check_out_distance_meters ?? null,
    record_source: row.record_source || 'manual',
    approved: row.approved || 'system',
    correction_status: row.correction_status || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

function getTodayRecord(userId, date = currentIndiaDateTimeParts().date) {
  return db.prepare('SELECT * FROM attendance_records WHERE user_id = ? AND attendance_date = ?').get(userId, date) || null;
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

function loadAttendanceRows({ from = '', to = '', userId = '', canViewAll = false, currentUserId = '' } = {}) {
  const clauses = [];
  const params = [];
  if (from) { clauses.push('a.attendance_date >= ?'); params.push(from); }
  if (to) { clauses.push('a.attendance_date <= ?'); params.push(to); }
  if (userId) { clauses.push('a.user_id = ?'); params.push(userId); }
  if (!canViewAll) { clauses.push('a.user_id = ?'); params.push(currentUserId); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT a.*, u.name AS live_name, u.username AS live_username, u.role AS live_role, u.active AS live_active
    FROM attendance_records a
    LEFT JOIN users u ON u.id = a.user_id
    ${where}
    ORDER BY a.attendance_date DESC, COALESCE(u.name, a.display_name, a.person_name) ASC, a.entry_time DESC
  `).all(...params);
  const todayDate = currentIndiaDateTimeParts().date;
  return rows.map(row => projectAttendanceRow({
    ...row,
    display_name: row.live_name || row.display_name || row.person_name,
    username: row.live_username || row.username || '',
    user_role: row.live_role || row.user_role || '',
    user_active: row.live_active === 0 ? 0 : 1
  }, todayDate));
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

router.get('/locations', (req, res) => {
  if (!requireAccess(req, res, canViewOwn(req.user), 'attendance.view_own')) return;
  res.json({ items: getAttendanceLocations() });
});

router.get('/today', (req, res) => {
  if (!requireAccess(req, res, canViewOwn(req.user), 'attendance.view_own')) return;
  const current = currentIndiaDateTimeParts();
  const record = getTodayRecord(req.user.id, current.date);
  res.json({
    date: current.date,
    time: current.time,
    record: record ? projectAttendanceRow(record, current.date) : null,
    can_check_in: canCreateOwn(req.user) && !record,
    can_check_out: canCreateOwn(req.user) && !!record && !record.exit_time,
    locations: getAttendanceLocations()
  });
});

router.post('/check-in', (req, res) => {
  if (!requireAccess(req, res, canCreateOwn(req.user), 'attendance.create_own')) return;
  const current = currentIndiaDateTimeParts();
  if (getTodayRecord(req.user.id, current.date)) return res.status(400).json({ error: 'Attendance already recorded for today' });
  const location = resolveLocation(String(req.body?.location_id || '').trim());
  if (!location) return res.status(400).json({ error: 'Selected location is not available' });
  const latitude = roundCoordinate(req.body?.user_latitude);
  const longitude = roundCoordinate(req.body?.user_longitude);
  if (latitude == null || longitude == null) return res.status(400).json({ error: 'Current location is required' });
  const geo = validateGeo(location, latitude, longitude);
  if (!geo.ok) return res.status(400).json({ error: geo.error });
  const policy = calculatePolicy({ entryTime: current.time, shiftStart: location.shift_start, shiftEnd: location.shift_end });

  const result = db.prepare(`
    INSERT INTO attendance_records (
      user_id, person_name, display_name, username, user_role, user_active, attendance_date,
      entry_time, exit_time, location, location_id, location_type, check_in_location, shift_start, shift_end,
      check_in_latitude, check_in_longitude, check_in_distance_meters,
      hours_worked, attendance_status, late_mark_entry, late_mark_exit, entry_diff_minutes,
      record_source, approved, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'checked_in', ?, '-', ?, 'manual', 'system', ?, ?)
  `).run(
    req.user.id,
    req.user.name || req.user.username || 'Unknown',
    req.user.name || req.user.username || 'Unknown',
    req.user.username || '',
    normalize(req.user.role) || 'article',
    current.date,
    current.time,
    location.label,
    location.id,
    location.type,
    location.label,
    location.shift_start,
    location.shift_end,
    latitude,
    longitude,
    Number(geo.distance.toFixed(2)),
    policy.late_mark_entry,
    policy.entry_diff_minutes,
    nowIso(),
    nowIso()
  );
  const record = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, record: projectAttendanceRow(record, current.date) });
});

router.post('/check-out', (req, res) => {
  if (!requireAccess(req, res, canCreateOwn(req.user), 'attendance.create_own')) return;
  const current = currentIndiaDateTimeParts();
  const record = getTodayRecord(req.user.id, current.date);
  if (!record) return res.status(400).json({ error: 'Check in before checking out' });
  if (record.exit_time) return res.status(400).json({ error: 'Attendance is already checked out for today' });
  const location = resolveLocation(String(req.body?.location_id || record.location_id || '').trim());
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
  db.prepare(`
    UPDATE attendance_records
    SET exit_time = ?, check_out_location = ?, check_out_location_id = ?, check_out_latitude = ?, check_out_longitude = ?,
        check_out_distance_meters = ?, hours_worked = ?, attendance_status = 'checked_out',
        late_mark_exit = ?, exit_diff_minutes = ?, updated_at = ?
    WHERE id = ?
  `).run(
    current.time,
    location.label,
    location.id,
    latitude,
    longitude,
    Number(geo.distance.toFixed(2)),
    policy.hours_worked,
    policy.late_mark_exit,
    policy.exit_diff_minutes,
    nowIso(),
    record.id
  );
  res.json({ success: true, record: projectAttendanceRow(db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(record.id), current.date) });
});

router.get('/live', (req, res) => {
  if (!requireAccess(req, res, canViewReports(req.user), 'attendance.view_reports')) return;
  const current = currentIndiaDateTimeParts();
  const rows = loadAttendanceRows({ from: current.date, to: current.date, canViewAll: true });
  const byUser = new Map(rows.map(row => [String(row.user_id), row]));
  const users = db.prepare('SELECT id, name, username, role FROM users WHERE active = 1 ORDER BY name ASC').all();
  const items = users.map(user => byUser.get(String(user.id)) || {
    id: '',
    user_id: String(user.id),
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
  res.json({
    date: current.date,
    items,
    summary: {
      total_staff: items.length,
      checked_in: items.filter(item => item.attendance_status === 'checked_in').length,
      checked_out: items.filter(item => item.attendance_status === 'checked_out').length,
      not_checked_in: items.filter(item => item.attendance_status === 'not_checked_in').length,
      late: items.filter(item => item.late_mark_entry === 'Yes').length,
      missed_checkout: items.filter(item => item.attendance_status === 'missed_checkout').length
    }
  });
});

router.post('/corrections', (req, res) => {
  if (!requireAccess(req, res, canViewOwn(req.user), 'attendance.view_own')) return;
  const recordId = parseInt(req.body?.record_id, 10);
  const reason = String(req.body?.reason || '').trim();
  if (!recordId || !reason) return res.status(400).json({ error: 'Attendance record and reason are required' });
  const record = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(recordId);
  if (!record) return res.status(404).json({ error: 'Attendance record not found' });
  if (!canViewReports(req.user) && String(record.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Access denied' });
  const result = db.prepare(`
    INSERT INTO attendance_corrections (
      record_id, user_id, requested_by_user_id, requested_by_name, reason,
      requested_entry_time, requested_exit_time, requested_location_note, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    recordId,
    record.user_id,
    req.user.id,
    req.user.name || req.user.username || '',
    reason,
    normalizeTime(req.body?.requested_entry_time),
    normalizeTime(req.body?.requested_exit_time),
    String(req.body?.requested_location_note || '').trim(),
    nowIso(),
    nowIso()
  );
  db.prepare("UPDATE attendance_records SET correction_status = 'pending', updated_at = ? WHERE id = ?").run(nowIso(), recordId);
  res.json({ success: true, correction: db.prepare('SELECT * FROM attendance_corrections WHERE id = ?').get(result.lastInsertRowid) });
});

function resolveCorrection(req, res, status) {
  if (!requireAccess(req, res, canApproveCorrections(req.user), 'attendance.approve_corrections')) return;
  const correction = db.prepare('SELECT * FROM attendance_corrections WHERE id = ?').get(req.params.id);
  if (!correction) return res.status(404).json({ error: 'Correction request not found' });
  if (correction.status !== 'pending') return res.status(400).json({ error: 'Correction request is already resolved' });
  const record = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(correction.record_id);
  if (!record) return res.status(404).json({ error: 'Attendance record not found' });
  db.prepare(`
    UPDATE attendance_corrections
    SET status = ?, resolved_by_user_id = ?, resolved_by_name = ?, resolution_note = ?, resolved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, req.user.id, req.user.name || req.user.username || '', String(req.body?.note || '').trim(), nowIso(), nowIso(), correction.id);
  if (status === 'approved') {
    const entryTime = correction.requested_entry_time || record.entry_time;
    const exitTime = correction.requested_exit_time || record.exit_time;
    const policy = calculatePolicy({ entryTime, exitTime, shiftStart: record.shift_start, shiftEnd: record.shift_end });
    db.prepare(`
      UPDATE attendance_records
      SET entry_time = ?, exit_time = ?, hours_worked = ?, late_mark_entry = ?, late_mark_exit = ?,
          entry_diff_minutes = ?, exit_diff_minutes = ?, attendance_status = ?, correction_status = 'approved',
          corrected_by_user_id = ?, corrected_by_name = ?, corrected_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      entryTime,
      exitTime,
      policy.hours_worked,
      policy.late_mark_entry,
      exitTime ? policy.late_mark_exit : '-',
      policy.entry_diff_minutes,
      exitTime ? policy.exit_diff_minutes : null,
      exitTime ? 'checked_out' : 'checked_in',
      req.user.id,
      req.user.name || req.user.username || '',
      nowIso(),
      nowIso(),
      record.id
    );
  } else {
    db.prepare("UPDATE attendance_records SET correction_status = 'rejected', updated_at = ? WHERE id = ?").run(nowIso(), record.id);
  }
  res.json({ success: true });
}

router.post('/corrections/:id/approve', (req, res) => resolveCorrection(req, res, 'approved'));
router.post('/corrections/:id/reject', (req, res) => resolveCorrection(req, res, 'rejected'));

router.get('/corrections', (req, res) => {
  if (!requireAccess(req, res, canViewOwn(req.user), 'attendance.view_own')) return;
  const canAll = canViewReports(req.user);
  const rows = db.prepare(`
    SELECT c.*, u.name AS user_name, u.username
    FROM attendance_corrections c
    LEFT JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at DESC
  `).all().filter(item => canAll || String(item.user_id) === String(req.user.id) || String(item.requested_by_user_id) === String(req.user.id));
  res.json({ items: rows });
});

router.get('/export', (req, res) => {
  if (!requireAccess(req, res, canViewReports(req.user), 'attendance.view_reports')) return;
  const rows = loadAttendanceRows({
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
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance-report.csv"');
  res.send(XLSX.utils.sheet_to_csv(sheet));
});

router.get('/', (req, res) => {
  if (!requireAccess(req, res, canViewOwn(req.user), 'attendance.view_own')) return;
  const query = normalize(req.query.q);
  const status = String(req.query.status || '').trim();
  const locationId = String(req.query.location_id || '').trim();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 50, 1), 200);
  const rows = loadAttendanceRows({
    from: String(req.query.from || '').trim(),
    to: String(req.query.to || '').trim(),
    userId: String(req.query.user_id || '').trim(),
    canViewAll: canViewReports(req.user),
    currentUserId: req.user.id
  });
  const filtered = rows.filter(row => matchRow(row, query, status, locationId));
  const start = (page - 1) * pageSize;
  res.json({
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    page_size: pageSize,
    has_more: start + pageSize < filtered.length,
    summary: {
      total_records: filtered.length,
      present_days: filtered.filter(row => row.entry_time).length,
      checked_in: filtered.filter(row => row.attendance_status === 'checked_in').length,
      checked_out: filtered.filter(row => row.attendance_status === 'checked_out').length,
      missed_checkout: filtered.filter(row => row.attendance_status === 'missed_checkout').length,
      late_entries: filtered.filter(row => row.late_mark_entry === 'Yes').length,
      early_exits: filtered.filter(row => row.late_mark_exit === 'Yes').length,
      total_hours: Number(filtered.reduce((sum, row) => sum + (Number(row.hours_worked) || 0), 0).toFixed(2))
    }
  });
});

router.post('/', (req, res) => {
  req.url = '/check-in';
  router.handle(req, res);
});

module.exports = router;
