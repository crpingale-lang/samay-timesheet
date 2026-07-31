const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const {
  buildDraftEntries,
  groupEntriesByDate,
  normalizeTimerInput
} = require('../functions/lib/focus-timer-core');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function testCore() {
  const normal = buildDraftEntries({
    client_id: 'c1',
    task_type: 'Statutory Audit',
    description: 'Working papers',
    work_classification: 'client_work',
    started_at: '2026-07-31T04:30:00.000Z'
  }, '2026-07-31T05:45:00.000Z');
  assert.equal(normal.entries.length, 1);
  assert.equal(normal.entries[0].entry_date, '2026-07-31');
  assert.equal(normal.entries[0].start_time, '10:00');
  assert.equal(normal.entries[0].end_time, '11:15');
  assert.equal(normal.entries[0].hours, 1.25);
  assert.equal(normal.warning, '');

  const overlap = buildDraftEntries({
    task_type: 'Statutory Audit',
    work_classification: 'client_work',
    started_at: '2026-07-31T04:30:00.000Z'
  }, '2026-07-31T05:45:00.000Z', {
    '2026-07-31': [{ start_time: '10:30', end_time: '12:00' }]
  });
  assert.equal(overlap.entries[0].start_time, null);
  assert.match(overlap.warning, /overlaps/i);

  const subMinute = buildDraftEntries({
    task_type: 'Review',
    work_classification: 'internal',
    started_at: '2026-07-31T04:30:20.000Z'
  }, '2026-07-31T04:30:50.000Z');
  assert.equal(subMinute.entries[0].hours, 0.01);
  assert.match(subMinute.warning, /shorter than one/i);

  const midnight = buildDraftEntries({
    task_type: 'Tax Audit',
    work_classification: 'client_work',
    started_at: '2026-07-31T18:29:00.000Z'
  }, '2026-07-31T18:31:00.000Z');
  assert.deepEqual(midnight.entries.map(entry => entry.entry_date), ['2026-07-31', '2026-08-01']);
  assert(midnight.entries.every(entry => entry.start_time === null && entry.end_time === null));
  assert.match(midnight.warning, /crossed midnight/i);

  const overlong = buildDraftEntries({
    task_type: 'Review',
    work_classification: 'internal',
    started_at: '2026-07-29T04:30:00.000Z'
  }, '2026-07-31T05:45:00.000Z');
  assert.equal(overlong.entries.length, 0);
  assert.match(overlong.warning, /more than 24 hours/i);

  assert.throws(() => buildDraftEntries({
    task_type: 'Review',
    started_at: 'invalid'
  }, '2026-07-31T05:45:00.000Z'), /timestamps are invalid/);

  const normalized = normalizeTimerInput({
    task_type: `  ${'x'.repeat(200)}  `,
    description: 'a'.repeat(2100),
    work_classification: 'internal',
    source: 'untrusted'
  });
  assert.equal(normalized.task_type.length, 160);
  assert.equal(normalized.description.length, 2000);
  assert.equal(normalized.source, 'web');
  assert.deepEqual(groupEntriesByDate([
    { entry_date: '2026-07-31', id: 1 },
    { entry_date: '2026-07-31', id: 2 }
  ])['2026-07-31'].map(entry => entry.id), [1, 2]);
}

function testStaticContracts() {
  const localApp = read('local-app.js');
  const firebaseApp = read('functions/app.js');
  const localRoute = read('routes/timer.js');
  const firebaseRoute = read('functions/routes/timer.js');
  const frontend = read('public/js/focus-timer.js');
  const app = read('public/js/app.js');
  const serviceWorker = read('public/sw.js');
  const schema = read('js/database.js');
  const logTimePage = read('public/timesheet.html');
  const myWorkPage = read('public/my-timesheets.html');

  assert(localApp.includes("app.use('/api/timer', authMiddleware, timerRoutes)"));
  assert(firebaseApp.includes("app.use('/api/timer', authMiddleware, timerRoutes)"));
  for (const route of [localRoute, firebaseRoute]) {
    assert(route.includes("'timesheets.view_own'"));
    assert(route.includes("'timesheets.create_own'"));
    assert(route.includes("router.get('/active'"));
    assert(route.includes("router.post('/start'"));
    assert(route.includes("router.post('/stop'"));
    assert(route.includes("router.post('/discard'"));
  }
  assert(schema.includes('CREATE TABLE IF NOT EXISTS time_sessions'));
  assert(frontend.includes("'documentPictureInPicture' in window"));
  assert(frontend.includes("apiFetch('/timer/start'"));
  assert(frontend.includes("apiFetch('/timer/stop'"));
  assert(frontend.includes("BroadcastChannel('samay-focus-timer')"));
  assert(app.includes('bootFocusTimer()'));
  assert(serviceWorker.includes('/js/focus-timer.js'));
  assert(serviceWorker.includes('/css/focus-timer.css'));
  assert(logTimePage.includes("escapeHtml(entry.description || 'No description')"));
  assert(myWorkPage.includes('function editLoadedEntry(index)'));
  assert(!myWorkPage.includes('JSON.stringify(entry)'));
  assert(myWorkPage.includes('escapeHtml(e.rejection_reason'));
}

