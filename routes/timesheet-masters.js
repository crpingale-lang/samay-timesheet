const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const router = express.Router();
const db = require('../js/database');
const { hasPermission } = require('../js/permissions');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function requirePermission(req, res, permission) {
  if (!hasPermission(req.user, permission)) {
    res.status(403).json({ error: `Permission required: ${permission}` });
    return false;
  }
  return true;
}

function normalizeDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF?.parse_date_code ? XLSX.SSF.parse_date_code(value) : null;
    if (parsed) {
      const year = String(parsed.y).padStart(4, '0');
      const month = String(parsed.m).padStart(2, '0');
      const day = String(parsed.d).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeImportedRow(row = {}) {
  const normalized = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    normalized[String(key || '').trim().toLowerCase()] = value;
  });
  return normalized;
}

function parseDelimitedTextRows(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const first = lines[0];
  const delimiter = first.includes('\t') ? '\t' : (first.includes(';') ? ';' : ',');
  const headers = first.split(delimiter).map(cell => cell.trim().toLowerCase());
  const hasHeader = headers.some(h => /date|title|name|type|note|active/.test(h));
  const startIndex = hasHeader ? 1 : 0;
  const rows = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const cols = lines[i].split(delimiter).map(cell => cell.trim());
    const row = {};
    cols.forEach((value, index) => {
      row[headers[index] || `col_${index}`] = value;
    });
    rows.push(row);
  }
  return rows;
}

function readHolidayImportRows(req) {
  if (req.file?.buffer?.length) {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    return rows.map(normalizeImportedRow);
  }
  const text = String(req.body.text || '').trim();
  if (text) {
    return parseDelimitedTextRows(text).map(normalizeImportedRow);
  }
  if (Array.isArray(req.body.rows)) {
    return req.body.rows.map(normalizeImportedRow);
  }
  return [];
}

function formatDisplayDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function normalizeTime(value) {
  const raw = String(value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return null;
  const [hours, minutes] = raw.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return raw;
}

function normalizeBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

function shiftCodeFromLabel(label) {
  return `SFT-${String(label || 'SHIFT').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18) || 'GEN'}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

function mapShift(row) {
  return {
    id: row.id,
    shift_code: row.shift_code,
    label: row.label,
    start_time: row.start_time,
    end_time: row.end_time,
    active: row.active ? 1 : 0,
    default_for_new_clients: row.default_for_new_clients ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapHoliday(row) {
  return {
    id: row.id,
    holiday_date: row.holiday_date,
    holiday_date_display: formatDisplayDate(row.holiday_date),
    title: row.title,
    holiday_type: row.holiday_type,
    notes: row.notes || '',
    active: row.active ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapClientSite(row) {
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    id: row.id,
    client_id: row.client_id,
    client_name: row.client_name,
    client_code: row.client_code,
    site_name: row.site_name,
    latitude,
    longitude,
    shift_id: row.shift_id || null,
    shift_label: row.shift_label || '',
    shift_start: row.shift_start,
    shift_end: row.shift_end,
    radius_meters: Number(row.radius_meters) || 50,
    active: row.active ? 1 : 0,
    map_url: `https://www.google.com/maps?q=${Number(row.latitude)},${Number(row.longitude)}`
  };
}

function listHolidays() {
  return db.prepare(`
    SELECT *
    FROM timesheet_holidays
    ORDER BY holiday_date DESC, title ASC
  `).all().map(mapHoliday);
}

function listShifts() {
  return db.prepare(`
    SELECT *
    FROM timesheet_shifts
    ORDER BY label ASC, start_time ASC
  `).all().map(mapShift);
}

function listClientSites() {
  return db.prepare(`
    SELECT s.*, c.name AS client_name, c.code AS client_code, sh.label AS shift_label
    FROM timesheet_client_sites s
    JOIN clients c ON c.id = s.client_id
    LEFT JOIN timesheet_shifts sh ON sh.id = s.shift_id
    WHERE s.active = 1
    ORDER BY c.name ASC, s.site_name ASC
  `).all().map(mapClientSite).filter(Boolean);
}

function configuredClients() {
  return db.prepare(`
    SELECT DISTINCT c.id, c.name, c.code
    FROM timesheet_client_sites s
    JOIN clients c ON c.id = s.client_id
    WHERE s.active = 1 AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    ORDER BY c.name ASC
  `).all();
}

