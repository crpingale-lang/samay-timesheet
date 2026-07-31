const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  AUTO_SUBMIT_SOURCE,
  buildSubmissionPlan,
  canSubmitTimesheets,
  currentIndiaDate,
  nextSubmissionStatus,
  submitDailyDrafts
} = require('../functions/lib/daily-draft-auto-submit');

function doc(id, data) {
  return { id, ref: { id }, data: () => ({ ...data }) };
}

function snapshot(docs) {
  return { docs, forEach: callback => docs.forEach(callback) };
}

function fakeFirestore({ entries, users }) {
  const committed = [];
  let commitCount = 0;
  return {
    committed,
    get commitCount() { return commitCount; },
    collection(name) {
      if (name === 'users') return { get: async () => snapshot(users) };
      if (name !== 'timesheets') throw new Error(`Unexpected collection ${name}`);
      return {
        where(field, operator, value) {
          assert.equal(field, 'entry_date');
          assert.equal(operator, '==');
          return { get: async () => snapshot(entries.filter(item => item.data().entry_date === value)) };
        }
      };
    },
    batch() {
      const pending = [];
      return {
        update(ref, data) { pending.push({ ref, data }); },
        async commit() {
          committed.push(...pending);
          commitCount += 1;
        }
      };
    }
  };
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const functionsIndex = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
  const firebaseTimesheets = fs.readFileSync(path.join(root, 'functions', 'routes', 'timesheets.js'), 'utf8');
  const timesheetPage = fs.readFileSync(path.join(root, 'public', 'timesheet.html'), 'utf8');
  const deploymentWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'firebase-hosting-merge.yml'), 'utf8');
  assert(functionsIndex.includes("exports.dailyDraftAutoSubmit = functions.pubsub"));
  assert(functionsIndex.includes(".schedule('0 20 * * *')"));
  assert(functionsIndex.includes(".schedule('5 20 * * *')"));
  assert(functionsIndex.includes(".timeZone('Asia/Kolkata')"));
  assert(functionsIndex.includes('getDailyDraftSubmitter().runDailyDraftAutoSubmit()'));
  assert(firebaseTimesheets.includes("submission_source: 'manual'"));
  assert(timesheetPage.includes('Auto-submit: daily at 8:00 PM IST'));
  assert(deploymentWorkflow.includes('deploy --only functions --project samay-timesheet --non-interactive'));
  assert(deploymentWorkflow.includes('needs: deploy_functions'));

  assert.equal(currentIndiaDate(new Date('2026-08-01T14:30:00.000Z')), '2026-08-01');
  assert.equal(nextSubmissionStatus('article'), 'pending_manager');
  assert.equal(nextSubmissionStatus('manager'), 'approved');
  assert.equal(nextSubmissionStatus('partner'), 'approved');
  assert.equal(canSubmitTimesheets({ role: 'article', active: true }), true);
  assert.equal(canSubmitTimesheets({ role: 'article', active: false }), false);
  assert.equal(canSubmitTimesheets({ role: 'article', active: true, permissions: ['timesheets.view_own'] }), false);

  const usersById = new Map([
    ['article-1', { role: 'article', active: true }],
    ['manager-1', { role: 'manager', active: true, permissions: ['timesheets.submit_own'] }],
    ['partner-1', { role: 'partner', active: true }],
    ['inactive-1', { role: 'article', active: false }],
    ['restricted-1', { role: 'article', active: true, permissions: ['timesheets.view_own'] }]
  ]);
  const plan = buildSubmissionPlan({
    entryDocs: [
      doc('a', { user_id: 'article-1', entry_date: '2026-08-01', status: 'draft' }),
      doc('m', { user_id: 'manager-1', entry_date: '2026-08-01', status: 'draft' }),
      doc('p', { user_id: 'partner-1', entry_date: '2026-08-01', status: 'draft' }),
      doc('confirm', { user_id: 'article-1', entry_date: '2026-08-01', status: 'draft', requires_time_confirmation: true }),
      doc('inactive', { user_id: 'inactive-1', entry_date: '2026-08-01', status: 'draft' }),
      doc('restricted', { user_id: 'restricted-1', entry_date: '2026-08-01', status: 'draft' }),
      doc('missing', { user_id: 'missing-1', entry_date: '2026-08-01', status: 'draft' }),
      doc('rejected', { user_id: 'article-1', entry_date: '2026-08-01', status: 'rejected' }),
      doc('old', { user_id: 'article-1', entry_date: '2026-07-31', status: 'draft' })
    ],
    usersById,
    submissionDate: '2026-08-01',
    submittedAt: '2026-08-01T14:30:00.000Z'
  });

  assert.equal(plan.summary.drafts, 7);
  assert.equal(plan.summary.submitted, 3);
  assert.equal(plan.summary.pending_manager, 1);
  assert.equal(plan.summary.approved, 2);
  assert.equal(plan.summary.skipped_time_confirmation, 1);
  assert.equal(plan.summary.skipped_inactive_user, 1);
  assert.equal(plan.summary.skipped_permission, 1);
  assert.equal(plan.summary.skipped_missing_user, 1);
  assert.equal(plan.updates[0].data.submission_source, AUTO_SUBMIT_SOURCE);
  assert.equal(plan.updates[0].data.status, 'pending_manager');
  assert.equal(plan.updates[1].data.approved_by_manager, 'manager-1');
  assert.equal(plan.updates[2].data.approved_by_partner, 'partner-1');

  const entries = Array.from({ length: 451 }, (_, index) => doc(`entry-${index}`, {
    user_id: 'article-1',
    entry_date: '2026-08-01',
    status: 'draft'
  }));
  const db = fakeFirestore({ entries, users: [doc('article-1', { role: 'article', active: true })] });
  const result = await submitDailyDrafts({
    db,
    now: new Date('2026-08-01T14:30:00.000Z'),
    batchSize: 400,
    logger: { info() {} }
  });
  assert.equal(result.submitted, 451);
  assert.equal(result.batches, 2);
  assert.equal(db.commitCount, 2);
  assert.equal(db.committed.length, 451);

  const secondRunDb = fakeFirestore({
    entries: entries.map(item => doc(item.id, { ...item.data(), status: 'pending_manager' })),
    users: [doc('article-1', { role: 'article', active: true })]
  });
  const secondRun = await submitDailyDrafts({
    db: secondRunDb,
    now: new Date('2026-08-01T14:31:00.000Z'),
    logger: { info() {} }
  });
  assert.equal(secondRun.submitted, 0);
  assert.equal(secondRun.batches, 0);

  process.stdout.write('Daily draft auto-submit flow passed.\n');
}

run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
