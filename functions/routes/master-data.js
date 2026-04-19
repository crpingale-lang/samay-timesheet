const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getMasterDataItems, getUdinLocationMasterItems, invalidateCache } = require('../data-cache');

const ALLOWED_CATEGORIES = new Set(['work_category', 'work_classification', 'udin_assignment', 'financial_year']);

const DEFAULT_MASTER_DATA = {
  work_classification: [
    { key: 'client_work', label: 'Client Work', short_label: 'Client', sort_order: 1 },
    { key: 'internal', label: 'Internal', short_label: 'Internal', sort_order: 2 },
    { key: 'admin', label: 'Admin', short_label: 'Admin', sort_order: 3 },
    { key: 'business_development', label: 'Business Development', short_label: 'Biz Dev', sort_order: 4 },
    { key: 'learning', label: 'Learning', short_label: 'Learning', sort_order: 5 }
  ],
  work_category: [
    { key: 'gst_filing', label: 'GST Filing', sort_order: 1 },
    { key: 'gst_reconciliation', label: 'GST Reconciliation', sort_order: 2 },
    { key: 'income_tax_return', label: 'Income Tax Return', sort_order: 3 },
    { key: 'tds_tcs_filing', label: 'TDS / TCS Filing', sort_order: 4 },
    { key: 'statutory_audit', label: 'Statutory Audit', sort_order: 5 },
    { key: 'tax_audit', label: 'Tax Audit', sort_order: 6 },
    { key: 'internal_audit', label: 'Internal Audit', sort_order: 7 },
    { key: 'roc_mca_filing', label: 'ROC / MCA Filing', sort_order: 8 },
    { key: 'company_incorporation', label: 'Company Incorporation', sort_order: 9 },
    { key: 'accounts_bookkeeping', label: 'Accounts & Bookkeeping', sort_order: 10 },
    { key: 'payroll_processing', label: 'Payroll Processing', sort_order: 11 },
    { key: 'advisory_consultation', label: 'Advisory / Consultation', sort_order: 12 },
    { key: 'client_meeting', label: 'Client Meeting', sort_order: 13 },
    { key: 'internal_meeting', label: 'Internal Meeting', sort_order: 14 },
    { key: 'training_cpd', label: 'Training / CPD', sort_order: 15 },
    { key: 'fema_rbi_compliance', label: 'FEMA / RBI Compliance', sort_order: 16 },
    { key: 'administrative', label: 'Administrative', sort_order: 17 },
    { key: 'other', label: 'Other', sort_order: 18 }
  ],
  udin_assignment: [
    { key: 'certificate', label: 'Certificate', short_label: 'CERT', sort_order: 1 },
    { key: 'consultancy', label: 'Consultancy', short_label: 'CONS', sort_order: 2 },
    { key: 'professional_services', label: 'Professional Services', short_label: 'PS', sort_order: 3 }
  ],
  financial_year: [
    { key: '2024-25', label: '2024-25', short_label: '2024-25', sort_order: 1 },
    { key: '2025-26', label: '2025-26', short_label: '2025-26', sort_order: 2 },
    { key: '2026-27', label: '2026-27', short_label: '2026-27', sort_order: 3 }
  ]
};

function canManageMasters(req) {
  return req.user?.role === 'partner' || (Array.isArray(req.user?.permissions) && req.user.permissions.includes('access.manage'));
}

async function ensureMasterData() {
  const existing = await getMasterDataItems();
  if (existing.length) return;

  let batch = db.batch();
  let count = 0;
  for (const [category, items] of Object.entries(DEFAULT_MASTER_DATA)) {
    for (const item of items) {
      const ref = db.collection('master_data').doc();
      batch.set(ref, {
        category,
        key: item.key,
        label: item.label,
        short_label: item.short_label || null,
        sort_order: item.sort_order || 0,
        active: true
      });
      count++;
      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
  }
  if (count % 400 !== 0) await batch.commit();
  invalidateCache('master-data:all');
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
  if (!canManageMasters(req)) return res.status(403).json({ error: 'Access denied' });
  const { category } = req.params;
  if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid category' });
  const { key, label, short_label, sort_order, active } = req.body;
  if (!key || !label) return res.status(400).json({ error: 'Key and label are required' });

  try {
    const existing = await getMasterDataItems();
    const exists = existing.some(item => item.category === category && item.key === key);
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
  if (!canManageMasters(req)) return res.status(403).json({ error: 'Access denied' });
  const { category, id } = req.params;
  if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid category' });
  const { key, label, short_label, sort_order, active } = req.body;
  if (!key || !label) return res.status(400).json({ error: 'Key and label are required' });

  try {
    const existing = await getMasterDataItems();
    const exists = existing.some(item => item.id !== id && item.category === category && item.key === key);
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
