const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getDefaultPermissions } = require('../js/permissions');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const htmlFiles = fs.readdirSync(publicDir).filter(file => file.endsWith('.html'));
const appSource = fs.readFileSync(path.join(publicDir, 'js', 'app.js'), 'utf8');
const failures = [];

function check(label, test) {
  try {
    test();
    process.stdout.write(`✓ ${label}\n`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    process.stderr.write(`✗ ${label}: ${error.message}\n`);
  }
}

check('shared application script parses', () => new vm.Script(appSource, { filename: 'public/js/app.js' }));

check('all HTML inline scripts parse beside the shared app', () => {
  for (const file of htmlFiles) {
    const source = fs.readFileSync(path.join(publicDir, file), 'utf8');
    const inlineScripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map(match => match[1])
      .filter(Boolean);
    for (const [index, inline] of inlineScripts.entries()) {
      const combined = source.includes('/js/app.js') ? `${appSource}\n${inline}` : inline;
      new vm.Script(combined, { filename: `${file}:inline-${index + 1}` });
    }
  }
});

check('every product screen loads the revamp stylesheet', () => {
  const excluded = new Set();
  const missing = htmlFiles.filter(file => !excluded.has(file))
    .filter(file => !fs.readFileSync(path.join(publicDir, file), 'utf8').includes('/css/revamp.css'));
  assert.deepStrictEqual(missing, []);
});

check('workspace chooser exposes three direct workspace actions', () => {
  const source = fs.readFileSync(path.join(publicDir, 'module-select.html'), 'utf8');
  assert.strictEqual((source.match(/data-module=/g) || []).length, 3);
  assert(!source.includes('continue-module-btn'), 'legacy dropdown/continue flow remains');
});

check('top bars no longer duplicate workspace switching', () => {
  const offenders = htmlFiles.filter(file => {
    const source = fs.readFileSync(path.join(publicDir, file), 'utf8');
    return /topbar-actions[\s\S]{0,500}href="\/module-select\.html"/.test(source);
  });
  assert.deepStrictEqual(offenders, []);
});

check('shared navigation uses one factory and four thin context wrappers', () => {
  assert(appSource.includes('function createSidebarHTML'));
  assert.strictEqual((appSource.match(/function (?:TIMESHEET_|FORM15CB_|FIRM_)?SIDEBAR_HTML/g) || []).length, 4);
  assert(!appSource.includes('injectModuleSwitcher()'));
});

check('partner and manager receive full UDIN workflow permissions', () => {
  for (const role of ['partner', 'manager']) {
    const permissions = getDefaultPermissions(role);
    for (const permission of ['udin.view_own', 'udin.create', 'udin.update', 'udin.review', 'udin.revoke', 'udin.dashboard.view']) {
      assert(permissions.includes(permission), `${role} missing ${permission}`);
    }
  }
});

check('article UDIN access stays limited to view/create/dashboard', () => {
  const permissions = getDefaultPermissions('article');
  assert(permissions.includes('udin.view_own'));
  assert(permissions.includes('udin.create'));
  assert(permissions.includes('udin.dashboard.view'));
  for (const denied of ['udin.update', 'udin.review', 'udin.revoke']) {
    assert(!permissions.includes(denied), `article unexpectedly receives ${denied}`);
  }
});

check('SQLite and Firebase UDIN route guards remain represented', () => {
  for (const relative of ['routes/udin.js', 'functions/routes/udin.js']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const permission of ['udin.view_own', 'udin.create', 'udin.update', 'udin.review', 'udin.revoke']) {
      assert(source.includes(permission), `${relative} missing ${permission}`);
    }
  }
});

check('mobile header actions stay touch-safe and inside the top bar', () => {
  const css = fs.readFileSync(path.join(publicDir, 'css', 'revamp.css'), 'utf8');
  assert(css.includes('.btn,.tab,.tab-btn{min-height:44px}'), 'mobile touch-target rule is missing');
  assert(css.includes('.topbar-actions-compact{width:auto;margin-left:auto;flex-wrap:nowrap}'), 'compact header action rule is missing');
  for (const relative of ['dashboard.html', 'form15cb.html']) {
    const source = fs.readFileSync(path.join(publicDir, relative), 'utf8');
    assert(source.includes('topbar-actions topbar-actions-compact'), `${relative} can wrap its primary action below the fixed mobile header`);
  }
});

check('visible form controls receive durable accessible names', () => {
  for (const token of [
    'function repairAccessibleControlLabels',
    'function bootAccessibleControlLabels',
    "accessibleLabelObserver.observe(document.body, { childList: true, subtree: true })"
  ]) {
    assert(appSource.includes(token), `form accessibility repair missing ${token}`);
  }
});

