const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getMasterDataItems, getLocationMasterItems, invalidateCache } = require('../data-cache');

const ALLOWED_CATEGORIES = new Set(['work_category', 'work_classification']);

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
  ]
};

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
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    radius_meters: Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : 50,
    active: item.active !== false && item.active !== 0 && item.active !== '0'
  };
}

async function listLocations() {
  const items = await getLocationMasterItems();
  return items
    .map(normalizeLocationItem)
    .filter(item => item.active && item.latitude != null && item.longitude != null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

router.get('/', async (req, res) => {
  try {
    await ensureMasterData();
    res.json({
      work_categories: await listCategory('work_category'),
      work_classifications: await listCategory('work_classification'),
      locations: await listLocations()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:category', async (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Partner only' });
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

router.put('/:category/:id', async (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Partner only' });
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

module.exports = router;
