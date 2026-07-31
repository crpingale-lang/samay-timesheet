const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function run() {
  const stored = {};
  const requests = [];
  const accessLevels = [];
  let messageListener;

  const session = {
    async get(keys) {
      return keys.reduce((result, key) => {
        if (Object.prototype.hasOwnProperty.call(stored, key)) result[key] = stored[key];
        return result;
      }, {});
    },
    async set(changes) { Object.assign(stored, structuredClone(changes)); },
    async remove(keys) { keys.forEach(key => delete stored[key]); },
    async setAccessLevel(options) { accessLevels.push(options.accessLevel); }
  };

  const chrome = {
    storage: { session },
    runtime: {
      onMessage: { addListener(listener) { messageListener = listener; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getURL(value) { return `chrome-extension://test/${value}`; }
    },
    alarms: {
      async create() {},
      onAlarm: { addListener() {} }
    },
    tabs: {
      async query() { return []; },
      async sendMessage() {},
      async create() {}
    },
    action: { async openPopup() {} },
    windows: { async create() {} }
  };

  const response = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

  async function fetchMock(url, options = {}) {
    requests.push({ url, options: structuredClone({ ...options, signal: undefined }) });
    if (url.endsWith('/auth/login')) {
      return response({
        token: 'secret-session-token',
        user: { id: 'u1', name: 'Test User', role: 'manager' }
      });
    }
    if (url.endsWith('/clients')) return response([{ id: 'c1', name: 'Aster Advisory', active: true }]);
    if (url.endsWith('/master-data')) return response({ work_categories: [{ label: 'Review', active: true }] });
    if (url.endsWith('/timer/active')) return response({ active: null, server_now: '2026-07-31T12:00:00.000Z' });
    if (url.endsWith('/timer/start')) {
      return response({
        active: {
          session_id: 's1',
          status: 'running',
          started_at: '2026-07-31T12:00:00.000Z',
          task_type: 'Review',
          description: 'Reviewing working papers',
          client_id: 'c1',
          client_name: 'Aster Advisory',
          total_paused_ms: 0
        },
        server_now: '2026-07-31T12:00:00.000Z'
      }, 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  }

  const context = vm.createContext({
    AbortController,
    Response,
    chrome,
    clearTimeout,
    console,
    fetch: fetchMock,
    setTimeout,
    structuredClone
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');
  new vm.Script(source, { filename: 'extension/background.js' }).runInContext(context);
  assert.equal(typeof messageListener, 'function');

  const dispatch = message => new Promise(resolve => {
    const keepChannelOpen = messageListener(message, {}, resolve);
    assert.equal(keepChannelOpen, true);
  });

  const login = await dispatch({
    type: 'SAMAY_LOGIN',
    identifier: 'test.user',
    password: 'not-stored'
  });
  assert.equal(login.ok, true);
  assert.equal(login.state.authenticated, true);
  assert.equal(login.state.clients.length, 1);
  assert.equal(login.state.categories.length, 1);
  assert(!JSON.stringify(login.state).includes('secret-session-token'));
  assert(!JSON.stringify(stored).includes('not-stored'));
  assert.equal(stored.authToken, 'secret-session-token');
  assert(accessLevels.every(level => level === 'TRUSTED_CONTEXTS'));

  const loginRequest = requests.find(item => item.url.endsWith('/auth/login'));
  assert(loginRequest);
  assert(!loginRequest.options.headers.Authorization);

  const started = await dispatch({
    type: 'SAMAY_START',
    clientId: 'c1',
    taskType: 'Review',
    description: 'Reviewing working papers'
  });
  assert.equal(started.ok, true);
  assert.equal(started.state.active.status, 'running');
  assert(!JSON.stringify(started.state).includes('secret-session-token'));
  const startRequest = requests.find(item => item.url.endsWith('/timer/start'));
  assert.equal(startRequest.options.headers.Authorization, 'Bearer secret-session-token');
  assert.equal(JSON.parse(startRequest.options.body).source, 'browser_extension');

  const logout = await dispatch({ type: 'SAMAY_LOGOUT' });
  assert.equal(logout.ok, true);
  assert.equal(logout.state.authenticated, false);
  assert.equal(stored.authToken, undefined);
  assert.equal(stored.clients, undefined);

  console.log('Browser extension background flow passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
