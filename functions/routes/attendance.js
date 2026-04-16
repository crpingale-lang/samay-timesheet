const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getUsersMap, getLocationMasterItems, invalidateCache } = require('../data-cache');

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function canViewAttendanceReports(user) {
  return Array.isArray(user?.permissions) && (
    user.permissions.includes('attendance.view_reports') ||
    user.permissions.includes('staff.view')
  );
}

function canViewOwnAttendance(user) {
  return Array.isArray(user?.permissions) && (
    user.permissions.includes('attendance.view_own') ||
    user.permissions.includes('attendance.create_own') ||
    canViewAttendanceReports(user)
  );
}

function canCreateOwnAttendance(user) {
  return Array.isArray(user?.permissions) && (
    user.permissions.includes('attendance.create_own') ||
    canViewAttendanceReports(user)
  );
}

function toBoolText(value) {
  if (value === true || value === 1 || value === '1') return 'Yes';
  if (value === false || value === 0 || value === '0') return 'No';
  const normalized = String(value || '').trim();
  return normalized || '-';
}

function matchQuery(record, query) {
  if (!query) return true;
  const haystack = [
    record.person_name,
    record.username,
    record.display_name,
    record.location,
    record.approved,
    record.approved_by,
    record.user_role
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function sortAttendanceRecords(a, b) {
  const dateDiff = (b.attendance_date || '').localeCompare(a.attendance_date || '');
  if (dateDiff !== 0) return dateDiff;
  const nameDiff = (a.display_name || a.person_name || '').localeCompare(b.display_name || b.person_name || '');
  if (nameDiff !== 0) return nameDiff;
  return (Number(b.source_row) || 0) - (Number(a.source_row) || 0);
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
    time: `${parts.hour}:${parts.minute}`,
    minutes: (parseInt(parts.hour, 10) * 60) + parseInt(parts.minute, 10)
  };
}

function roundCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Number(num.toFixed(6)) : null;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeLocationItem(item) {
  const label = String(item.location || item.Location || item.name || item.Name || '').trim();
  const latitude = Number(
    item.latitude ??
    item.Latitude ??
    item.lat ??
    item.Lat ??
    item.latitude_deg ??
    item.latitude_degrees ??
    item.latitudeDeg ??
    item.lat_deg
  );
  const longitude = Number(
    item.longitude ??
    item.Longitude ??
    item.lng ??
    item.Lng ??
    item.lon ??
    item.Long ??
    item.longitude_deg ??
    item.longitude_degrees ??
    item.longitudeDeg ??
    item.lng_deg
  );
  const radiusMeters = Number(item.radius_meters ?? item.radius ?? item.Radius ?? 50);
  return {
    id: item.id,
    label: label || `Location ${item.id}`,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    radius_meters: Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : 50,
    active: item.active !== false && item.active !== 0 && item.active !== '0'
  };
}

async function getNormalizedLocations() {
  const items = await getLocationMasterItems();
  return items
    .map(normalizeLocationItem)
    .filter(item => item.active && item.latitude != null && item.longitude != null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function projectAttendanceRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    person_name: row.person_name,
    display_name: row.display_name || row.person_name,
    username: row.username || '',
    user_role: row.user_role || '',
    user_active: row.user_active ? 1 : 0,
    attendance_date: row.attendance_date,
    entry_time: row.entry_time || '',
    exit_time: row.exit_time || '',
    location: row.location || '',
    location_id: row.location_id || '',
    location_latitude: row.location_latitude == null ? null : Number(row.location_latitude),
    location_longitude: row.location_longitude == null ? null : Number(row.location_longitude),
    user_latitude: row.user_latitude == null ? null : Number(row.user_latitude),
    user_longitude: row.user_longitude == null ? null : Number(row.user_longitude),
    distance_meters: row.distance_meters == null ? null : Number(row.distance_meters),
    entry_location: row.entry_location || '',
    exit_location: row.exit_location || '',
    distance: Number(row.distance) || 0,
    hours_worked: Number(row.hours_worked) || 0,
    check_in_overridden: toBoolText(row.check_in_overridden),
    check_out_overridden: toBoolText(row.check_out_overridden),
    approved: row.approved || '-',
    approved_by: row.approved_by || '-',
    late_mark_entry: row.late_mark_entry || '-',
    late_mark_exit: row.late_mark_exit || '-',
    late_mark_regularised: row.late_mark_regularised || '-',
    late_mark_approver: row.late_mark_approver || '-',
    final_check_in_time: row.final_check_in_time || '',
    final_check_out_time: row.final_check_out_time || '',
    entry_diff_minutes: row.entry_diff_minutes == null ? null : Number(row.entry_diff_minutes),
    exit_diff_minutes: row.exit_diff_minutes == null ? null : Number(row.exit_diff_minutes),
    source_file: row.source_file || '',
    source_row: Number(row.source_row) || 0,
    imported_at: row.imported_at || '',
    record_source: row.record_source || 'imported'
  };
}

router.get('/', async (req, res) => {
  if (!canViewOwnAttendance(req.user)) {
    return res.status(403).json({ error: 'Permission required: attendance.view_own' });
  }

  try {
    const query = normalize(req.query.q);
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const userId = String(req.query.user_id || '').trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 50, 1), 200);
    const canViewAll = canViewAttendanceReports(req.user);

    const usersMap = await getUsersMap();
    const locations = await getNormalizedLocations();
    const rows = [];
    const snapshot = await db.collection('attendance_records').get();

    snapshot.forEach(doc => {
      const raw = doc.data();
      if (from && raw.attendance_date < from) return;
      if (to && raw.attendance_date > to) return;
      if (!canViewAll && String(raw.user_id || '') !== String(req.user.id)) return;
      if (userId && String(raw.user_id || '') !== userId) return;

      const user = raw.user_id ? usersMap.get(String(raw.user_id)) : null;
      const location = raw.location_id ? locations.find(item => String(item.id) === String(raw.location_id)) : null;
      rows.push(projectAttendanceRow({
        id: doc.id,
        ...raw,
        display_name: user?.name || raw.person_name,
        username: user?.username || '',
        user_role: user?.role || '',
        user_active: user?.active === false || user?.active === 0 ? 0 : 1,
        location: raw.location || location?.label || raw.location_name || '',
        location_latitude: raw.location_latitude ?? location?.latitude ?? null,
        location_longitude: raw.location_longitude ?? location?.longitude ?? null
      }));
    });

    rows.sort(sortAttendanceRecords);
    const filtered = rows.filter(row => matchQuery(row, query));

    const uniqueNames = new Set();
    const activeUsers = new Set();
    const inactiveUsers = new Set();
    filtered.forEach(row => {
      uniqueNames.add(normalize(row.display_name || row.person_name));
      if (row.user_id) {
        if (row.user_active) activeUsers.add(String(row.user_id));
        else inactiveUsers.add(String(row.user_id));
      }
    });

    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    res.json({
      items,
      total: filtered.length,
      page,
      page_size: pageSize,
      has_more: start + items.length < filtered.length,
      summary: {
        total_records: filtered.length,
        unique_people: uniqueNames.size,
        active_users: activeUsers.size,
        inactive_users: inactiveUsers.size,
        date_from: filtered[filtered.length - 1]?.attendance_date || null,
        date_to: filtered[0]?.attendance_date || null
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  if (!canCreateOwnAttendance(req.user)) {
    return res.status(403).json({ error: 'Permission required: attendance.create_own' });
  }

  try {
    const locationId = String(req.body?.location_id || '').trim();
    const userLatitude = roundCoordinate(req.body?.user_latitude);
    const userLongitude = roundCoordinate(req.body?.user_longitude);
    if (!locationId) {
      return res.status(400).json({ error: 'Location is required' });
    }
    if (userLatitude == null || userLongitude == null) {
      return res.status(400).json({ error: 'Current location is required' });
    }

    const locations = await getNormalizedLocations();
    const location = locations.find(item => String(item.id) === locationId);
    if (!location) {
      return res.status(400).json({ error: 'Selected location is not available' });
    }

    const distanceMeters = haversineMeters(userLatitude, userLongitude, location.latitude, location.longitude);
    const allowedRadius = Number(location.radius_meters || 50);
    if (!Number.isFinite(distanceMeters)) {
      return res.status(400).json({ error: 'Unable to verify your location' });
    }
    if (distanceMeters > allowedRadius) {
      return res.status(400).json({
        error: `You are ${Math.round(distanceMeters)} metres away from ${location.label}. Move within ${allowedRadius} metres to save attendance.`
      });
    }

    const current = currentIndiaDateTimeParts();
    const existingManual = await db.collection('attendance_records')
      .where('user_id', '==', String(req.user.id))
      .get();

    if (existingManual.docs.some(doc => {
      const data = doc.data() || {};
      return data.attendance_date === current.date && data.record_source === 'manual_checkin';
    })) {
      return res.status(400).json({ error: 'Attendance already recorded for today' });
    }

    const docRef = db.collection('attendance_records').doc();
    const payload = {
      user_id: String(req.user.id),
      person_name: req.user.name || req.user.username || 'Unknown',
      display_name: req.user.name || req.user.username || 'Unknown',
      username: req.user.username || '',
      user_role: normalizeRole(req.user.role) || 'article',
      user_active: 1,
      attendance_date: current.date,
      entry_time: current.time,
      exit_time: '',
      location: location.label,
      location_id: location.id,
      location_latitude: location.latitude,
      location_longitude: location.longitude,
      user_latitude: userLatitude,
      user_longitude: userLongitude,
      distance_meters: Number(distanceMeters.toFixed(2)),
      hours_worked: 0,
      check_in_overridden: false,
      check_out_overridden: false,
      approved: 'manual',
      approved_by: 'system',
      late_mark_entry: '-',
      late_mark_exit: '-',
      late_mark_regularised: '-',
      late_mark_approver: '-',
      final_check_in_time: current.time,
      final_check_out_time: '',
      entry_diff_minutes: 0,
      exit_diff_minutes: null,
      source_file: 'manual-entry',
      source_row: 0,
      imported_at: new Date().toISOString(),
      record_source: 'manual_checkin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await docRef.set(payload);
    invalidateCache('location-master:all');

    res.json({
      success: true,
      record: projectAttendanceRow({
        id: docRef.id,
        ...payload
      })
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
