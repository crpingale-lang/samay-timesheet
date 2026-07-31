const API_BASE = 'https://samay-timesheet.web.app/api';
const APP_BASE = 'https://samay-timesheet.web.app';
const SYNC_ALARM = 'samay-focus-timer-sync';
const SESSION_KEYS = [
  'authToken',
  'authUser',
  'activeTimer',
  'clients',
  'categories',
  'clockOffsetMs',
  'lastSaved',
  'optionsNotice',
  'lastSyncAt'
];

let syncPromise = null;

async function secureSessionStorage() {
  if (!chrome.storage.session?.setAccessLevel) return;
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

async function readSession() {
  await secureSessionStorage();
  const stored = await chrome.storage.session.get(SESSION_KEYS);
  return {
    authToken: stored.authToken || '',
    authUser: stored.authUser || null,
    activeTimer: stored.activeTimer || null,
    clients: Array.isArray(stored.clients) ? stored.clients : [],
    categories: Array.isArray(stored.categories) ? stored.categories : [],
    clockOffsetMs: Number(stored.clockOffsetMs) || 0,
    lastSaved: stored.lastSaved || null,
    optionsNotice: stored.optionsNotice || '',
    lastSyncAt: Number(stored.lastSyncAt) || 0
  };
}

function publicState(session, extra = {}) {
  const now = Date.now() + session.clockOffsetMs;
  return {
    authenticated: Boolean(session.authToken && session.authUser),
    user: session.authUser,
    notice: session.transientNotice || '',
    active: session.activeTimer,
    clients: session.clients,
    categories: session.categories,
    lastSaved: session.lastSaved,
    optionsNotice: session.optionsNotice,
    serverNow: new Date(now).toISOString(),
    ...extra
  };
}

function errorMessage(payload, status) {
  if (payload && typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
  if (status === 401) return 'Your Samay session has expired. Sign in again.';
  if (status === 403) return 'Your account does not have permission for this action.';
  if (status >= 500) return 'Samay is temporarily unavailable. Please try again.';
  return `Samay request failed (${status}).`;
}

async function clearAuth() {
  await chrome.storage.session.remove(SESSION_KEYS);
}

async function apiRequest(path, { method = 'GET', body, token, allowUnauthenticated = false } = {}) {
  const session = await readSession();
  const authToken = token || session.authToken;
  if (!allowUnauthenticated && !authToken) throw new Error('Sign in to Samay to use the timer.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store'
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Samay took too long to respond. Please try again.');
    throw new Error('Samay could not be reached. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !allowUnauthenticated) await clearAuth();
    const error = new Error(errorMessage(payload, response.status));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function isActive(item) {
  return item?.active !== false && item?.active !== 0 && item?.active !== '0';
}

async function loadOptions(session) {
  const [clientsResult, mastersResult] = await Promise.allSettled([
    apiRequest('/clients'),
    apiRequest('/master-data')
  ]);
  const issues = [];
  let clients = session.clients;
  let categories = session.categories;

  if (clientsResult.status === 'fulfilled') {
    const payload = Array.isArray(clientsResult.value)
      ? clientsResult.value
      : clientsResult.value?.items;
    clients = (Array.isArray(payload) ? payload : []).filter(isActive);
    if (!clients.length) issues.push('No active clients are configured. Internal work remains available.');
  } else {
    issues.push('Clients could not be loaded.');
  }

  if (mastersResult.status === 'fulfilled') {
    const payload = mastersResult.value?.work_categories;
    categories = (Array.isArray(payload) ? payload : []).filter(isActive);
    if (!categories.length) issues.push('No active work categories are configured.');
  } else {
    issues.push('Work categories could not be loaded.');
  }

  const changes = { clients, categories, optionsNotice: issues.join(' ') };
  await chrome.storage.session.set(changes);
  return { ...session, ...changes };
}

async function loadActive(session) {
  const result = await apiRequest('/timer/active');
  const serverTime = Date.parse(result.server_now);
  const changes = {
    activeTimer: result.active || null,
    clockOffsetMs: Number.isFinite(serverTime) ? serverTime - Date.now() : session.clockOffsetMs,
    lastSyncAt: Date.now()
  };
  await chrome.storage.session.set(changes);
  return { ...session, ...changes };
}

async function syncState({ force = false } = {}) {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    let session = await readSession();
    if (!session.authToken) return session;
    if (!force && Date.now() - session.lastSyncAt < 15000 && session.categories.length) return session;
    try {
      if (!session.clients.length || !session.categories.length) session = await loadOptions(session);
      session = await loadActive(session);
      return session;
    } catch (error) {
      if (error.status === 401) return readSession();
      return {
        ...(await readSession()),
        transientNotice: `Timer status could not be refreshed. ${error.message}`
      };
    }
  })();
  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}

async function broadcastState(extra = {}) {
  const session = await readSession();
  const message = { type: 'SAMAY_STATE_UPDATED', state: publicState(session, extra) };
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab => (
    tab.id ? chrome.tabs.sendMessage(tab.id, message) : Promise.resolve()
  )));
  return message.state;
}

async function login(identifier, password) {
  const username = String(identifier || '').trim();
  if (!username || !password) throw new Error('Enter your username or email and password.');
  const result = await apiRequest('/auth/login', {
    method: 'POST',
    body: { identifier: username, password: String(password) },
    allowUnauthenticated: true
  });
  if (!result.token || !result.user) throw new Error('Samay did not return a valid sign-in session.');
  await clearAuth();
  await chrome.storage.session.set({ authToken: result.token, authUser: result.user });
  let session = await readSession();
  session = await loadOptions(session);
  let notice = '';
  try {
    session = await loadActive(session);
  } catch (error) {
    if (error.status === 401) return publicState(await readSession());
    notice = `Signed in, but timer status could not be loaded. ${error.message}`;
    session = await readSession();
  }
  await broadcastState({ notice });
  return publicState(session, { notice });
}

async function logout() {
  await clearAuth();
  await broadcastState();
  return publicState(await readSession());
}

async function timerAction(action, body = {}) {
  const paths = {
    start: '/timer/start',
    pause: '/timer/pause',
    resume: '/timer/resume',
    stop: '/timer/stop'
  };
  if (!paths[action]) throw new Error('Unsupported timer action.');
  let result;
  try {
    result = await apiRequest(paths[action], { method: 'POST', body });
  } catch (error) {
    if (error.status === 409 && error.payload?.active) {
      await chrome.storage.session.set({ activeTimer: error.payload.active, lastSyncAt: Date.now() });
      await broadcastState({ notice: 'Your existing Samay timer was restored.' });
    }
    throw error;
  }

  const serverTime = Date.parse(result.server_now);
  const changes = {
    clockOffsetMs: Number.isFinite(serverTime) ? serverTime - Date.now() : (await readSession()).clockOffsetMs,
    lastSyncAt: Date.now()
  };
  if (action === 'stop') {
    changes.activeTimer = null;
    changes.lastSaved = {
      entryIds: result.entry_ids || [],
      elapsedSeconds: Number(result.elapsed_seconds) || 0,
      warning: result.warning || ''
    };
  } else {
    changes.activeTimer = result.active || null;
    if (action === 'start') changes.lastSaved = null;
  }
  await chrome.storage.session.set(changes);
  return broadcastState({ notice: action === 'stop' ? 'Time saved as a draft.' : '' });
}

async function showOverlayOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active webpage was found.');
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'SAMAY_OVERLAY_SHOW' });
  } catch {
    throw new Error('Refresh a normal website tab, then show the timer again.');
  }
  return true;
}

