const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildWorkbookBuffer, readFirstWorksheetRows, rowsToCsv } = require('../functions/lib/spreadsheets');

const root = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

async function run() {
  const rootPackage = JSON.parse(read('package.json'));
  const functionsPackage = JSON.parse(read('functions/package.json'));
  assert.strictEqual(functionsPackage.engines.node, '22', 'Firebase Functions must target Node 22');
  for (const pkg of [rootPackage, functionsPackage]) {
    assert(!pkg.dependencies.xlsx, 'vulnerable xlsx package must not be present');
    assert(/^\^?2\./.test(pkg.dependencies.multer), 'Multer 2.x is required');
    assert(/^\^?5\./.test(pkg.dependencies['fast-xml-parser']), 'fast-xml-parser 5.x is required');
    assert(pkg.dependencies.exceljs, 'ExcelJS replacement is required');
  }
  assert(/^\^?14\./.test(functionsPackage.dependencies['firebase-admin']), 'Firebase Admin 14.x is required');
  assert(/^\^?7\.3\./.test(functionsPackage.dependencies['firebase-functions']), 'Firebase Functions 7.3.x is required');

  const codeFiles = [
    'functions/routes/attendance.js',
    'routes/attendance.js',
    'functions/routes/timesheet-masters.js',
    'routes/timesheet-masters.js'
  ];
  codeFiles.forEach(file => assert(!read(file).includes("require('xlsx')"), `${file} still imports xlsx`));

  for (const file of ['functions/routes/form15cb.js', 'functions/routes/udin.js', 'routes/udin.js', 'functions/routes/timesheet-masters.js', 'routes/timesheet-masters.js']) {
    const source = read(file);
    assert(source.includes('fileFilter'), `${file} is missing upload type filtering`);
    assert(source.includes('fileSize'), `${file} is missing an upload size limit`);
  }

  const firebaseDb = read('functions/db.js');
  assert(firebaseDb.includes("require('firebase-admin/firestore')"), 'Firebase Admin must use the modular Firestore API');
  assert(firebaseDb.includes('getFirestore(firebaseApp)'), 'Firestore must be initialized from the Firebase app');
  assert(!firebaseDb.includes('admin.firestore()'), 'legacy Firebase Admin namespace API must not return');

  const functionsTimesheets = read('functions/routes/timesheets.js');
  for (const permission of ['timesheets.view_own', 'timesheets.create_own', 'timesheets.edit_own', 'timesheets.delete_own', 'timesheets.submit_own']) {
    assert(functionsTimesheets.includes(permission), `Firebase timesheets missing ${permission} guard`);
  }
  assert(!functionsTimesheets.includes("existing.user_id !== req.user.id && normalizeRole(req.user.role) !== 'partner'"), 'role-based edit/delete bypass remains');
  assert(functionsTimesheets.includes("router.get('/suggestions'"), 'Firebase suggestion API is missing');
  assert(functionsTimesheets.includes("!hasPermission(req, 'timesheets.view_own') && !canViewAllTimesheets(req)"), 'view-all permission must satisfy the timesheet read gate');

  const suggestionBlock = functionsTimesheets.match(/const SUGGESTION_LOOKBACK_DAYS[\s\S]*?(?=function normalizeCollaborators)/);
  assert(suggestionBlock, 'suggestion scoring functions could not be extracted');
  assert(!suggestionBlock[0].includes('description:'), 'suggestions must not copy narrative descriptions');
  const sandbox = {
    normalizeWorkClassification: (value, billable) => value || (billable ? 'client_work' : 'internal'),
    Date,
    Map
  };
  vm.createContext(sandbox);
  vm.runInContext(suggestionBlock[0], sandbox);
  const iso = new Date().toISOString().slice(0, 10);
  const suggestions = sandbox.buildEntrySuggestions([
    { entry_date: iso, client_id: 'c1', client_name: 'Aster LLP', task_type: 'GST', work_classification: 'client_work', status: 'approved' },
    { entry_date: iso, client_id: 'c1', client_name: 'Aster LLP', task_type: 'GST', work_classification: 'client_work', status: 'draft' },
    { entry_date: iso, client_id: 'c1', client_name: 'Aster LLP', task_type: 'GST', work_classification: 'client_work', status: 'pending_manager' },
    { entry_date: iso, client_id: null, client_name: 'Internal / Admin', task_type: 'Admin', work_classification: 'internal', status: 'draft' }
  ]);
  assert.strictEqual(suggestions.length, 1);
  assert.strictEqual(suggestions[0].use_count, 3);
  assert.strictEqual(suggestions[0].confidence, 0.75);
  assert.strictEqual(sandbox.buildEntrySuggestions([]).length, 0);

  const timesheetHtml = read('public/timesheet.html');
  for (const token of ['quick-entry-panel', 'loadEntrySuggestions', 'openAddModal(${index})', "event.key.toLowerCase() === 'n'", "event.key === 'Enter'"]) {
    assert(timesheetHtml.includes(token), `quick-entry UX missing ${token}`);
  const collaborationEnd = timesheetHtml.indexOf('async function loadEntrySuggestions');
  const initStart = timesheetHtml.indexOf('async function initPage');
  assert(collaborationEnd > 0 && initStart > collaborationEnd, 'suggestion loader must be declared at page scope before init');
  assert(/renderCollaborationRequests\(\);\s*\}\s*async function loadEntrySuggestions/.test(timesheetHtml), 'suggestion loader is nested inside collaboration loading');
  }
  assert(timesheetHtml.includes("document.getElementById('modal-description').value = ''"), 'suggestion application must clear narrative text');
  const revampCss = read('public/css/revamp.css');
  assert(/\.quick-entry-panel\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s.test(revampCss), 'hidden quick-entry panels must not occupy layout space');

  const sourceRows = [
    { Date: '2026-07-29', Name: 'Asha Rao', Hours: 8.5, Status: 'Present' },
    { Date: '2026-07-30', Name: 'Dev, Kumar', Hours: 7.25, Status: 'Present' }
  ];
  const workbook = await buildWorkbookBuffer(sourceRows, 'Attendance');
  assert(Buffer.isBuffer(workbook) && workbook.length > 1000, 'Excel workbook was not generated');
  const parsed = await readFirstWorksheetRows(workbook);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].Name, 'Asha Rao');
  assert(rowsToCsv(sourceRows).includes('"Dev, Kumar"'), 'CSV escaping is incorrect');

  process.stdout.write('Reliability and quick-entry validation passed.\n');
}

run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
