const AUTO_SUBMIT_TIME_ZONE = 'Asia/Kolkata';
const AUTO_SUBMIT_SOURCE = 'daily_8pm';
const DEFAULT_BATCH_SIZE = 400;

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function currentIndiaDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: AUTO_SUBMIT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isActiveUser(user = {}) {
  return user.active !== false && user.active !== 0 && user.active !== '0';
}

function canSubmitTimesheets(user = {}) {
  if (!isActiveUser(user)) return false;
  const role = normalizeRole(user.role);
  const permissions = Array.isArray(user.permissions) ? user.permissions.filter(Boolean) : [];
  if (permissions.length) return permissions.includes('timesheets.submit_own');
  return ['article', 'manager', 'partner'].includes(role);
}

function nextSubmissionStatus(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'manager' || normalizedRole === 'partner') return 'approved';
  return 'pending_manager';
}

function snapshotDocs(snapshot) {
  if (Array.isArray(snapshot?.docs)) return snapshot.docs;
  const docs = [];
  if (snapshot && typeof snapshot.forEach === 'function') snapshot.forEach(doc => docs.push(doc));
  return docs;
}

function buildSubmissionPlan({ entryDocs = [], usersById = new Map(), submissionDate, submittedAt }) {
  const summary = {
    date: submissionDate,
    scanned: entryDocs.length,
    drafts: 0,
    submitted: 0,
    pending_manager: 0,
    approved: 0,
    skipped_time_confirmation: 0,
    skipped_missing_user: 0,
    skipped_inactive_user: 0,
    skipped_permission: 0
  };
  const updates = [];

  for (const doc of entryDocs) {
    const entry = doc.data();
    if (entry.entry_date !== submissionDate || entry.status !== 'draft') continue;
    summary.drafts += 1;

    if (entry.requires_time_confirmation) {
      summary.skipped_time_confirmation += 1;
      continue;
    }

    const user = usersById.get(String(entry.user_id || ''));
    if (!user) {
      summary.skipped_missing_user += 1;
      continue;
    }
    if (!isActiveUser(user)) {
      summary.skipped_inactive_user += 1;
      continue;
    }
    if (!canSubmitTimesheets(user)) {
      summary.skipped_permission += 1;
      continue;
    }

    const targetStatus = nextSubmissionStatus(user.role);
    const update = {
      status: targetStatus,
      rejection_reason: null,
      submission_source: AUTO_SUBMIT_SOURCE,
      submitted_at: submittedAt,
      updated_at: submittedAt
    };
    if (targetStatus === 'approved') {
      if (normalizeRole(user.role) === 'manager') update.approved_by_manager = String(entry.user_id);
      else update.approved_by_partner = String(entry.user_id);
    }

    updates.push({ ref: doc.ref, data: update });
    summary.submitted += 1;
    summary[targetStatus] += 1;
  }

  return { updates, summary };
}

async function commitInChunks(db, updates, batchSize = DEFAULT_BATCH_SIZE) {
  const safeBatchSize = Math.max(1, Math.min(450, Number(batchSize) || DEFAULT_BATCH_SIZE));
  let batchCount = 0;
  for (let offset = 0; offset < updates.length; offset += safeBatchSize) {
    const batch = db.batch();
    updates.slice(offset, offset + safeBatchSize).forEach(item => batch.update(item.ref, item.data));
    await batch.commit();
    batchCount += 1;
  }
  return batchCount;
}

async function submitDailyDrafts({ db, now = new Date(), date, logger = console, batchSize } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.batch !== 'function') {
    throw new Error('Firestore database connection is required');
  }

  const submissionDate = date || currentIndiaDate(now);
  const submittedAt = now.toISOString();
  const [entrySnapshot, userSnapshot] = await Promise.all([
    db.collection('timesheets').where('entry_date', '==', submissionDate).get(),
    db.collection('users').get()
  ]);
  const usersById = new Map(snapshotDocs(userSnapshot).map(doc => [String(doc.id), doc.data()]));
  const plan = buildSubmissionPlan({
    entryDocs: snapshotDocs(entrySnapshot),
    usersById,
    submissionDate,
    submittedAt
  });
  const batches = await commitInChunks(db, plan.updates, batchSize);
  const result = { ...plan.summary, batches };

  logger.info?.('[daily-draft-auto-submit]', result);
  return result;
}

module.exports = {
  AUTO_SUBMIT_SOURCE,
  AUTO_SUBMIT_TIME_ZONE,
  buildSubmissionPlan,
  canSubmitTimesheets,
  commitInChunks,
  currentIndiaDate,
  nextSubmissionStatus,
  submitDailyDrafts
};