async function request(baseUrl, pathname, { method = 'GET', token = '', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function testLocalApi() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samay-focus-timer-'));
  process.env.TIMESHEET_DB_DIR = tempRoot;
  process.env.USE_FIREBASE_BACKEND = 'false';
  let server;
  let db;
  try {
    db = require('../js/database');
    const { app } = require('../local-app');
    server = await new Promise(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    const login = await request(baseUrl, '/auth/login', {
      method: 'POST',
      body: { username: 'partner', password: 'admin123' }
    });
    assert.equal(login.status, 200);
    const token = login.payload.token;
    assert(token);

    const initial = await request(baseUrl, '/timer/active', { token });
    assert.equal(initial.status, 200);
    assert.equal(initial.payload.active, null);

    const clients = await request(baseUrl, '/clients', { token });
    const masters = await request(baseUrl, '/master-data', { token });
    const client = clients.payload.find(item => item.active !== 0);
    const task = masters.payload.work_categories.find(item => item.active !== 0);
    const classification = masters.payload.work_classifications.find(item => item.key === 'client_work');
    assert(client && task && classification);
    const timerBody = {
      client_id: client.id,
      task_type: task.label,
      work_classification: classification.key,
      description: 'Timer API integration test',
      source: 'web'
    };

    const simultaneous = await Promise.all([
      request(baseUrl, '/timer/start', { method: 'POST', token, body: timerBody }),
      request(baseUrl, '/timer/start', { method: 'POST', token, body: timerBody })
    ]);
    assert.deepEqual(simultaneous.map(item => item.status).sort(), [201, 409]);

    const recovered = await request(baseUrl, '/timer/active', { token });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.payload.active.task_type, task.label);
    assert.equal(recovered.payload.active.client_id, client.id);

    const stopped = await request(baseUrl, '/timer/stop', {
      method: 'POST',
      token,
      body: { description: 'Completed through timer integration test' }
    });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.payload.entry_ids.length, 1);
    assert.match(stopped.payload.warning, /shorter than one/i);

    const entries = await request(baseUrl, '/timesheets?from=2020-01-01&to=2030-12-31', { token });
    assert.equal(entries.status, 200);
    const created = entries.payload.find(entry => String(entry.id) === String(stopped.payload.entry_ids[0]));
    assert(created);
    assert.equal(created.status, 'draft');
    assert.equal(created.description, 'Completed through timer integration test');

    const secondStop = await request(baseUrl, '/timer/stop', { method: 'POST', token, body: {} });
    assert.equal(secondStop.status, 409);

    const internal = masters.payload.work_classifications.find(item => item.key === 'internal');
    const internalStart = await request(baseUrl, '/timer/start', {
      method: 'POST',
      token,
      body: { task_type: task.label, work_classification: internal.key, source: 'pwa' }
    });
    assert.equal(internalStart.status, 201);
    const discarded = await request(baseUrl, '/timer/discard', { method: 'POST', token, body: {} });
    assert.equal(discarded.status, 200);

    const hash = bcrypt.hashSync('blocked123', 4);
    db.prepare(`
      INSERT INTO users (name, username, password, role, permissions, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run('Blocked Timer User', 'blocked-timer', hash, 'viewer', '["firm.dashboard.view"]');
    const blockedLogin = await request(baseUrl, '/auth/login', {
      method: 'POST',
      body: { username: 'blocked-timer', password: 'blocked123' }
    });
    assert.equal(blockedLogin.status, 200);
    const forbidden = await request(baseUrl, '/timer/active', { token: blockedLogin.payload.token });
    assert.equal(forbidden.status, 403);

    const tampered = await request(baseUrl, '/timer/start', {
      method: 'POST',
      token,
      body: { ...timerBody, task_type: '<script>alert(1)</script>' }
    });
    assert.equal(tampered.status, 400);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db?.open) db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  testCore();
  testStaticContracts();
  await testLocalApi();
  console.log('Focus timer validation passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
