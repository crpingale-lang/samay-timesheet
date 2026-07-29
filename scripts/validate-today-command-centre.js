const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { MAX_TODAY_ACTIONS, buildDayContext, buildTodayActions, isWeekend } = require('../functions/lib/today-actions');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function ids(actions) {
  return actions.map(action => action.id);
}

assert.strictEqual(isWeekend('2026-08-01'), true, 'Saturday must be recognized as a weekend');
assert.strictEqual(isWeekend('2026-07-29'), false, 'Wednesday must remain a working weekday');
assert.deepStrictEqual(buildDayContext({ today: '2026-07-29', holiday_title: 'Firm Foundation Day' }), {
  date: '2026-07-29',
  is_weekend: false,
  is_holiday: true,
  is_workday: false,
  label: 'Firm Foundation Day'
});

const articleActions = buildTodayActions({
  today: '2026-07-29',
  permissions: [
    'timesheets.view_own', 'timesheets.create_own', 'timesheets.edit_own', 'timesheets.submit_own',
    'attendance.view_own', 'attendance.create_own'
  ],
  day_context: buildDayContext({ today: '2026-07-29' }),
  rejected_count: 2,
  draft_count: 3,
  pending_approvals: 99,
  pending_attendance_corrections: 88,
  pending_udin_reviews: 77,
  collaboration_requests: 1,
  today_entry_count: 0,
  attendance: { status: 'not_checked_in' }
});

assert.deepStrictEqual(ids(articleActions), [
  'fix-rejected-time',
  'check-in',
  'review-collaboration',
  'submit-drafts',
  'log-today'
]);
assert.strictEqual(articleActions.find(action => action.id === 'check-in').count, null, 'single-step attendance actions must not show redundant count badges');
assert.strictEqual(articleActions.find(action => action.id === 'log-today').count, null, 'single-step time actions must not show redundant count badges');
assert(!ids(articleActions).includes('review-timesheets'), 'article must not receive team approval action');
assert(!ids(articleActions).includes('review-attendance-corrections'), 'article must not receive correction approval action');
assert(!ids(articleActions).includes('review-udin'), 'article must not receive UDIN review action');

const managerActions = buildTodayActions({
  today: '2026-07-29',
  permissions: [
    'timesheets.view_own', 'timesheets.create_own', 'timesheets.edit_own', 'timesheets.submit_own',
    'attendance.create_own', 'attendance.approve_corrections', 'approvals.approve_manager', 'udin.review'
  ],
  day_context: buildDayContext({ today: '2026-07-29' }),
  rejected_count: 1,
  draft_count: 4,
  pending_approvals: 12,
  pending_attendance_corrections: 3,
  pending_udin_reviews: 6,
  collaboration_requests: 2,
  today_entry_count: 1,
  attendance: { status: 'checked_in', entry_time: '09:45' }
});

assert.strictEqual(managerActions.length, MAX_TODAY_ACTIONS, 'action list must stay capped');
assert.deepStrictEqual(ids(managerActions), [
  'fix-rejected-time',
  'complete-checkout',
  'review-timesheets',
  'review-attendance-corrections',
  'review-collaboration'
]);
assert.strictEqual(new Set(ids(managerActions)).size, managerActions.length, 'action IDs must be unique');

const weekendActions = buildTodayActions({
  today: '2026-08-01',
  permissions: ['timesheets.view_own', 'timesheets.create_own', 'attendance.create_own'],
  day_context: buildDayContext({ today: '2026-08-01' }),
  today_entry_count: 0,
  attendance: { status: 'not_checked_in' }
});
assert.deepStrictEqual(ids(weekendActions), ['review-today'], 'weekends must suppress false missing-work alerts');
assert.strictEqual(weekendActions[0].count, null, 'fallback action must not display a zero badge');

for (const action of [...articleActions, ...managerActions, ...weekendActions]) {
  assert(/^\/(?!\/)/.test(action.href), `action ${action.id} must use an internal application link`);
  for (const key of ['id', 'category', 'tone', 'title', 'description', 'href', 'action_label']) {
    assert(Object.prototype.hasOwnProperty.call(action, key), `action ${action.id} missing ${key}`);
  }
}

const localRoute = read('routes/timesheets.js');
const firebaseRoute = read('functions/routes/timesheets.js');
for (const source of [localRoute, firebaseRoute]) {
  assert(source.includes('buildTodayActions'), 'dashboard route must use the shared action builder');
  assert(source.includes('day_context'), 'dashboard route must expose day context');
  assert(source.includes('generated_at'), 'dashboard route must expose freshness metadata');
  assert(source.includes('attendance.approve_corrections'), 'dashboard route must permission-gate correction counts');
  assert(source.includes("hasPermission(req") || source.includes('hasPermission(req.user'), 'dashboard route permission checks are missing');
}

const dashboard = read('public/dashboard.html');
for (const token of ['today-command-card', 'today-action-list', 'renderTodayActions', 'safeInternalActionHref', 'context-attendance', 'loadStats({ force: true })']) {
  assert(dashboard.includes(token), `dashboard command centre missing ${token}`);
}
assert(dashboard.includes('Array.isArray(summary.actions)'), 'browser must render the server-provided action list');

const css = read('public/css/revamp.css');
for (const token of ['.today-command-card', '.today-action-item', '.today-context-grid', '@media (max-width: 900px)', '@media (max-width: 600px)']) {
  assert(css.includes(token), `responsive command-centre CSS missing ${token}`);
}

const myWork = read('public/my-timesheets.html');
assert(myWork.includes('allowedTimesheetStatuses.has(myTimesheetsUrlStatus)'), 'My Work must validate action-centre status deep links');
const udin = read('public/udin.html');
assert(udin.includes('allowedUdinScopes.has(udinUrlScope)'), 'UDIN must validate action-centre scope deep links');
const attendance = read('public/attendance.html');
assert(attendance.includes('id="corrections-section"'), 'attendance correction action needs a stable deep-link target');

const documentation = read('docs/TODAY_COMMAND_CENTRE.md');
assert(documentation.includes('No new database table'), 'current-data-first decision must be documented');
assert(documentation.includes('Data usage and lineage'), 'data lineage must be documented');
assert(documentation.includes('Test matrix'), 'deployment test matrix must be documented');

process.stdout.write('Today command centre validation passed.\n');
