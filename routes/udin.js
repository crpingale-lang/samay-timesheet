const express = require('express');
const multer = require('multer');
const db = require('../js/database');
const { hasPermission } = require('../js/permissions');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeRole(role) {
  return normalizeLower(role);
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

function buildInternalReference(request) {
  const source = normalizeText(request.unique_id) || normalizeText(
    [
      request.assignment_type_short || request.assignment_type || '',
      request.location_short_name || request.location_name || '',
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

function canViewOwn(req) {
  return hasPermission(req.user, 'udin.view_own') || hasPermission(req.user, 'udin.create') || hasPermission(req.user, 'udin.dashboard.view');
}

function canCreate(req) {
  return hasPermission(req.user, 'udin.create') || hasPermission(req.user, 'udin.dashboard.view');
}

function canReview(req) {
  return hasPermission(req.user, 'udin.review');
}

function canUpdate(req) {
  return hasPermission(req.user, 'udin.update');
}

function canRevoke(req) {
  return hasPermission(req.user, 'udin.revoke');
}

function canAccessUdin(req) {
  return canViewOwn(req) || canReview(req);
}

function loadLocationMap() {
  const rows = db.prepare(`
    SELECT id, location, radius_meters
    FROM location_master
    WHERE active = 1
    ORDER BY location ASC
  `).all();
  return new Map(rows.map(row => [String(row.id), row]));
}

function loadUserMap() {
  const rows = db.prepare(`
    SELECT id, name, username, role
    FROM users
    WHERE active = 1
  `).all();
  return new Map(rows.map(row => [String(row.id), row]));
}

function loadFilesByRequestIds(requestIds) {
  if (!requestIds.length) return new Map();
  const placeholders = requestIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT request_id, field_name, original_name, mime_type
    FROM udin_request_files
    WHERE request_id IN (${placeholders})
  `).all(...requestIds);
  const fileMap = new Map();
  for (const row of rows) {
    if (!fileMap.has(row.request_id)) fileMap.set(row.request_id, {});
    fileMap.get(row.request_id)[row.field_name] = row;
  }
  return fileMap;
}

function hydrateRequest(row, usersMap, locationMap, fileMap = {}) {
  const creator = row.entered_by_user_id ? usersMap.get(String(row.entered_by_user_id)) : null;
  const reviewer = row.reviewed_by_user_id ? usersMap.get(String(row.reviewed_by_user_id)) : null;
  const initiator = row.initiated_by_user_id ? usersMap.get(String(row.initiated_by_user_id)) : null;
  const location = row.location_id ? locationMap.get(String(row.location_id)) : null;
  const generatedDate = row.udin_generation_date || '';
  const copyFile = fileMap.copy_of_certificate || null;
  const ackFile = fileMap.income_tax_acknowledgement || null;

  return {
    ...row,
    id: String(row.id),
    display_name: row.party_name || row.entity_name || row.unique_id || String(row.id),
    approval_status: row.approval_status || toStatusLabel(row.workflow_status),
    workflow_status: row.workflow_status || 'draft',
    entered_by_name: creator?.name || row.entered_by_name || '',
    initiated_by_name: initiator?.name || row.initiated_by_name || '',
    reviewed_by_name: reviewer?.name || row.reviewed_by_name || '',
    location_name: location?.location || row.location_name || '',
    location_label: location?.location || row.location_name || '',
    internal_reference_for_udin: row.internal_reference_for_udin || buildInternalReference(row),
    revocable: isRevocable(row),
    days_since_udin: generatedDate ? daysBetween(generatedDate, currentIndiaDateTimeParts().date) : null,
    copy_of_certificate_storage_path: copyFile ? `/api/udin/files/${row.id}/copy_of_certificate` : '',
    copy_of_certificate_name: copyFile?.original_name || row.copy_of_certificate_name || '',
    income_tax_acknowledgement_storage_path: ackFile ? `/api/udin/files/${row.id}/income_tax_acknowledgement` : '',
    income_tax_acknowledgement_name: ackFile?.original_name || row.income_tax_acknowledgement_name || ''
  };
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
    if (row.revocable) summary.revocable += 1;
  }

  return summary;
}

function audit(action, requestId, actor, payload = {}) {
  db.prepare(`
    INSERT INTO udin_audit_log (request_id, action, actor_user_id, actor_name, actor_role, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    requestId,
    action,
    actor?.id || null,
    actor?.name || actor?.username || 'system',
    actor?.role || 'system',
    JSON.stringify(payload || {})
  );
}

function uniqueIdExists(uniqueId, excludeId = null) {
  const row = excludeId
    ? db.prepare('SELECT id FROM udin_requests WHERE unique_id = ? AND id != ?').get(uniqueId, excludeId)
    : db.prepare('SELECT id FROM udin_requests WHERE unique_id = ?').get(uniqueId);
  return !!row;
}

function getRequestOr404(id, res) {
  const row = db.prepare('SELECT * FROM udin_requests WHERE id = ?').get(id);
  if (!row) {
    res.status(404).json({ error: 'UDIN request not found' });
    return null;
  }
  return row;
}

function canEditRequest(req, existing) {
  if (String(existing.entered_by_user_id) === String(req.user.id)) return true;
  if (normalizeRole(req.user.role) === 'partner') return true;
  if (canReview(req)) return true;
  return false;
}

function listRequests({ scope, status, query, userId }) {
  const usersMap = loadUserMap();
  const locationMap = loadLocationMap();
  const rows = db.prepare(`
    SELECT *
    FROM udin_requests
    ORDER BY date_of_request DESC, created_at DESC
  `).all();
  const fileMapByRequest = loadFilesByRequestIds(rows.map(row => row.id));

  return rows
    .map(row => hydrateRequest(row, usersMap, locationMap, fileMapByRequest.get(row.id)))
    .filter(row => {
      if (scope === 'mine' && String(row.entered_by_user_id) !== String(userId) && String(row.initiated_by_user_id) !== String(userId)) {
        return false;
      }
      if (scope === 'review' && row.workflow_status !== 'pending_review') return false;
      if (scope === 'updates' && !['approved', 'udin_updated', 'revocation_pending'].includes(row.workflow_status)) return false;
      if (scope === 'revocable' && !row.revocable) return false;
      if (status && normalizeLower(row.workflow_status) !== normalizeLower(status)) return false;
      if (query) {
        const haystack = [
          row.unique_id,
          row.entity_name,
          row.party_name,
          row.assignment_type,
          row.udin,
          row.internal_reference_for_udin,
          row.workflow_status,
          row.approval_status
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
}

router.get('/summary', (req, res) => {
  if (!canAccessUdin(req)) {
    return res.status(403).json({ error: 'Permission required: udin.view_own' });
  }

  try {
    const rows = listRequests({
      scope: req.query.scope || 'all',
      status: req.query.status || '',
      query: normalizeLower(req.query.q),
      userId: req.user.id
    });
    res.json({
      summary: deriveSummary(rows),
      recent: rows.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', (req, res) => {
  if (!canAccessUdin(req)) {
    return res.status(403).json({ error: 'Permission required: udin.view_own' });
  }

  try {
    const rows = listRequests({
      scope: normalizeLower(req.query.scope || 'all'),
      status: req.query.status || '',
      query: normalizeLower(req.query.q),
      userId: req.user.id
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/files/:id/:field', (req, res) => {
  if (!canAccessUdin(req)) {
    return res.status(403).json({ error: 'Permission required: udin.view_own' });
  }

  try {
    const existing = getRequestOr404(req.params.id, res);
    if (!existing) return;

    const fieldName = normalizeText(req.params.field);
    if (!['copy_of_certificate', 'income_tax_acknowledgement'].includes(fieldName)) {
      return res.status(400).json({ error: 'Invalid field' });
    }

    const file = db.prepare(`
      SELECT original_name, mime_type, file_blob
      FROM udin_request_files
      WHERE request_id = ? AND field_name = ?
    `).get(existing.id, fieldName);

    if (!file) return res.status(404).json({ error: 'File not found' });

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name || fieldName)}"`);
    res.send(file.file_blob);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  if (!canAccessUdin(req)) {
    return res.status(403).json({ error: 'Permission required: udin.view_own' });
  }

  try {
    const existing = getRequestOr404(req.params.id, res);
    if (!existing) return;
    const fileMap = loadFilesByRequestIds([existing.id]).get(existing.id);
    res.json(hydrateRequest(existing, loadUserMap(), loadLocationMap(), fileMap));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  if (!canCreate(req)) {
    return res.status(403).json({ error: 'Permission required: udin.create' });
  }

  try {
    const uniqueId = normalizeText(req.body?.unique_id);
    const entityName = normalizeText(req.body?.entity_name);
    const assignmentType = normalizeText(req.body?.assignment_type);
    const partyName = normalizeText(req.body?.party_name);

    if (!uniqueId || !entityName || !assignmentType || !partyName) {
      return res.status(400).json({ error: 'Unique ID, entity name, assignment type, and party name are required' });
    }
    if (uniqueIdExists(uniqueId)) {
      return res.status(400).json({ error: 'Unique ID already exists' });
    }

    const current = currentIndiaDateTimeParts();
    const locationId = normalizeText(req.body?.location_id);
    const location = locationId ? loadLocationMap().get(locationId) : null;
    const requestData = {
      original_revised: normalizeText(req.body?.original_revised || 'Original'),
      unique_id: uniqueId,
      date_of_request: normalizeText(req.body?.date_of_request || current.date),
      entity_name: entityName,
      entity_short_name: normalizeText(req.body?.entity_short_name),
      branch: normalizeText(req.body?.branch),
      assignment_type: assignmentType,
      assignment_type_short: normalizeText(req.body?.assignment_type_short),
      entered_by_user_id: req.user.id,
      entered_by_name: req.user.name || req.user.username || '',
      location_id: locationId || null,
      location_name: location?.location || normalizeText(req.body?.location_name),
      location_short_name: normalizeText(req.body?.location_short_name),
      party_name: partyName,
      folder_number: normalizeText(req.body?.folder_number),
      financial_year: normalizeText(req.body?.financial_year),
      path_for_documentation: normalizeText(req.body?.path_for_documentation),
      initiated_by_user_id: req.user.id,
      initiated_by_name: normalizeText(req.body?.initiated_by_name || req.user.name || req.user.username || ''),
      original_udin: normalizeText(req.body?.original_udin),
      original_income_tax_acknowledgement_number: normalizeText(req.body?.original_income_tax_acknowledgement_number),
      internal_reference_for_udin: '',
      remittance_approver: normalizeText(req.body?.remittance_approver),
      approval_status: 'Pending Review',
      workflow_status: 'pending_review',
      reviewed_by_user_id: null,
      reviewed_by_name: '',
      reviewed_at: '',
      rejection_reason: '',
      udin: '',
      udin_generation_date: '',
      revocation: '',
      revocation_reason: '',
      revocation_requested_by_user_id: null,
      revocation_requested_at: '',
      revoked_by_user_id: null,
      revoked_at: '',
      copy_of_certificate_name: '',
      income_tax_acknowledgement_name: ''
    };
    requestData.internal_reference_for_udin = buildInternalReference(requestData);

    const columns = Object.keys(requestData);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(column => requestData[column]);
    const result = db.prepare(`
      INSERT INTO udin_requests (${columns.join(', ')}, created_at, updated_at)
      VALUES (${placeholders}, datetime('now'), datetime('now'))
    `).run(...values);

    audit('create', result.lastInsertRowid, req.user, requestData);
    const created = db.prepare('SELECT * FROM udin_requests WHERE id = ?').get(result.lastInsertRowid);
    res.json(hydrateRequest(created, loadUserMap(), loadLocationMap()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', (req, res) => {
  if (!canUpdate(req) && !canCreate(req)) {
    return res.status(403).json({ error: 'Permission required: udin.update' });
  }

  try {
    const existing = getRequestOr404(req.params.id, res);
    if (!existing) return;
    if (!canEditRequest(req, existing)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (['approved', 'udin_updated', 'revocation_pending', 'revoked'].includes(normalizeLower(existing.workflow_status)) && !canReview(req) && normalizeRole(req.user.role) !== 'partner') {
      return res.status(400).json({ error: 'Approved requests can only be changed by reviewers or partners' });
    }

    const proposedUniqueId = normalizeText(req.body?.unique_id || existing.unique_id);
    if (!proposedUniqueId) return res.status(400).json({ error: 'Unique ID is required' });
    if (uniqueIdExists(proposedUniqueId, existing.id)) {
      return res.status(400).json({ error: 'Unique ID already exists' });
    }

    const locationId = normalizeText(req.body?.location_id || existing.location_id);
    const location = locationId ? loadLocationMap().get(locationId) : null;
    const updates = {
      original_revised: normalizeText(req.body?.original_revised || existing.original_revised),
      unique_id: proposedUniqueId,
      date_of_request: normalizeText(req.body?.date_of_request || existing.date_of_request),
      entity_name: normalizeText(req.body?.entity_name || existing.entity_name),
      entity_short_name: normalizeText(req.body?.entity_short_name || existing.entity_short_name),
      branch: normalizeText(req.body?.branch || existing.branch),
      assignment_type: normalizeText(req.body?.assignment_type || existing.assignment_type),
      assignment_type_short: normalizeText(req.body?.assignment_type_short || existing.assignment_type_short),
      location_id: locationId || null,
      location_name: location?.location || normalizeText(req.body?.location_name || existing.location_name),
      location_short_name: normalizeText(req.body?.location_short_name || existing.location_short_name),
      party_name: normalizeText(req.body?.party_name || existing.party_name),
      folder_number: normalizeText(req.body?.folder_number || existing.folder_number),
      financial_year: normalizeText(req.body?.financial_year || existing.financial_year),
      path_for_documentation: normalizeText(req.body?.path_for_documentation || existing.path_for_documentation),
      original_udin: normalizeText(req.body?.original_udin || existing.original_udin),
      original_income_tax_acknowledgement_number: normalizeText(req.body?.original_income_tax_acknowledgement_number || existing.original_income_tax_acknowledgement_number),
      remittance_approver: normalizeText(req.body?.remittance_approver || existing.remittance_approver),
      initiated_by_name: normalizeText(req.body?.initiated_by_name || existing.initiated_by_name)
    };
    updates.internal_reference_for_udin = buildInternalReference({ ...existing, ...updates });

    db.prepare(`
      UPDATE udin_requests
      SET original_revised = ?, unique_id = ?, date_of_request = ?, entity_name = ?, entity_short_name = ?,
          branch = ?, assignment_type = ?, assignment_type_short = ?, location_id = ?, location_name = ?,
          location_short_name = ?, party_name = ?, folder_number = ?, financial_year = ?, path_for_documentation = ?,
          original_udin = ?, original_income_tax_acknowledgement_number = ?, remittance_approver = ?,
          initiated_by_name = ?, internal_reference_for_udin = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      updates.original_revised,
      updates.unique_id,
      updates.date_of_request,
      updates.entity_name,
      updates.entity_short_name,
      updates.branch,
      updates.assignment_type,
      updates.assignment_type_short,
      updates.location_id,
      updates.location_name,
      updates.location_short_name,
      updates.party_name,
      updates.folder_number,
      updates.financial_year,
      updates.path_for_documentation,
      updates.original_udin,
      updates.original_income_tax_acknowledgement_number,
      updates.remittance_approver,
      updates.initiated_by_name,
      updates.internal_reference_for_udin,
      existing.id
    );

    audit('update', existing.id, req.user, updates);
    const updated = db.prepare('SELECT * FROM udin_requests WHERE id = ?').get(existing.id);
    const fileMap = loadFilesByRequestIds([existing.id]).get(existing.id);
    res.json(hydrateRequest(updated, loadUserMap(), loadLocationMap(), fileMap));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/review', (req, res) => {
  if (!canReview(req)) {
    return res.status(403).json({ error: 'Permission required: udin.review' });
  }

  try {
    const action = normalizeLower(req.body?.action);
    const comment = normalizeText(req.body?.comment || req.body?.rejection_reason);
    const existing = getRequestOr404(req.params.id, res);
    if (!existing) return;

    if (action === 'approve') {
      db.prepare(`
        UPDATE udin_requests
        SET workflow_status = 'approved',
            approval_status = 'Approved',
            reviewed_by_user_id = ?,
            reviewed_by_name = ?,
            reviewed_at = ?,
            rejection_reason = '',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(req.user.id, req.user.name || req.user.username || '', new Date().toISOString(), existing.id);
      audit('approve', existing.id, req.user, { comment });
      return res.json({ success: true });
    }

    if (action === 'reject') {
      db.prepare(`
        UPDATE udin_requests
        SET workflow_status = 'rejected',
            approval_status = 'Rejected',
            reviewed_by_user_id = ?,
            reviewed_by_name = ?,
            reviewed_at = ?,
            rejection_reason = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(req.user.id, req.user.name || req.user.username || '', new Date().toISOString(), comment || 'Rejected without reason', existing.id);
      audit('reject', existing.id, req.user, { comment });
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/update', (req, res) => {
  if (!canUpdate(req)) {
    return res.status(403).json({ error: 'Permission required: udin.update' });
  }

  try {
    const existing = getRequestOr404(req.params.id, res);
    if (!existing) return;
    const udin = normalizeText(req.body?.udin);
    if (!udin) return res.status(400).json({ error: 'UDIN is required' });

    const generationDate = normalizeText(req.body?.udin_generation_date || currentIndiaDateTimeParts().date);
    const workflowStatus = existing.workflow_status === 'revocation_pending' ? 'revocation_pending' : 'udin_updated';
    db.prepare(`
      UPDATE udin_requests
      SET udin = ?,
          udin_generation_date = ?,
          approval_status = 'UDIN Updated',
          workflow_status = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(udin, generationDate, workflowStatus, existing.id);

    audit('update_udin', existing.id, req.user, { udin, udin_generation_date: generationDate });
    const updated = db.prepare('SELECT * FROM udin_requests WHERE id = ?').get(existing.id);
    const fileMap = loadFilesByRequestIds([existing.id]).get(existing.id);
    res.json(hydrateRequest(updated, loadUserMap(), loadLocationMap(), fileMap));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/upload', upload.fields([
  { name: 'copy_of_certificate', maxCount: 1 },
  { name: 'income_tax_acknowledgement', maxCount: 1 }
]), (req, res) => {
  if (!canUpdate(req)) {
    return res.status(403).json({ error: 'Permission required: udin.update' });
  }

  try {
    const existing = getRequestOr404(req.params.id, res);
    if (!existing) return;
    const fields = ['copy_of_certificate', 'income_tax_acknowledgement'];
    const replaceFile = db.prepare(`
      INSERT INTO udin_request_files (request_id, field_name, original_name, mime_type, file_blob, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(request_id, field_name) DO UPDATE SET
        original_name = excluded.original_name,
        mime_type = excluded.mime_type,
        file_blob = excluded.file_blob,
        updated_at = datetime('now')
    `);

    const uploadedFields = [];
    for (const fieldName of fields) {
      const file = req.files?.[fieldName]?.[0];
      if (!file) continue;
      replaceFile.run(existing.id, fieldName, file.originalname, file.mimetype || 'application/octet-stream', file.buffer);
      uploadedFields.push(fieldName);
    }

    if (!uploadedFields.length) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    db.prepare(`
      UPDATE udin_requests
      SET copy_of_certificate_name = COALESCE(?, copy_of_certificate_name),
          income_tax_acknowledgement_name = COALESCE(?, income_tax_acknowledgement_name),
          workflow_status = CASE
            WHEN workflow_status = 'approved' AND udin != '' THEN 'udin_updated'
            ELSE workflow_status
          END,
          approval_status = CASE
            WHEN workflow_status = 'approved' AND udin != '' THEN 'UDIN Updated'
            ELSE approval_status
          END,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      req.files?.copy_of_certificate?.[0]?.originalname || null,
      req.files?.income_tax_acknowledgement?.[0]?.originalname || null,
      existing.id
    );

    audit('upload', existing.id, req.user, { fields: uploadedFields });
    const updated = db.prepare('SELECT * FROM udin_requests WHERE id = ?').get(existing.id);
    const fileMap = loadFilesByRequestIds([existing.id]).get(existing.id);
    res.json(hydrateRequest(updated, loadUserMap(), loadLocationMap(), fileMap));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/revoke', (req, res) => {
  if (!canRevoke(req)) {
    return res.status(403).json({ error: 'Permission required: udin.revoke' });
  }

  try {
    const existing = getRequestOr404(req.params.id, res);
    if (!existing) return;
    if (!isRevocable(existing) && normalizeRole(req.user.role) !== 'partner') {
      return res.status(400).json({ error: 'This UDIN is outside the revocation window' });
    }

    const reason = normalizeText(req.body?.reason || req.body?.comment || 'Revoked by user');
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE udin_requests
      SET workflow_status = 'revoked',
          approval_status = 'Revoked',
          revocation = 'Revoked',
          revocation_reason = ?,
          revocation_requested_by_user_id = ?,
          revocation_requested_at = ?,
          revoked_by_user_id = ?,
          revoked_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(reason, req.user.id, now, req.user.id, now, existing.id);

    audit('revoke', existing.id, req.user, { reason });
    const updated = db.prepare('SELECT * FROM udin_requests WHERE id = ?').get(existing.id);
    const fileMap = loadFilesByRequestIds([existing.id]).get(existing.id);
    res.json(hydrateRequest(updated, loadUserMap(), loadLocationMap(), fileMap));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