router.get('/', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.view')) return;
  res.json({
    holidays: listHolidays(),
    shifts: listShifts(),
    client_sites: listClientSites(),
    configured_clients: configuredClients()
  });
});

router.post('/holidays', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.create')) return;
  const holidayDate = normalizeDateInput(req.body.holiday_date);
  const title = String(req.body.title || '').trim();
  if (!holidayDate || !title) return res.status(400).json({ error: 'Holiday date and title are required' });
  try {
    const result = db.prepare(`
      INSERT INTO timesheet_holidays (holiday_date, title, holiday_type, notes, active, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      holidayDate,
      title,
      String(req.body.holiday_type || 'holiday').trim() || 'holiday',
      String(req.body.notes || '').trim(),
      normalizeBool(req.body.active, true) ? 1 : 0
    );
    res.json({ id: result.lastInsertRowid });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(400).json({ error: 'Holiday date already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/holidays/:id', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.edit')) return;
  const holidayDate = normalizeDateInput(req.body.holiday_date);
  const title = String(req.body.title || '').trim();
  if (!holidayDate || !title) return res.status(400).json({ error: 'Holiday date and title are required' });
  try {
    db.prepare(`
      UPDATE timesheet_holidays
      SET holiday_date = ?, title = ?, holiday_type = ?, notes = ?, active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      holidayDate,
      title,
      String(req.body.holiday_type || 'holiday').trim() || 'holiday',
      String(req.body.notes || '').trim(),
      normalizeBool(req.body.active, true) ? 1 : 0,
      req.params.id
    );
    res.json({ success: true });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(400).json({ error: 'Holiday date already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/holidays/:id', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.delete')) return;
  db.prepare('DELETE FROM timesheet_holidays WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/holidays/import', upload.single('file'), (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.import')) return;
  const rows = readHolidayImportRows(req);
  if (!rows.length) return res.status(400).json({ error: 'No holiday rows provided' });

  let inserted = 0;
  let updated = 0;
  const errors = [];
  const updateExisting = normalizeBool(req.body.update_existing, true);

  const findByDate = db.prepare('SELECT id FROM timesheet_holidays WHERE holiday_date = ?');
  const insert = db.prepare(`
    INSERT INTO timesheet_holidays (holiday_date, title, holiday_type, notes, active, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  const update = db.prepare(`
    UPDATE timesheet_holidays
    SET title = ?, holiday_type = ?, notes = ?, active = ?, updated_at = datetime('now')
    WHERE holiday_date = ?
  `);

  const tx = db.transaction(items => {
    for (const row of items) {
      const holidayDate = normalizeDateInput(row.holiday_date || row.date || row.HolidayDate || row.Holiday_Date);
      const title = String(row.title || row.holiday_title || row.name || row.Name || '').trim();
      if (!holidayDate || !title) {
        errors.push(`Missing date/title: ${JSON.stringify(row)}`);
        continue;
      }
      const payload = [
        holidayDate,
        title,
        String(row.holiday_type || row.type || 'holiday').trim() || 'holiday',
        String(row.notes || row.description || '').trim(),
        normalizeBool(row.active, true) ? 1 : 0
      ];
      const existing = findByDate.get(holidayDate);
      if (existing && updateExisting) {
        update.run(title, payload[2], payload[3], payload[4], holidayDate);
        updated += 1;
        continue;
      }
      if (existing) {
        continue;
      }
      insert.run(...payload);
      inserted += 1;
    }
  });

  try {
    tx(rows);
    res.json({ inserted, updated, errors });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/shifts', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.create')) return;
  const label = String(req.body.label || '').trim();
  const startTime = normalizeTime(req.body.start_time) || '10:00';
  const endTime = normalizeTime(req.body.end_time) || '18:30';
  if (!label) return res.status(400).json({ error: 'Shift label is required' });
  try {
    const result = db.prepare(`
      INSERT INTO timesheet_shifts (shift_code, label, start_time, end_time, active, default_for_new_clients, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      String(req.body.shift_code || '').trim() || shiftCodeFromLabel(label),
      label,
      startTime,
      endTime,
      normalizeBool(req.body.active, true) ? 1 : 0,
      normalizeBool(req.body.default_for_new_clients, false) ? 1 : 0
    );
    res.json({ id: result.lastInsertRowid });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(400).json({ error: 'Shift code already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/shifts/:id', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.edit')) return;
  const label = String(req.body.label || '').trim();
  const startTime = normalizeTime(req.body.start_time) || '10:00';
  const endTime = normalizeTime(req.body.end_time) || '18:30';
  if (!label) return res.status(400).json({ error: 'Shift label is required' });
  const existing = db.prepare('SELECT * FROM timesheet_shifts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Shift not found' });
  try {
    db.prepare(`
      UPDATE timesheet_shifts
      SET shift_code = ?, label = ?, start_time = ?, end_time = ?, active = ?, default_for_new_clients = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      String(req.body.shift_code || '').trim() || existing.shift_code,
      label,
      startTime,
      endTime,
      normalizeBool(req.body.active, true) ? 1 : 0,
      normalizeBool(req.body.default_for_new_clients, false) ? 1 : 0,
      req.params.id
    );
    res.json({ success: true });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(400).json({ error: 'Shift code already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/shifts/:id', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.delete')) return;
  db.prepare('DELETE FROM timesheet_shifts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/client-sites', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.create')) return;
  const clientId = parseInt(req.body.client_id, 10);
  const siteName = String(req.body.site_name || '').trim();
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  if (!Number.isInteger(clientId) || clientId <= 0 || !siteName) {
    return res.status(400).json({ error: 'Client and site name are required' });
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }
  const shiftId = req.body.shift_id ? parseInt(req.body.shift_id, 10) : null;
  const shift = shiftId ? db.prepare('SELECT * FROM timesheet_shifts WHERE id = ?').get(shiftId) : null;
  const shiftStart = normalizeTime(req.body.shift_start) || shift?.start_time || '10:00';
  const shiftEnd = normalizeTime(req.body.shift_end) || shift?.end_time || '18:30';
  const radiusMeters = Math.max(parseInt(req.body.radius_meters, 10) || 50, 1);
  try {
    const result = db.prepare(`
      INSERT INTO timesheet_client_sites (client_id, site_name, latitude, longitude, shift_id, shift_start, shift_end, radius_meters, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      clientId,
      siteName,
      latitude,
      longitude,
      shift?.id || null,
      shiftStart,
      shiftEnd,
      radiusMeters,
      normalizeBool(req.body.active, true) ? 1 : 0
    );
    res.json({ id: result.lastInsertRowid });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(400).json({ error: 'Site name already exists for this client' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/client-sites/:id', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.edit')) return;
  const clientId = parseInt(req.body.client_id, 10);
  const siteName = String(req.body.site_name || '').trim();
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  if (!Number.isInteger(clientId) || clientId <= 0 || !siteName) {
    return res.status(400).json({ error: 'Client and site name are required' });
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }
  const shiftId = req.body.shift_id ? parseInt(req.body.shift_id, 10) : null;
  const shift = shiftId ? db.prepare('SELECT * FROM timesheet_shifts WHERE id = ?').get(shiftId) : null;
  const existing = db.prepare('SELECT * FROM timesheet_client_sites WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client site not found' });
  const shiftStart = normalizeTime(req.body.shift_start) || shift?.start_time || existing.shift_start || '10:00';
  const shiftEnd = normalizeTime(req.body.shift_end) || shift?.end_time || existing.shift_end || '18:30';
  const radiusMeters = Math.max(parseInt(req.body.radius_meters, 10) || 50, 1);
  try {
    db.prepare(`
      UPDATE timesheet_client_sites
      SET client_id = ?, site_name = ?, latitude = ?, longitude = ?, shift_id = ?, shift_start = ?, shift_end = ?, radius_meters = ?, active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      clientId,
      siteName,
      latitude,
      longitude,
      shift?.id || null,
      shiftStart,
      shiftEnd,
      radiusMeters,
      normalizeBool(req.body.active, true) ? 1 : 0,
      req.params.id
    );
    res.json({ success: true });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(400).json({ error: 'Site name already exists for this client' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/client-sites/:id', (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.delete')) return;
  db.prepare('DELETE FROM timesheet_client_sites WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
