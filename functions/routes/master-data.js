const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getMasterDataItems, getUdinLocationMasterItems, invalidateCache } = require('../data-cache');
const { missingDefaultMasterData } = require('../lib/master-data-defaults');

const ALLOWED_CATEGORIES = new Set(['work_category', 'work_classification', 'udin_assignment', 'financial_year']);
const TIMESHEET_MASTER_CATEGORIES = new Set(['work_category', 'work_classification']);


function canManageMasters(req) {
  return req.user?.role === 'partner' || (Array.isArray(req.user?.permissions) && req.user.permissions.includes('access.manage'));
}

function hasPermission(req, permission) {
  return Array.isArray(req.user?.permissions) && req.user.permissions.includes(permission);
}

function canManageCategory(req, category, permission) {
  if (canManageMasters(req)) return true;
  if (!TIMESHEET_MASTER_CATEGORIES.has(category)) return false;
  return hasPermission(req, permission);
}

function normalizeMasterDataPayload(body = {}) {
  return {
    key: String(body.key || '').trim(),
    label: String(body.label || '').trim(),
    short_label: String(body.short_label || '').trim() || null,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    active: body.active === undefined ? true : !!body.active
  };
}

let ensureMasterDataPromise = null;
let masterDataEnsured = false;

async function ensureMasterData() {
  if (masterDataEnsured) return;
  if (ensureMasterDataPromise) return ensureMasterDataPromise;
  ensureMasterDataPromise = (async () => {
    const snapshot = await db.collection('master_data').get();
    const existing = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const missing = missingDefaultMasterData(existing);
    if (!missing.length) return;

    let batch = db.batch();
    for (let index = 0; index < missing.length; index++) {
      const { id, ...payload } = missing[index];
      batch.set(db.collection('master_data').doc(id), payload);
      if ((index + 1) % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (missing.length % 400 !== 0) await batch.commit();
    invalidateCache('master-data:all');
  })();

  try {
    await ensureMasterDataPromise;
    masterDataEnsured = true;
  } finally {
    ensureMasterDataPromise = null;
  }
}

async function listCategory(category) {
  const items = await getMasterDataItems();
  return items
    .filter(item => item.category === category)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.label.localeCompare(b.label));
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
    short_name: String(item.short_name || item.shortName || '').trim(),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    radius_meters: Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : 50,
    active: item.active !== false && item.active !== 0 && item.active !== '0'
  };
}

async function listLocations() {
  const items = await getUdinLocationMasterItems();
  return items
    .map(normalizeLocationItem)
    .filter(item => item.active)
    .sort((a, b) => a.label.localeCompare(b.label));
}

router.get('/', async (req, res) => {
  try {
    await ensureMasterData();
    res.json({
      work_categories: await listCategory('work_category'),
      work_classifications: await listCategory('work_classification'),
      udin_assignments: await listCategory('udin_assignment'),
      financial_years: await listCategory('financial_year'),
      udin_locations: await listLocations()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/all/:category', async (req, res) => {
  const { category } = req.params;
  if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid category' });
  try {
    await ensureMasterData();
    const items = await listCategory(category);
    res.json({
      items: items.sort((a, b) => Number(b.active) - Number(a.active) || (a.sort_order || 0) - (b.sort_order || 0) || a.label.localeCompare(b.label))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/category/:category', async (req, res) => {
  if (!canManageCategory(req, req.params.category, 'timesheets.masters.create')) return res.status(403).json({ error: 'Access denied' });
  const { category } = req.params;
  if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid category' });
  const { key, label, short_label, sort_order, active } = normalizeMasterDataPayload(req.body);
  if (!key || !label) return res.status(400).json({ error: 'Key and label are required' });

  try {
    const existing = await getMasterDataItems();
    const exists = existing.some(item => item.category === category && String(item.key || '').trim().toLowerCase() === key.toLowerCase());
    if (exists) return res.status(400).json({ error: 'Key already exists for this category' });

    const docRef = await db.collection('master_data').add({
      category,
      key,
      label,
      short_label: short_label || null,
      sort_order: sort_order || 0,
      active: active === undefined ? true : !!active
    });
    invalidateCache('master-data:all');
    res.json({ id: docRef.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/category/:category/:id', async (req, res) => {
  if (!canManageCategory(req, req.params.category, 'timesheets.masters.edit')) return res.status(403).json({ error: 'Access denied' });
  const { category, id } = req.params;
  if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid category' });
  const { key, label, short_label, sort_order, active } = normalizeMasterDataPayload(req.body);
  if (!key || !label) return res.status(400).json({ error: 'Key and label are required' });

  try {
    const existing = await getMasterDataItems();
    const exists = existing.some(item => item.id !== id && item.category === category && String(item.key || '').trim().toLowerCase() === key.toLowerCase());
    if (exists) return res.status(400).json({ error: 'Key already exists for this category' });

    await db.collection('master_data').doc(id).update({
      category,
      key,
      label,
      short_label: short_label || null,
      sort_order: sort_order || 0,
      active: !!active
    });
    invalidateCache('master-data:all');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/category/:category/:id', async (req, res) => {
  if (!canManageCategory(req, req.params.category, 'timesheets.masters.delete')) return res.status(403).json({ error: 'Access denied' });
  const { category, id } = req.params;
  if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid category' });

  try {
    const docRef = db.collection('master_data').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Master data item not found' });
    if (doc.data()?.category !== category) return res.status(400).json({ error: 'Category mismatch' });

    await docRef.delete();
    invalidateCache('master-data:all');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/locations/all', async (req, res) => {
  try {
    const items = await getUdinLocationMasterItems();
    const normalized = items.map(normalizeLocationItem).sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label));
    res.json({ items: normalized });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/locations', async (req, res) => {
  if (!canManageMasters(req)) return res.status(403).json({ error: 'Access denied' });
  const label = String(req.body?.label || '').trim();
  if (!label) return res.status(400).json({ error: 'Location name is required' });
  try {
    const items = await getUdinLocationMasterItems();
    const exists = items.some(item => String(item.location || item.label || '').trim().toLowerCase() === label.toLowerCase());
    if (exists) return res.status(400).json({ error: 'Location already exists' });
    const docRef = await db.collection('udin_location_master').add({
      location: label,
      short_name: String(req.body?.short_name || '').trim(),
      active: req.body?.active === undefined ? true : !!req.body.active
    });
    invalidateCache('udin-location-master:all');
    res.json({ id: docRef.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/locations/:id', async (req, res) => {
  if (!canManageMasters(req)) return res.status(403).json({ error: 'Access denied' });
  const label = String(req.body?.label || '').trim();
  if (!label) return res.status(400).json({ error: 'Location name is required' });
  try {
    const items = await getUdinLocationMasterItems();
    const exists = items.some(item => String(item.id) !== String(req.params.id) && String(item.location || item.label || '').trim().toLowerCase() === label.toLowerCase());
    if (exists) return res.status(400).json({ error: 'Location already exists' });
    await db.collection('udin_location_master').doc(req.params.id).update({
      location: label,
      short_name: String(req.body?.short_name || '').trim(),
      active: !!req.body.active
    });
    invalidateCache('udin-location-master:all');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
