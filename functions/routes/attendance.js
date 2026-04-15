const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getUsersMap } = require('../data-cache');

function hasPermission(req, permission) {
  return Array.isArray(req.user?.permissions) && req.user.permissions.includes(permission);
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function canViewAttendance(user) {
  return Array.isArray(user?.permissions) && (
    user.permissions.includes('attendance.view_reports') ||
    user.permissions.includes('staff.view')
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
    imported_at: row.imported_at || ''
  };
}

router.get('/', async (req, res) => {
  if (!canViewAttendance(req.user)) {
    return res.status(403).json({ error: 'Permission required: attendance.view_reports' });
  }

  try {
    const query = normalize(req.query.q);
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const userId = String(req.query.user_id || '').trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 50, 1), 200);

    const usersMap = await getUsersMap();
    const rows = [];
    const snapshot = await db.collection('attendance_records').get();

    snapshot.forEach(doc => {
      const raw = doc.data();
      if (from && raw.attendance_date < from) return;
      if (to && raw.attendance_date > to) return;
      if (userId && String(raw.user_id || '') !== userId) return;

      const user = raw.user_id ? usersMap.get(String(raw.user_id)) : null;
      rows.push(projectAttendanceRow({
        id: doc.id,
        ...raw,
        display_name: user?.name || raw.person_name,
        username: user?.username || '',
        user_role: user?.role || '',
        user_active: user?.active === false || user?.active === 0 ? 0 : 1
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

module.exports = router;