async function openPopupOrApp() {
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 360,
      height: 560
    });
  }
}

async function handleMessage(message) {
  switch (message?.type) {
    case 'SAMAY_GET_STATE':
      return publicState(await syncState());
    case 'SAMAY_REFRESH': {
      const session = await syncState({ force: true });
      await broadcastState({ notice: session.transientNotice || '' });
      return publicState(session);
    }
    case 'SAMAY_LOGIN':
      return login(message.identifier, message.password);
    case 'SAMAY_LOGOUT':
      return logout();
    case 'SAMAY_START':
      return timerAction('start', {
        client_id: message.clientId || null,
        task_type: String(message.taskType || '').trim(),
        description: String(message.description || '').trim(),
        source: 'browser_extension'
      });
    case 'SAMAY_PAUSE':
      return timerAction('pause');
    case 'SAMAY_RESUME':
      return timerAction('resume');
    case 'SAMAY_STOP':
      return timerAction('stop');
    case 'SAMAY_SHOW_ON_ACTIVE_TAB':
      await showOverlayOnActiveTab();
      return publicState(await readSession());
    case 'SAMAY_OPEN_POPUP':
      await openPopupOrApp();
      return publicState(await readSession());
    case 'SAMAY_OPEN_APP':
      await chrome.tabs.create({ url: `${APP_BASE}${String(message.path || '/dashboard.html')}` });
      return publicState(await readSession());
    default:
      throw new Error('Unknown Samay extension request.');
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(state => sendResponse({ ok: true, state }))
    .catch(error => sendResponse({ ok: false, error: error.message || 'Samay request failed.' }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await secureSessionStorage();
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(async () => {
  await secureSessionStorage();
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  try {
    await syncState({ force: true });
    await broadcastState();
  } catch {
    // A later user action will surface network errors in context.
  }
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== SYNC_ALARM) return;
  try {
    const session = await readSession();
    if (!session.authToken) return;
    await syncState({ force: true });
    await broadcastState();
  } catch {
    // Keep the last known timer visible during temporary outages.
  }
});

secureSessionStorage();
