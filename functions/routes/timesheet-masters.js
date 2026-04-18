const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const router = express.Router();
const { db } = require('../db');
const { getClientsMap, invalidateCacheByPrefix } = require('../data-cache');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function hasPermission(req, permission) {
  return Array.isArray(req.user?.permissions) && req.user.permissions.includes(permission);
}

function requirePermission(req, res, permission) {
  if (!hasPermission(req, permission)) {
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

async function listClientsMap() {
  return getClientsMap();
}

function mapHoliday(doc) {
  const row = doc.data();
  return {
    id: doc.id,
    holiday_date: row.holiday_date,
    holiday_date_display: formatDisplayDate(row.holiday_date),
    title: row.title,
    holiday_type: row.holiday_type || 'holiday',
    notes: row.notes || '',
    active: row.active === false || row.active === 0 || row.active === '0' ? 0 : 1,
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

function mapShift(doc) {
  const row = doc.data();
  return {
    id: doc.id,
    shift_code: row.shift_code,
    label: row.label,
    start_time: row.start_time || '10:00',
    end_time: row.end_time || '18:30',
    active: row.active === false || row.active === 0 || row.active === '0' ? 0 : 1,
    default_for_new_clients: row.default_for_new_clients === true || row.default_for_new_clients === 1 || row.default_for_new_clients === '1' ? 1 : 0,
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

function mapClientSite(doc, clientData = {}, shiftData = null) {
  const row = doc.data();
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    id: doc.id,
    client_id: row.client_id,
    client_name: clientData.name || '',
    client_code: clientData.code || '',
    site_name: row.site_name,
    latitude,
    longitude,
    shift_id: row.shift_id || null,
    shift_label: shiftData?.label || '',
    shift_start: row.shift_start || shiftData?.start_time || '10:00',
    shift_end: row.shift_end || shiftData?.end_time || '18:30',
    radius_meters: Number(row.radius_meters) || 50,
    active: row.active === false || row.active === 0 || row.active === '0' ? 0 : 1,
    map_url: `https://www.google.com/maps?q=${Number(row.latitude)},${Number(row.longitude)}`
  };
}

async function loadTimesheetMasterData() {
  const [holidaySnap, shiftSnap, siteSnap, clientsMap] = await Promise.all([
    db.collection('timesheet_holidays').get(),
    db.collection('timesheet_shifts').get(),
    db.collection('timesheet_client_sites').get(),
    listClientsMap()
  ]);

  const shifts = shiftSnap.docs.map(mapShift).sort((a, b) => a.label.localeCompare(b.label));
  const shiftMap = new Map(shifts.map(item => [String(item.id), item]));
  const clientSites = [];
  const configuredClientIds = new Set();

  for (const doc of siteSnap.docs) {
    const row = doc.data();
    const clientData = clientsMap.get(String(row.client_id)) || {};
    if (row.active === false || row.active === 0 || row.active === '0') continue;
    const mapped = mapClientSite(doc, clientData, shiftMap.get(String(row.shift_id)));
    if (!mapped) continue;
    configuredClientIds.add(String(row.client_id));
    clientSites.push(mapped);
  }

  const validClientSites = clientSites.filter(Boolean);
  validClientSites.sort((a, b) => a.client_name.localeCompare(b.client_name) || a.site_name.localeCompare(b.site_name));
  const configuredClients = [...configuredClientIds]
    .map(id => {
      const client = clientsMap.get(String(id));
      return client ? { id, name: client.name, code: client.code } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    holidays: holidaySnap.docs.map(mapHoliday).sort((a, b) => b.holiday_date.localeCompare(a.holiday_date) || a.title.localeCompare(b.title)),
    shifts,
    client_sites: validClientSites,
    configured_clients: configuredClients
  };
}

router.get('/', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.view')) return;
  try {
    res.json(await loadTimesheetMasterData());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/holidays', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.create')) return;
  const holidayDate = normalizeDateInput(req.body.holiday_date);
  const title = String(req.body.title || '').trim();
  if (!holidayDate || !title) return res.status(400).json({ error: 'Holiday date and title are required' });
  try {
    const existing = await db.collection('timesheet_holidays').where('holiday_date', '==', holidayDate).limit(1).get();
    if (!existing.empty) return res.status(400).json({ error: 'Holiday date already exists' });
    const docRef = await db.collection('timesheet_holidays').add({
      holiday_date: holidayDate,
      title,
      holiday_type: String(req.body.holiday_type || 'holiday').trim() || 'holiday',
      notes: String(req.body.notes || '').trim(),
      active: normalizeBool(req.body.active, true),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    invalidateCacheByPrefix('timesheet-master:');
    res.json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/holidays/:id', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.edit')) return;
  const holidayDate = normalizeDateInput(req.body.holiday_date);
  const title = String(req.body.title || '').trim();
  if (!holidayDate || !title) return res.status(400).json({ error: 'Holiday date and title are required' });
  try {
    await db.collection('timesheet_holidays').doc(req.params.id).update({
      holiday_date: holidayDate,
      title,
      holiday_type: String(req.body.holiday_type || 'holiday').trim() || 'holiday',
      notes: String(req.body.notes || '').trim(),
      active: normalizeBool(req.body.active, true),
      updated_at: new Date().toISOString()
    });
    invalidateCacheByPrefix('timesheet-master:');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/holidays/:id', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.delete')) return;
  try {
    await db.collection('timesheet_holidays').doc(req.params.id).delete();
    invalidateCacheByPrefix('timesheet-master:');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/holidays/import', upload.single('file'), async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.import')) return;
  const rows = readHolidayImportRows(req);
  if (!rows.length) return res.status(400).json({ error: 'No holiday rows provided' });

  let inserted = 0;
  let updated = 0;
  const errors = [];
  const updateExisting = normalizeBool(req.body.update_existing, true);

  try {
    const existingSnap = await db.collection('timesheet_holidays').get();
    const byDate = new Map();
    existingSnap.docs.forEach(doc => {
      const data = doc.data() || {};
      byDate.set(String(data.holiday_date || ''), doc);
    });

    const batch = db.batch();
    for (const row of rows) {
      const holidayDate = normalizeDateInput(row.holiday_date || row.date || row.HolidayDate || row.Holiday_Date);
      const title = String(row.title || row.holiday_title || row.name || row.Name || '').trim();
      if (!holidayDate || !title) {
        errors.push(`Missing date/title: ${JSON.stringify(row)}`);
        continue;
      }
      const existing = byDate.get(holidayDate);
      const payload = {
        holiday_date: holidayDate,
        title,
        holiday_type: String(row.holiday_type || row.type || 'holiday').trim() || 'holiday',
        notes: String(row.notes || row.description || '').trim(),
        active: normalizeBool(row.active, true),
        updated_at: new Date().toISOString()
      };
      if (existing) {
        if (updateExisting) {
          batch.update(existing.ref, payload);
          updated += 1;
        }
        continue;
      }
      batch.set(db.collection('timesheet_holidays').doc(), {
        ...payload,
        created_at: new Date().toISOString()
      });
      inserted += 1;
    }
    await batch.commit();
    invalidateCacheByPrefix('timesheet-master:');
    res.json({ inserted, updated, errors });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/shifts', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.create')) return;
  const label = String(req.body.label || '').trim();
  const startTime = normalizeTime(req.body.start_time) || '10:00';
  const endTime = normalizeTime(req.body.end_time) || '18:30';
  if (!label) return res.status(400).json({ error: 'Shift label is required' });
  try {
    const docRef = await db.collection('timesheet_shifts').add({
      shift_code: String(req.body.shift_code || '').trim() || shiftCodeFromLabel(label),
      label,
      start_time: startTime,
      end_time: endTime,
      active: normalizeBool(req.body.active, true),
      default_for_new_clients: normalizeBool(req.body.default_for_new_clients, false),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    invalidateCacheByPrefix('timesheet-master:');
    res.json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/shifts/:id', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.edit')) return;
  const label = String(req.body.label || '').trim();
  const startTime = normalizeTime(req.body.start_time) || '10:00';
  const endTime = normalizeTime(req.body.end_time) || '18:30';
  if (!label) return res.status(400).json({ error: 'Shift label is required' });
  try {
    const current = await db.collection('timesheet_shifts').doc(req.params.id).get();
    if (!current.exists) return res.status(404).json({ error: 'Shift not found' });
    await db.collection('timesheet_shifts').doc(req.params.id).update({
      shift_code: String(req.body.shift_code || '').trim() || current.data().shift_code,
      label,
      start_time: startTime,
      end_time: endTime,
      active: normalizeBool(req.body.active, true),
      default_for_new_clients: normalizeBool(req.body.default_for_new_clients, false),
      updated_at: new Date().toISOString()
    });
    invalidateCacheByPrefix('timesheet-master:');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/shifts/:id', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.delete')) return;
  try {
    await db.collection('timesheet_shifts').doc(req.params.id).delete();
    invalidateCacheByPrefix('timesheet-master:');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/client-sites', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.create')) return;
  const clientId = String(req.body.client_id || '').trim();
  const siteName = String(req.body.site_name || '').trim();
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  if (!clientId || !siteName) return res.status(400).json({ error: 'Client and site name are required' });
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }
  try {
    const existing = await db.collection('timesheet_client_sites')
      .where('client_id', '==', clientId)
      .where('site_name', '==', siteName)
      .limit(1)
      .get();
    if (!existing.empty) return res.status(400).json({ error: 'Site name already exists for this client' });

    const shiftId = String(req.body.shift_id || '').trim() || null;
    let shiftStart = normalizeTime(req.body.shift_start) || '10:00';
    let shiftEnd = normalizeTime(req.body.shift_end) || '18:30';
    if (shiftId) {
      const shiftDoc = await db.collection('timesheet_shifts').doc(shiftId).get();
      if (shiftDoc.exists) {
        shiftStart = normalizeTime(req.body.shift_start) || shiftDoc.data().start_time || '10:00';
        shiftEnd = normalizeTime(req.body.shift_end) || shiftDoc.data().end_time || '18:30';
      }
    }
    const docRef = await db.collection('timesheet_client_sites').add({
      client_id: clientId,
      site_name: siteName,
      latitude,
      longitude,
      shift_id: shiftId,
      shift_start: shiftStart,
      shift_end: shiftEnd,
      radius_meters: Math.max(parseInt(req.body.radius_meters, 10) || 50, 1),
      active: normalizeBool(req.body.active, true),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    invalidateCacheByPrefix('timesheet-master:');
    res.json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/client-sites/:id', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.edit')) return;
  const clientId = String(req.body.client_id || '').trim();
  const siteName = String(req.body.site_name || '').trim();
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  if (!clientId || !siteName) return res.status(400).json({ error: 'Client and site name are required' });
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }
  try {
    const current = await db.collection('timesheet_client_sites').doc(req.params.id).get();
    if (!current.exists) return res.status(404).json({ error: 'Client site not found' });
    const shiftId = String(req.body.shift_id || '').trim() || null;
    let shiftStart = normalizeTime(req.body.shift_start) || current.data().shift_start || '10:00';
    let shiftEnd = normalizeTime(req.body.shift_end) || current.data().shift_end || '18:30';
    if (shiftId) {
      const shiftDoc = await db.collection('timesheet_shifts').doc(shiftId).get();
      if (shiftDoc.exists) {
        shiftStart = normalizeTime(req.body.shift_start) || shiftDoc.data().start_time || '10:00';
        shiftEnd = normalizeTime(req.body.shift_end) || shiftDoc.data().end_time || '18:30';
      }
    }
    await db.collection('timesheet_client_sites').doc(req.params.id).update({
      client_id: clientId,
      site_name: siteName,
      latitude,
      longitude,
      shift_id: shiftId,
      shift_start: shiftStart,
      shift_end: shiftEnd,
      radius_meters: Math.max(parseInt(req.body.radius_meters, 10) || 50, 1),
      active: normalizeBool(req.body.active, true),
      updated_at: new Date().toISOString()
    });
    invalidateCacheByPrefix('timesheet-master:');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/client-sites/:id', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.masters.delete')) return;
  try {
    await db.collection('timesheet_client_sites').doc(req.params.id).delete();
    invalidateCacheByPrefix('timesheet-master:');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
