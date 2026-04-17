const express = require('express');
const router = express.Router();
const db = require('../js/database');
const { hasPermission } = require('../js/permissions');

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

const FEEDBACK_TEXT_QUESTION_IDS = {
  manager_feedback: ['wl5', 'gi4', 'mb5', 'cu5', 'ov5'],
  article_feedback: ['ap4', 'ag4', 'ab4', 'ao3']
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
  return hasPermission(user, 'feedback.view');
}

function countWords(value) {
  const words = String(value || '').trim().match(/\S+/g);
  return words ? words.length : 0;
}

function validateFeedbackTextAnswers(feedbackType, answers = {}) {
  const questionIds = FEEDBACK_TEXT_QUESTION_IDS[feedbackType] || [];
  for (const questionId of questionIds) {
    const text = String(answers?.[questionId] || '').trim();
    if (countWords(text) < 20) {
      return false;
    }
  }
  return true;
}

router.get('/status', (req, res) => {
  const available_types = availableTypesForUser(req.user);
  const rows = db.prepare(`
    SELECT feedback_type
    FROM feedback_submissions
    WHERE submitted_by_user_id = ?
  `).all(req.user.id);
  res.json({
    available_types,
    submitted_types: rows.map(row => row.feedback_type).filter(Boolean)
  });
});

router.post('/submit', (req, res) => {
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
  if (!validateFeedbackTextAnswers(feedbackType, answers)) {
    return res.status(400).json({ error: 'Each text response must be at least 20 words long' });
  }

  try {
    const existing = db.prepare(`
      SELECT id
      FROM feedback_submissions
      WHERE feedback_type = ? AND submitted_by_user_id = ?
      LIMIT 1
    `).get(feedbackType, req.user.id);
    if (existing) {
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
      submitted_date: currentIndiaDate()
    };

    const result = db.prepare(`
      INSERT INTO feedback_submissions (
        feedback_type,
        submitted_by_user_id,
        submitted_by_name,
        submitted_by_username,
        submitted_by_role,
        submitted_by_designation,
        payload_json,
        submitted_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.feedback_type,
      payload.submitted_by_user_id,
      payload.submitted_by_name,
      payload.submitted_by_username,
      payload.submitted_by_role,
      payload.submitted_by_designation,
      payload.payload_json,
      payload.submitted_date
    );

    res.json({
      success: true,
      id: result.lastInsertRowid,
      feedback_type: feedbackType
    });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Feedback already submitted' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/reports', (req, res) => {
  if (!canViewFeedbackReports(req.user)) {
    return res.status(403).json({ error: 'Feedback report access required' });
  }

  const feedbackType = String(req.query.type || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  let query = `
    SELECT id, feedback_type, payload_json, submitted_date, submitted_at
    FROM feedback_submissions
    WHERE 1=1
  `;
  const params = [];
  if (feedbackType && FEEDBACK_TYPES[feedbackType]) {
    query += ' AND feedback_type = ?';
    params.push(feedbackType);
  }
  if (from) {
    query += ' AND submitted_date >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND submitted_date <= ?';
    params.push(to);
  }
  query += ' ORDER BY submitted_date DESC, id DESC';

  const rows = db.prepare(query).all(...params).map(sanitizeSubmission);
  res.json({
    type: feedbackType || '',
    label: FEEDBACK_TYPES[feedbackType]?.label || 'All feedback',
    count: rows.length,
    responses: rows
  });
});

module.exports = router;
