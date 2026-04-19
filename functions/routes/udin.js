const express = require('express');
const multer = require('multer');
const { db, admin } = require('../db');
const { getUsersMap, getUdinLocationMasterItems, invalidateCacheByPrefix } = require('../data-cache');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const COL = {
  requests: 'udin_requests',
  audit: 'udin_audit_log'
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeRole(role) {
  return normalizeLower(role);
}

function hasPermission(req, permission) {
  return Array.isArray(req.user?.permissions) && req.user.permissions.includes(permission);
}

function canViewOwn(req) {
  return hasPermission(req, 'udin.view_own') || hasPermission(req, 'udin.create') || hasPermission(req, 'udin.dashboard.view');
}

function canCreate(req) {
  return hasPermission(req, 'udin.create') || hasPermission(req, 'udin.dashboard.view');
}

function canReview(req) {
  return hasPermission(req, 'udin.review');
}

function canUpdate(req) {
  return hasPermission(req, 'udin.update');
}

function canRevoke(req) {
  return hasPermission(req, 'udin.revoke');
}

function canAccessUdin(req) {
  return canViewOwn(req) || canReview(req);
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
    iso: new Date().toISOString()
  };
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function daysBetween(startDate, endDate) {
  const a = new Date(`${startDate}T00:00:00Z`);
  const b = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function toStatusLabel(status) {
  const normalized = normalizeLower(status);
  const map = {
    draft: 'Draft',
    pending_review: 'Pending Review',
    approved: 'Approved',
    rejected: 'Rejected',
    udin_updated: 'UDIN Updated',
    revocation_pending: 'Revocation Pending',
    revoked: 'Revoked'
  };
  return map[normalized] || normalizeText(status) || 'Draft';
}

function isRevocable(request) {
  if (!request || normalizeLower(request.workflow_status) === 'revoked') return false;
  if (!request.udin_generation_date) return false;
  const today = currentIndiaDateTimeParts().date;
  const diff = daysBetween(request.udin_generation_date, today);
  return diff != null && diff >= 0 && diff <= 3;
}

function requestKeyParts(request) {
  return [
    request.original_revised || '',
    request.entity_name || '',
    request.assignment_type || '',
    request.folder_number || '',
    request.financial_year || ''
  ].join('|');
}

function buildInternalReference(request) {
  const source = normalizeText(request.unique_id) || normalizeText(
    [
      request.assignment_type_short || request.assignment_type || '',
      request.location_short_name || request.location || '',
      request.financial_year || '',
      request.entity_short_name || request.entity_name || '',
      request.folder_number || ''
    ].filter(Boolean).join('/')
  );
  return source
    .replaceAll('/', '-')
    .replaceAll('(', '_')
    .replaceAll(')', '');
}

async function audit(action, requestId, actor, payload = {}) {
  await db.collection(COL.audit).add({
    request_id: requestId,
    action,
    actor_user_id: actor?.id || null,
    actor_name: actor?.name || actor?.username || 'system',
    actor_role: actor?.role || 'system',
    payload,
    created_at: new Date().toISOString()
  });
}

async function getLookupMaps() {
  const [usersMap, locations] = await Promise.all([
    getUsersMap(),
    getUdinLocationMasterItems()
  ]);
  const locationById = new Map();
  locations.forEach(item => {
    locationById.set(String(item.id), item);
  });
  return { usersMap, locationById };
}

function hydrateRequest(id, data, usersMap, locationById) {
  const creator = data.entered_by_user_id ? usersMap.get(String(data.entered_by_user_id)) : null;
  const reviewer = data.reviewed_by_user_id ? usersMap.get(String(data.reviewed_by_user_id)) : null;
  const initiator = data.initiated_by_user_id ? usersMap.get(String(data.initiated_by_user_id)) : null;
  const location = data.location_id ? locationById.get(String(data.location_id)) : null;
  const generatedDate = data.udin_generation_date || '';
  return {
    id,
    ...data,
    display_name: data.party_name || data.entity_name || data.unique_id || id,
    approval_status: data.approval_status || toStatusLabel(data.workflow_status),
    workflow_status: data.workflow_status || 'draft',
    date_of_request: data.date_of_request || '',
    entered_by_name: creator?.name || data.entered_by_name || '',
    initiated_by_name: initiator?.name || data.initiated_by_name || '',
    reviewed_by_name: reviewer?.name || data.reviewed_by_name || '',
    location_name: location?.location || location?.name || data.location_name || '',
    location_label: location?.location || location?.name || data.location_name || '',
    location_short_name: data.location_short_name || '',
    entity_short_name: data.entity_short_name || '',
    assignment_type_short: data.assignment_type_short || '',
    internal_reference_for_udin: data.internal_reference_for_udin || buildInternalReference(data),
    revocable: isRevocable(data),
    days_since_udin: generatedDate ? daysBetween(generatedDate, currentIndiaDateTimeParts().date) : null,
    copy_of_certificate_url: data.copy_of_certificate_storage_path ? `/api/udin/files/${id}/copy_of_certificate` : ''
  };
}

async function listRequests({ scope, status, query, userId }) {
  const { usersMap, locationById } = await getLookupMaps();
  const snapshot = await db.collection(COL.requests).get();
  const rows = [];

  snapshot.forEach(doc => {
    const data = doc.data() || {};
    const hydrated = hydrateRequest(doc.id, data, usersMap, locationById);
    if (scope === 'mine' && String(data.entered_by_user_id) !== String(userId) && String(data.initiated_by_user_id) !== String(userId)) {
      return;
    }
    if (scope === 'review' && hydrated.workflow_status !== 'pending_review') return;
    if (scope === 'updates' && !['approved', 'udin_updated', 'revocation_pending'].includes(hydrated.workflow_status)) return;
    if (scope === 'revocable' && !isRevocable(hydrated)) return;
    if (status && normalizeLower(hydrated.workflow_status) !== normalizeLower(status)) return;
    if (query) {
      const haystack = [
        hydrated.unique_id,
        hydrated.entity_name,
        hydrated.party_name,
        hydrated.assignment_type,
        hydrated.udin,
        hydrated.internal_reference_for_udin,
        hydrated.workflow_status,
        hydrated.approval_status
      ].join(' ').toLowerCase();
      if (!haystack.includes(query)) return;
    }
    rows.push(hydrated);
  });

  rows.sort((a, b) => String(b.date_of_request || '').localeCompare(String(a.date_of_request || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return rows;
}

function deriveSummary(rows) {
  const summary = {
    total: rows.length,
    pending_review: 0,
    approved: 0,
    needs_udin: 0,
    signed_copy_pending: 0,
    revocable: 0,
    revoked: 0
  };

  for (const row of rows) {
    const status = normalizeLower(row.workflow_status);
    if (status === 'pending_review') summary.pending_review += 1;
    if (status === 'approved' || status === 'udin_updated') summary.approved += 1;
    if (status === 'revoked') summary.revoked += 1;
    if (status !== 'revoked' && !row.udin) summary.needs_udin += 1;
    if (status !== 'revoked' && row.udin && !row.copy_of_certificate_storage_path) summary.signed_copy_pending += 1;
    if (isRevocable(row)) summary.revocable += 1;
  }

  return summary;
}

async function uniqueIdExists(uniqueId, excludeId = null) {
  const snapshot = await db.collection(COL.requests).where('unique_id', '==', uniqueId).get();
  return snapshot.docs.some(doc => doc.id !== excludeId);
}

router.get('/summary', async (req, res) => {
  if (!canAccessUdin(req)) {
    return res.status(403).json({ error: 'Permission required: udin.view_own' });
  }

  try {
    const rows = await listRequests({
      scope: req.query.scope || 'all',
      status: req.query.status || '',
      query: normalizeLower(req.query.q),
      userId: req.user.id
    });
    const summary = deriveSummary(rows);
    res.json({
      summary,
      recent: rows.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  if (!canAccessUdin(req)) {
    return res.status(403).json({ error: 'Permission required: udin.view_own' });
  }

  try {
    const scope = normalizeLower(req.query.scope || 'all');
    const rows = await listRequests({
      scope,
      status: req.query.status || '',
      query: normalizeLower(req.query.q),
      userId: req.user.id
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/files/:id/:field', async (req, res) => {
  if (!canAccessUdin(req)) {
    return res.status(403).json({ error: 'Permission required: udin.view_own' });
  }

  try {
    const doc = await db.collection(COL.requests).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'UDIN request not found' });
    const data = doc.data() || {};
    const storagePath = data[`${req.params.field}_storage_path`];
    if (!storagePath) return res.status(404).json({ error: 'File not found' });

    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) return res.status(404).json({ error: 'File not found' });

    const [metadata] = await file.getMetadata();
    res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(metadata.metadata?.originalName || req.params.field)}"`);
    file.createReadStream().on('error', error => {
      res.status(500).json({ error: error.message });
    }).pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  if (!canAccessUdin(req)) {
    return res.status(403).json({ error: 'Permission required: udin.view_own' });
  }

  try {
    const doc = await db.collection(COL.requests).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'UDIN request not found' });
    const { usersMap, locationById } = await getLookupMaps();
    res.json(hydrateRequest(doc.id, doc.data() || {}, usersMap, locationById));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  if (!canCreate(req)) {
    return res.status(403).json({ error: 'Permission required: udin.create' });
  }

  try {
    const uniqueId = normalizeText(req.body?.unique_id);
    const entityName = normalizeText(req.body?.entity_name);
    const assignmentType = normalizeText(req.body?.assignment_type);
    const folderNumber = normalizeText(req.body?.folder_number);
    const financialYear = normalizeText(req.body?.financial_year);
    const partyName = normalizeText(req.body?.party_name);

    if (!uniqueId || !entityName || !assignmentType || !partyName) {
      return res.status(400).json({ error: 'Unique ID, entity name, assignment type, and party name are required' });
    }

    if (await uniqueIdExists(uniqueId)) {
      return res.status(400).json({ error: 'Unique ID already exists' });
    }

    const current = currentIndiaDateTimeParts();
    const locationId = normalizeText(req.body?.location_id);
    const { locationById } = await getLookupMaps();
    const location = locationId ? locationById.get(String(locationId)) : null;
    const requestData = {
      original_revised: normalizeText(req.body?.original_revised || 'Original'),
      unique_id: uniqueId,
      date_of_request: normalizeText(req.body?.date_of_request || current.date),
      entity_name: entityName,
      entity_short_name: normalizeText(req.body?.entity_short_name || ''),
      branch: normalizeText(req.body?.branch),
      assignment_type: assignmentType,
      assignment_type_short: normalizeText(req.body?.assignment_type_short || ''),
      entered_by_user_id: req.user.id,
      entered_by_name: req.user.name || req.user.username || '',
      location_id: locationId || '',
      location_name: location?.location || location?.name || normalizeText(req.body?.location_name),
      location_short_name: normalizeText(req.body?.location_short_name || ''),
      party_name: partyName,
      folder_number: folderNumber,
      financial_year: normalizeText(req.body?.financial_year),
      path_for_documentation: normalizeText(req.body?.path_for_documentation),
      initiated_by_user_id: normalizeText(req.body?.initiated_by_user_id || req.user.id),
      initiated_by_name: normalizeText(req.body?.initiated_by_name || req.user.name || req.user.username || ''),
      original_udin: normalizeText(req.body?.original_udin),
      original_income_tax_acknowledgement_number: normalizeText(req.body?.original_income_tax_acknowledgement_number),
      internal_reference_for_udin: '',
      remittance_approver: normalizeText(req.body?.remittance_approver),
      approval_status: 'Pending Review',
      workflow_status: 'pending_review',
      udin: '',
      udin_generation_date: '',
      revocation: '',
      revocation_reason: '',
      revocation_requested_by_user_id: '',
      revocation_requested_at: '',
      copy_of_certificate_storage_path: '',
      copy_of_certificate_name: '',
      income_tax_acknowledgement_storage_path: '',
      income_tax_acknowledgement_name: '',
      created_at: current.iso,
      updated_at: current.iso
    };
    requestData.internal_reference_for_udin = buildInternalReference(requestData);

    const docRef = await db.collection(COL.requests).doc();
    await docRef.set(requestData);
    await audit('create', docRef.id, req.user, requestData);

    res.json({
      id: docRef.id,
      ...hydrateRequest(docRef.id, requestData, new Map([[req.user.id, req.user]]), new Map())
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  if (!canUpdate(req) && !canCreate(req)) {
    return res.status(403).json({ error: 'Permission required: udin.update' });
  }

  try {
    const ref = db.collection(COL.requests).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'UDIN request not found' });
    const existing = doc.data() || {};
    if (String(existing.entered_by_user_id) !== String(req.user.id) && normalizeRole(req.user.role) !== 'partner' && !canReview(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (['approved', 'udin_updated', 'revocation_pending', 'revoked'].includes(normalizeLower(existing.workflow_status)) && !canReview(req) && normalizeRole(req.user.role) !== 'partner') {
      return res.status(400).json({ error: 'Approved requests can only be changed by reviewers or partners' });
    }

    const { locationById } = await getLookupMaps();
    const locationId = normalizeText(req.body?.location_id || existing.location_id);
    const location = locationId ? locationById.get(String(locationId)) : null;
    const updates = {
      original_revised: normalizeText(req.body?.original_revised || existing.original_revised),
      entity_name: normalizeText(req.body?.entity_name || existing.entity_name),
      entity_short_name: normalizeText(req.body?.entity_short_name || existing.entity_short_name),
      branch: normalizeText(req.body?.branch || existing.branch),
      assignment_type: normalizeText(req.body?.assignment_type || existing.assignment_type),
      assignment_type_short: normalizeText(req.body?.assignment_type_short || existing.assignment_type_short),
      location_id: locationId,
      location_name: location?.location || location?.name || normalizeText(req.body?.location_name || existing.location_name),
      location_short_name: normalizeText(req.body?.location_short_name || existing.location_short_name),
      party_name: normalizeText(req.body?.party_name || existing.party_name),
      folder_number: normalizeText(req.body?.folder_number || existing.folder_number),
      financial_year: normalizeText(req.body?.financial_year || existing.financial_year),
      path_for_documentation: normalizeText(req.body?.path_for_documentation || existing.path_for_documentation),
      original_udin: normalizeText(req.body?.original_udin || existing.original_udin),
      original_income_tax_acknowledgement_number: normalizeText(req.body?.original_income_tax_acknowledgement_number || existing.original_income_tax_acknowledgement_number),
      remittance_approver: normalizeText(req.body?.remittance_approver || existing.remittance_approver),
      updated_at: new Date().toISOString()
    };
    updates.internal_reference_for_udin = buildInternalReference({ ...existing, ...updates });
    await ref.update(updates);
    await audit('update', req.params.id, req.user, updates);
    const updated = await ref.get();
    const { usersMap, locationById: refreshedLocationById } = await getLookupMaps();
    res.json(hydrateRequest(updated.id, updated.data() || {}, usersMap, refreshedLocationById));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/review', async (req, res) => {
  if (!canReview(req)) {
    return res.status(403).json({ error: 'Permission required: udin.review' });
  }

  try {
    const action = normalizeLower(req.body?.action);
    const comment = normalizeText(req.body?.comment || req.body?.rejection_reason);
    const ref = db.collection(COL.requests).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'UDIN request not found' });
    const existing = doc.data() || {};
    if (action === 'approve') {
      await ref.update({
        workflow_status: 'approved',
        approval_status: 'Approved',
        reviewed_by_user_id: req.user.id,
        reviewed_by_name: req.user.name || req.user.username || '',
        reviewed_at: new Date().toISOString(),
        rejection_reason: '',
        updated_at: new Date().toISOString()
      });
      await audit('approve', req.params.id, req.user, { comment });
      return res.json({ success: true });
    }
    if (action === 'reject') {
      await ref.update({
        workflow_status: 'rejected',
        approval_status: 'Rejected',
        reviewed_by_user_id: req.user.id,
        reviewed_by_name: req.user.name || req.user.username || '',
        reviewed_at: new Date().toISOString(),
        rejection_reason: comment || 'Rejected without reason',
        updated_at: new Date().toISOString()
      });
      await audit('reject', req.params.id, req.user, { comment });
      return res.json({ success: true });
    }
    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/update', async (req, res) => {
  if (!canUpdate(req)) {
    return res.status(403).json({ error: 'Permission required: udin.update' });
  }

  try {
    const ref = db.collection(COL.requests).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'UDIN request not found' });
    const existing = doc.data() || {};
    const udin = normalizeText(req.body?.udin);
    if (!udin) return res.status(400).json({ error: 'UDIN is required' });

    const updates = {
      udin,
      udin_generation_date: normalizeText(req.body?.udin_generation_date || currentIndiaDateTimeParts().date),
      approval_status: 'UDIN Updated',
      workflow_status: existing.workflow_status === 'revocation_pending' ? 'revocation_pending' : 'udin_updated',
      updated_at: new Date().toISOString()
    };

    await ref.update(updates);
    await audit('update_udin', req.params.id, req.user, updates);
    const updated = await ref.get();
    const { usersMap, locationById } = await getLookupMaps();
    res.json(hydrateRequest(updated.id, updated.data() || {}, usersMap, locationById));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/upload', upload.fields([
  { name: 'copy_of_certificate', maxCount: 1 },
  { name: 'income_tax_acknowledgement', maxCount: 1 }
]), async (req, res) => {
  if (!canUpdate(req)) {
    return res.status(403).json({ error: 'Permission required: udin.update' });
  }

  try {
    const ref = db.collection(COL.requests).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'UDIN request not found' });
    const existing = doc.data() || {};
    const bucket = admin.storage().bucket();
    const uploadResults = {};

    for (const fieldName of ['copy_of_certificate', 'income_tax_acknowledgement']) {
      const file = req.files?.[fieldName]?.[0];
      if (!file) continue;
      const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const storagePath = `udin/${req.params.id}/${fieldName}-${Date.now()}-${safeName}`;
      const fileRef = bucket.file(storagePath);
      await fileRef.save(file.buffer, {
        metadata: {
          contentType: file.mimetype || 'application/octet-stream',
          metadata: {
            originalName: file.originalname
          }
        },
        resumable: false
      });
      uploadResults[`${fieldName}_storage_path`] = storagePath;
      uploadResults[`${fieldName}_name`] = file.originalname;
    }

    const updates = {
      ...uploadResults,
      updated_at: new Date().toISOString()
    };

    if (existing.workflow_status === 'approved' && existing.udin) {
      updates.workflow_status = 'udin_updated';
      updates.approval_status = 'UDIN Updated';
    }

    await ref.update(updates);
    await audit('upload', req.params.id, req.user, {
      fields: Object.keys(uploadResults)
    });

    const updated = await ref.get();
    const { usersMap, locationById } = await getLookupMaps();
    res.json(hydrateRequest(updated.id, updated.data() || {}, usersMap, locationById));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/revoke', async (req, res) => {
  if (!canRevoke(req)) {
    return res.status(403).json({ error: 'Permission required: udin.revoke' });
  }

  try {
    const ref = db.collection(COL.requests).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'UDIN request not found' });
    const existing = doc.data() || {};
    if (!isRevocable(existing) && normalizeRole(req.user.role) !== 'partner') {
      return res.status(400).json({ error: 'This UDIN is outside the revocation window' });
    }

    await ref.update({
      workflow_status: 'revoked',
      approval_status: 'Revoked',
      revocation: 'Revoked',
      revocation_reason: normalizeText(req.body?.reason || req.body?.comment || 'Revoked by user'),
      revocation_requested_by_user_id: req.user.id,
      revocation_requested_at: new Date().toISOString(),
      revoked_by_user_id: req.user.id,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    await audit('revoke', req.params.id, req.user, { reason: normalizeText(req.body?.reason || req.body?.comment || '') });
    const updated = await ref.get();
    const { usersMap, locationById } = await getLookupMaps();
    res.json(hydrateRequest(updated.id, updated.data() || {}, usersMap, locationById));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
