const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getMasterDataItems, invalidateCacheByPrefix } = require('../data-cache');
const {
  buildDraftEntries,
  groupEntriesByDate,
  normalizeTimerInput
} = require('../lib/focus-timer-core');

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

function activeRef(userId) {
  return db.collection('time_sessions').doc(String(userId));
}

function activePayload(snapshot) {
  if (!snapshot?.exists) return null;
  const data = snapshot.data();
  return data.status === 'running' ? { id: snapshot.id, ...data } : null;
}

async function validateLinkedData(input) {
  if (!input.task_type) return 'Work category is required';
  const masters = await getMasterDataItems();
  const task = masters.find(item => (
    item.category === 'work_category' &&
    item.label === input.task_type &&
    item.active !== false &&
    item.active !== 0 &&
    item.active !== '0'
  ));
  if (!task) return 'Select an active work category';

  const classification = masters.find(item => (
    item.category === 'work_classification' &&
    item.key === input.work_classification &&
    item.active !== false &&
    item.active !== 0 &&
    item.active !== '0'
  ));
  if (!classification) return 'Select an active work classification';

  if (input.work_classification === 'client_work' && !input.client_id) {
    return 'Client is required for client work';
  }
  if (input.client_id) {
    const client = await db.collection('clients').doc(String(input.client_id)).get();
    if (
      !client.exists ||
      client.data().active === false ||
      client.data().active === 0 ||
      client.data().active === '0'
    ) {
      return 'Select an active client';
    }
  }
  return '';
}

async function clientSnapshot(clientId) {
  if (!clientId) return { name: null, code: null };
  const client = await db.collection('clients').doc(String(clientId)).get();
  if (!client.exists) return { name: null, code: null };
  return { name: client.data().name || null, code: client.data().code || null };
}

router.get('/active', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.view_own')) return;
  try {
    const snapshot = await activeRef(req.user.id).get();
    res.json({ active: activePayload(snapshot), server_now: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/start', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.create_own')) return;
  const input = normalizeTimerInput(req.body);
  try {
    const validationError = await validateLinkedData(input);
    if (validationError) return res.status(400).json({ error: validationError });
    const client = await clientSnapshot(input.client_id);
    const now = new Date().toISOString();
    const ref = activeRef(req.user.id);
    const active = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const existing = activePayload(snapshot);
      if (existing) {
        const conflict = new Error('A timer is already running');
        conflict.statusCode = 409;
        conflict.active = existing;
        throw conflict;
      }
      const payload = {
        user_id: req.user.id,
        session_id: crypto.randomUUID(),
        client_id: input.client_id ? String(input.client_id) : null,
        client_name: client.name,
        client_code: client.code,
        task_type: input.task_type,
        description: input.description,
        work_classification: input.work_classification,
        source: input.source,
        status: 'running',
        started_at: now,
        stopped_at: null,
        created_at: now,
        updated_at: now
      };
      transaction.set(ref, payload);
      return { id: ref.id, ...payload };
    });
    res.status(201).json({ active, server_now: now });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.message,
      active: error.active || undefined,
      server_now: new Date().toISOString()
    });
  }
});

router.post('/stop', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.create_own')) return;
  const finalDescription = req.body.description === undefined
    ? undefined
    : String(req.body.description || '').trim().slice(0, 2000);
  const stoppedAt = new Date().toISOString();
  const ref = activeRef(req.user.id);

  try {
    const result = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const session = activePayload(snapshot);
      if (!session) {
        const conflict = new Error('No running timer was found');
        conflict.statusCode = 409;
        throw conflict;
      }

      const existingSnapshot = await transaction.get(
        db.collection('timesheets').where('user_id', '==', req.user.id)
      );
      const existing = existingSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const description = finalDescription === undefined ? session.description : finalDescription;
      const drafts = buildDraftEntries(
        { ...session, description },
        stoppedAt,
        groupEntriesByDate(existing)
      );
      const entries = [];
      for (const draft of drafts.entries) {
        const entryRef = db.collection('timesheets').doc();
        const payload = {
          ...draft,
          user_id: req.user.id,
          worked_with_user_ids: [],
          requires_time_confirmation: false,
          created_at: stoppedAt,
          updated_at: stoppedAt
        };
        transaction.create(entryRef, payload);
        entries.push({ id: entryRef.id, ...payload });
      }
      transaction.update(ref, {
        description,
        status: 'stopped',
        stopped_at: stoppedAt,
        updated_at: stoppedAt
      });
      return {
        entries,
        warning: drafts.warning,
        elapsed_seconds: drafts.elapsed_seconds
      };
    });
    invalidateCacheByPrefix('dashboard:');
    res.json({
      success: true,
      entry_ids: result.entries.map(entry => entry.id),
      entries: result.entries,
      warning: result.warning,
      elapsed_seconds: result.elapsed_seconds
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/discard', async (req, res) => {
  if (!requirePermission(req, res, 'timesheets.create_own')) return;
  const stoppedAt = new Date().toISOString();
  const ref = activeRef(req.user.id);
  try {
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const session = activePayload(snapshot);
      if (!session) {
        const conflict = new Error('No running timer was found');
        conflict.statusCode = 409;
        throw conflict;
      }
      transaction.update(ref, {
        status: 'discarded',
        stopped_at: stoppedAt,
        updated_at: stoppedAt
      });
    });
    res.json({ success: true, stopped_at: stoppedAt });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

module.exports = router;