check('shared UI assets use explicit cache versions', () => {
  const unversioned = htmlFiles.filter(file => {
    const source = fs.readFileSync(path.join(publicDir, file), 'utf8');
    return source.includes('/js/app.js') && !source.includes('/js/app.js?v=15');
  });
  assert.deepStrictEqual(unversioned, []);
  const serviceWorker = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
  for (const asset of ['/js/app.js?v=15', '/css/focus-timer.css?v=3', '/js/focus-timer.js?v=3']) {
    assert(serviceWorker.includes(asset), `service worker is missing ${asset}`);
  }
});

check('work notes are mandatory for timer and manual entries', () => {
  const timesheet = fs.readFileSync(path.join(publicDir, 'timesheet.html'), 'utf8');
  assert(timesheet.includes('id="modal-description"'));
  assert(/id="modal-description"[^>]*\brequired\b/.test(timesheet), 'manual work note is not required in the form');
  assert(timesheet.includes("if (!payload.description)"), 'manual work note is not checked before save');
  for (const relative of ['routes/timer.js', 'functions/routes/timer.js', 'routes/timesheets.js', 'functions/routes/timesheets.js']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert(source.includes("Work note is required"), `${relative} does not enforce a work note`);
  }
});
check('dialogs use the shared responsive spacing contract', () => {
  const css = fs.readFileSync(path.join(publicDir, 'css', 'revamp.css'), 'utf8');
  for (const token of ['--dialog-edge-gap', '--dialog-gutter', '.modal>form', '.modal>.modal-actions']) {
    assert(css.includes(token), `dialog spacing contract missing ${token}`);
  }
});

check('time entry separates timeline and duration modes', () => {
  const source = fs.readFileSync(path.join(publicDir, 'timesheet.html'), 'utf8');
  for (const token of ['entry-mode-time', 'entry-mode-duration', "modalEntryMode === 'time'", 'recent-entry-suggestion']) {
    assert(source.includes(token), `time entry simplification missing ${token}`);
  }
});

check('access management defaults to role presets with optional overrides', () => {
  const source = fs.readFileSync(path.join(publicDir, 'users.html'), 'utf8');
  for (const token of ['ROLE_PRESET_COPY', 'applyRolePreset', 'Customize permissions', 'permission.label']) {
    assert(source.includes(token), `role preset UX missing ${token}`);
  }
  assert(!source.includes("permissionKey.split('.').slice(1)"), 'technical permission keys remain visible');
});

check('approval queue uses grouped selection without approve-all duplication', () => {
  const source = fs.readFileSync(path.join(publicDir, 'approvals.html'), 'utf8');
  assert(source.includes('groupApprovalEntries'));
  assert(source.includes('Select all visible'));
  assert(!source.includes('approveAll()'), 'legacy approve-all action remains');
  assert(!source.includes('>Approve All<'), 'legacy approve-all button remains');
});

check('approval grouping derives staff-day totals and review flags', () => {
  const source = fs.readFileSync(path.join(publicDir, 'approvals.html'), 'utf8');
  const block = source.match(/function approvalEntryFlags[\s\S]*?(?=function getSelected)/);
  assert(block, 'approval grouping functions could not be extracted');
  const sandbox = { normalizeWorkClassification: value => value };
  vm.createContext(sandbox);
  vm.runInContext(block[0], sandbox);
  const groups = sandbox.groupApprovalEntries([
    { id: 1, user_id: 7, staff_name: 'Asha', entry_date: '2026-07-28', hours: 10, description: '', work_classification: 'client_work', client_id: null },
    { id: 2, user_id: 7, staff_name: 'Asha', entry_date: '2026-07-28', hours: 1.5, description: 'Review', work_classification: 'internal', client_id: null }
  ]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].items.length, 2);
  assert.strictEqual(groups[0].totalHours, 11.5);
  assert.strictEqual(groups[0].flagCount, 3);
});
check('attendance uses one export menu and automatic refresh', () => {
  const source = fs.readFileSync(path.join(publicDir, 'attendance.html'), 'utf8');
  assert(source.includes('attendance-export-menu'));
  assert(source.includes('attendanceAutoRefresh'));
  assert(!source.includes('onclick="refreshAll()">Refresh</button>'), 'manual refresh still competes in the header');
});

check('permission overrides match across SQLite, Firebase, and browser sessions', () => {
  const source = fs.readFileSync(path.join(root, 'functions', 'routes', 'staff.js'), 'utf8');
  assert(source.includes('const selected = current.length ? current :'));
  assert(source.includes("selected.includes('firm.dashboard.view')"));
  assert(appSource.includes('current.length ? current : fallback'));
});
if (failures.length) {
  process.stderr.write(`\n${failures.length} validation check(s) failed.\n`);
  process.exit(1);
}
process.stdout.write(`\nRevamp validation passed for ${htmlFiles.length} HTML screens.\n`);