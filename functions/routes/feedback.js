const express = require('express');
const router = express.Router();
const { db } = require('../db');

const FEEDBACK_TYPES = {
  manager_feedback: {
    label: 'Managers Feedback',
    title: 'Feedback on management and firm culture'
  },
  article_feedback: {
    label: 'Articles Feedback',
    title: 'Feedback on articled assistants'
  }
};

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function currentIndiaDate() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function availableTypesForUser(user) {
  const role = normalizeRole(user?.role);
  if (role === 'article') return ['manager_feedback'];
  if (role === 'manager' || role === 'partner') return ['article_feedback'];
  return [];
}

function parsePayload(row) {
  try {
    const parsed = JSON.parse(row.payload_json || '{}');
    return parsed?.answers && typeof parsed.answers === 'object' ? parsed.answers : parsed;
  } catch {
    return {};
  }
}

function sanitizeSubmission(row) {
  return {
    id: row.id,
    feedback_type: row.feedback_type,
    submitted_date: row.submitted_date || '',
    submitted_at: row.submitted_at || '',
    answers: parsePayload(row)
  };
}

function canViewFeedbackReports(user) {
  return Array.isArray(user?.permissions) && user.permissions.includes('feedback.view');
}

router.get('/status', async (req, res) => {
  const available_types = availableTypesForUser(req.user);
  const snapshot = await db.collection('feedback_submissions')
    .where('submitted_by_user_id', '==', req.user.id)
    .get();
  res.json({
    available_types,
    submitted_types: snapshot.docs.map(doc => doc.data()?.feedback_type).filter(Boolean)
  });
});

router.post('/submit', async (req, res) => {
  const feedbackType = String(req.body?.feedback_type || '').trim();
  const answers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : null;
  if (!feedbackType || !FEEDBACK_TYPES[feedbackType]) {
    return res.status(400).json({ error: 'Select a valid feedback type' });
  }
  const allowedTypes = availableTypesForUser(req.user);
  if (!allowedTypes.includes(feedbackType)) {
    return res.status(403).json({ error: 'You are not allowed to submit this feedback type' });
  }
  if (!answers) {
    return res.status(400).json({ error: 'Feedback answers are required' });
  }

  try {
    const existing = await db.collection('feedback_submissions')
      .where('feedback_type', '==', feedbackType)
      .where('submitted_by_user_id', '==', req.user.id)
      .limit(1)
      .get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'Feedback already submitted' });
    }

    const payload = {
      feedback_type: feedbackType,
      submitted_by_user_id: req.user.id,
      submitted_by_name: req.user.name || '',
      submitted_by_username: req.user.username || '',
      submitted_by_role: normalizeRole(req.user.role),
      submitted_by_designation: req.user.designation || '',
      payload_json: JSON.stringify({ answers }),
      submitted_date: currentIndiaDate(),
      submitted_at: new Date().toISOString()
    };

    const docRef = await db.collection('feedback_submissions').add(payload);
    res.json({
      success: true,
      id: docRef.id,
      feedback_type: feedbackType
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/reports', async (req, res) => {
  if (!canViewFeedbackReports(req.user)) {
    return res.status(403).json({ error: 'Feedback report access required' });
  }

  const feedbackType = String(req.query.type || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  let query = db.collection('feedback_submissions');
  if (feedbackType && FEEDBACK_TYPES[feedbackType]) {
    query = query.where('feedback_type', '==', feedbackType);
  }
  if (from) {
    query = query.where('submitted_date', '>=', from);
  }
  if (to) {
    query = query.where('submitted_date', '<=', to);
  }

  const snapshot = await query.get();
  const rows = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(b.submitted_date || '').localeCompare(String(a.submitted_date || '')) || String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')))
    .map(sanitizeSubmission);

  res.json({
    type: feedbackType || '',
    label: FEEDBACK_TYPES[feedbackType]?.label || 'All feedback',
    count: rows.length,
    responses: rows
  });
});

module.exports = router;
