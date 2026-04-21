// â”€â”€â”€ SHARED APP UTILITIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const API = '/api';
const LOCAL_CACHE_PREFIX = 'ts_cache:';
const SESSION_LAST_ACTIVITY_KEY = 'ts_last_activity';
const SELECTED_MODULE_KEY = 'ts_selected_module';
const AUTH_NOTICE_KEY = 'ts_auth_notice';
const TRUSTED_DEVICE_ID_KEY = 'ts_trusted_device_id';
const TRUSTED_DEVICE_TOKEN_KEY = 'ts_trusted_device_token';
const SESSION_REFRESH_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
const SESSION_ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000;
const SESSION_REFRESH_CHECK_MS = 60 * 1000;
const SESSION_ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000;
const SESSION_ACTIVITY_SYNC_THROTTLE_MS = 2 * 60 * 1000;

const ROLE_DEFAULT_PERMISSIONS = {
  partner: [
    'clients.view',
    'clients.create',
    'clients.edit',
    'clients.delete',
    'clients.import',
    'staff.view',
    'staff.create',
    'staff.edit',
    'staff.delete',
    'access.manage',
    'modules.view',
    'firm.dashboard.view',
    'timesheets.masters.view',
    'timesheets.masters.create',
    'timesheets.masters.edit',
    'timesheets.masters.delete',
    'timesheets.masters.import',
    'timesheets.view_own',
    'timesheets.create_own',
    'timesheets.edit_own',
    'timesheets.delete_own',
    'timesheets.submit_own',
    'timesheets.view_all',
    'approvals.view_manager_queue',
    'approvals.approve_manager',
    'approvals.view_partner_queue',
    'approvals.approve_partner',
    'reports.view',
    'reports.export',
    'attendance.view_reports',
    'dashboard.view_self',
    'dashboard.view_team',
    'dashboard.view_firm',
    'udin.view_own',
    'udin.create',
    'udin.update',
    'udin.review',
    'udin.revoke',
    'udin.dashboard.view'
  ],
  manager: [
    'clients.view',
    'staff.view',
    'modules.view',
    'firm.dashboard.view',
    'timesheets.masters.view',
    'timesheets.view_own',
    'timesheets.create_own',
    'timesheets.edit_own',
    'timesheets.delete_own',
    'timesheets.submit_own',
    'timesheets.view_all',
    'approvals.view_manager_queue',
    'approvals.approve_manager',
    'reports.view',
    'reports.export',
    'attendance.view_reports',
    'dashboard.view_self',
    'dashboard.view_team',
    'udin.view_own',
    'udin.create',
    'udin.update',
    'udin.review',
    'udin.revoke',
    'udin.dashboard.view'
  ],
  article: [
    'clients.view',
    'modules.view',
    'timesheets.view_own',
    'timesheets.create_own',
    'timesheets.edit_own',
    'timesheets.delete_own',
    'timesheets.submit_own',
    'attendance.view_own',
    'attendance.create_own',
    'dashboard.view_self',
    'udin.view_own',
    'udin.create',
    'udin.update',
    'udin.review',
    'udin.revoke',
    'udin.dashboard.view'
  ]
};

// Auth helpers
function getToken() { return localStorage.getItem('ts_token'); }
function parseJwtPayload(token = getToken()) {
  if (!token) return null;
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4 || 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}
function getTokenExpiryMs(token = getToken()) {
  const payload = parseJwtPayload(token);
  return payload?.exp ? payload.exp * 1000 : 0;
}
function isTokenExpired(token = getToken(), graceMs = 0) {
  const expiresAt = getTokenExpiryMs(token);
  if (!expiresAt) return true;
  return Date.now() >= (expiresAt - graceMs);
}
function hasUsableSession() {
  return !!(getToken() && getUser() && !isTokenExpired());
}
let lastSessionActivityWriteMs = 0;
let lastSessionActivitySyncMs = 0;
let sessionActivitySyncPromise = null;

async function syncSessionActivityToServer({ force = false } = {}) {
  const token = getToken();
  if (!token || !getUser() || isTokenExpired(token)) return false;
  const now = Date.now();
  if (!force && (now - lastSessionActivitySyncMs) < SESSION_ACTIVITY_SYNC_THROTTLE_MS) return false;
  if (sessionActivitySyncPromise) return sessionActivitySyncPromise;

  lastSessionActivitySyncMs = now;
  sessionActivitySyncPromise = fetch(`${API}/auth/activity-ping`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    keepalive: true
  }).then(async res => {
    if (!res.ok) {
      if (res.status === 401) {
        clearSession();
        setAuthNotice('Your session expired. Please sign in again.');
      }
      return false;
    }
    const data = await res.json().catch(() => ({}));
    if (data?.user) {
      const nextUser = { ...getUser(), ...data.user };
      setSession(token, nextUser, { recordActivity: false });
    }
    return true;
  }).catch(() => false).finally(() => {
    sessionActivitySyncPromise = null;
  });

  return sessionActivitySyncPromise;
}

function recordSessionActivity() {
  const now = Date.now();
  if ((now - lastSessionActivityWriteMs) < SESSION_ACTIVITY_WRITE_THROTTLE_MS) return;
  lastSessionActivityWriteMs = now;
  try {
    localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(now));
  } catch {}
  void syncSessionActivityToServer();
}
function getLastSessionActivityMs() {
  const value = parseInt(localStorage.getItem(SESSION_LAST_ACTIVITY_KEY) || '0', 10);
  return Number.isFinite(value) ? value : 0;
}
function isRecentlyActive() {
  return (Date.now() - getLastSessionActivityMs()) <= SESSION_ACTIVE_WINDOW_MS;
}
function shouldRefreshSession(token = getToken()) {
  if (!token || isTokenExpired(token)) return false;
  return (getTokenExpiryMs(token) - Date.now()) <= SESSION_REFRESH_THRESHOLD_MS;
}
let sessionRefreshPromise = null;
function inferPermissions(user) {
  if (!user || typeof user !== 'object') return [];
  const current = Array.isArray(user.permissions) ? user.permissions.filter(Boolean) : [];
  const fallback = ROLE_DEFAULT_PERMISSIONS[user.role] || [];
  const permissions = [...new Set([...current, ...fallback])];
  return permissions.includes('firm.dashboard.view')
    ? permissions
    : [...permissions, 'firm.dashboard.view'];
}
function safeUserName(user) {
  if (!user || typeof user !== 'object') return 'User';
  const name = String(user.name || user.username || 'User').trim();
  return name || 'User';
}
function normalizeUserEmail(user) {
  return String(user?.email || '').trim().toLowerCase();
}
function normalizeUserMobile(user) {
  return String(user?.mobile_number || '').trim();
}
function isContactInfoComplete(user = getUser()) {
  return !!(normalizeUserEmail(user) && normalizeUserMobile(user));
}
function getUser() {
  let user;
  try {
    user = JSON.parse(localStorage.getItem('ts_user') || 'null');
  } catch {
    clearSession();
    return null;
  }
  if (!user) return null;
  const permissions = inferPermissions(user);
  if (!Array.isArray(user.permissions) || user.permissions.length !== permissions.length) {
    user.permissions = permissions;
    try {
      localStorage.setItem('ts_user', JSON.stringify(user));
    } catch {}
  }
  return user;
}
function getUserPermissions() { return inferPermissions(getUser()); }
function hasPermission(permission) { return getUserPermissions().includes(permission); }
function isPartner() { return getUser()?.role === 'partner'; }
function isManager() { return getUser()?.role === 'manager'; }
function isManagerOrAbove() { return ['partner','manager'].includes(getUser()?.role); }
function isArticle() { return getUser()?.role === 'article'; }

function getSelectedModule() {
  return String(localStorage.getItem(SELECTED_MODULE_KEY) || '').trim().toLowerCase();
}

function setSelectedModule(moduleKey) {
  const normalized = String(moduleKey || '').trim().toLowerCase();
  if (!normalized) {
    localStorage.removeItem(SELECTED_MODULE_KEY);
    return '';
  }
  localStorage.setItem(SELECTED_MODULE_KEY, normalized);
  return normalized;
}

function clearSelectedModule() {
  localStorage.removeItem(SELECTED_MODULE_KEY);
}

function getTrustedDeviceId() {
  let deviceId = String(localStorage.getItem(TRUSTED_DEVICE_ID_KEY) || '').trim();
  if (deviceId) return deviceId;
  deviceId = (window.crypto?.randomUUID?.() || `device_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  try {
    localStorage.setItem(TRUSTED_DEVICE_ID_KEY, deviceId);
  } catch {}
  return deviceId;
}

function getTrustedDeviceToken() {
  return String(localStorage.getItem(TRUSTED_DEVICE_TOKEN_KEY) || '').trim();
}

function setTrustedDeviceToken(token) {
  const value = String(token || '').trim();
  if (!value) {
    localStorage.removeItem(TRUSTED_DEVICE_TOKEN_KEY);
    return '';
  }
  localStorage.setItem(TRUSTED_DEVICE_TOKEN_KEY, value);
  return value;
}

function getTrustedDeviceLabel() {
  const ua = String(navigator.userAgent || '').trim();
  const platform = String(navigator.userAgentData?.platform || navigator.platform || '').trim();
  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  return `${browser}${platform ? ` on ${platform}` : ''}`;
}

function setAuthNotice(message) {
  const text = String(message || '').trim();
  if (!text) {
    localStorage.removeItem(AUTH_NOTICE_KEY);
    return;
  }
  localStorage.setItem(AUTH_NOTICE_KEY, text);
}

function consumeAuthNotice() {
  const message = String(localStorage.getItem(AUTH_NOTICE_KEY) || '').trim();
  localStorage.removeItem(AUTH_NOTICE_KEY);
  return message;
}

function redirectToLogin(message) {
  if (message) setAuthNotice(message);
  window.location.href = '/';
}

function getModuleLandingPage(moduleKey = getSelectedModule()) {
  switch (String(moduleKey || '').trim().toLowerCase()) {
    case 'timesheet':
      if (hasPermission('dashboard.view_self')) return '/dashboard.html';
      if (hasPermission('timesheets.view_own')) return '/timesheet.html';
      if (hasPermission('firm.dashboard.view')) return '/firm-dashboard.html';
      return '/timesheet.html';
    case 'udin':
    case 'udin-tracker':
      return '/udin.html';
    case 'form15cb':
      return '/form15cb.html';
    default:
      return getDefaultLandingPage();
  }
}

function getDefaultLandingPage() {
  if (hasPermission('firm.dashboard.view')) return '/firm-dashboard.html';

  const selectedModule = getSelectedModule();
  if (!selectedModule) {
    return '/module-select.html';
  }
  if (selectedModule === 'timesheet') {
    if (hasPermission('dashboard.view_self')) return '/dashboard.html';
    if (hasPermission('timesheets.view_own')) return '/timesheet.html';
  }
  if (selectedModule === 'udin' || selectedModule === 'udin-tracker') return '/udin.html';
  if (selectedModule === 'form15cb') return '/form15cb.html';
  if (hasPermission('dashboard.view_self')) return '/dashboard.html';
  if (hasPermission('timesheets.view_own')) return '/timesheet.html';
  if (hasPermission('approvals.view_manager_queue') || hasPermission('approvals.view_partner_queue')) return '/approvals.html';
  if (hasPermission('reports.view') || hasPermission('feedback.view')) return '/reports.html';
  if (hasPermission('attendance.view_reports') || hasPermission('attendance.view_own') || hasPermission('attendance.create_own')) return '/attendance.html';
  if (hasPermission('clients.view')) return '/clients.html';
  if (hasPermission('staff.view')) return '/users.html';
  return '/';
}

function setSession(token, user, { recordActivity = true } = {}) {
  const normalizedUser = user ? { ...user, permissions: inferPermissions(user) } : user;
  localStorage.setItem('ts_token', token);
  localStorage.setItem('ts_user', JSON.stringify(normalizedUser));
  if (recordActivity) {
    recordSessionActivity();
  }
}
function updateSessionUser(patch = {}) {
  const user = getUser();
  if (!user) return null;
  const nextUser = { ...user, ...patch };
  setSession(getToken(), nextUser);
  return nextUser;
}
function clearSession() {
  localStorage.removeItem('ts_token');
  localStorage.removeItem('ts_user');
  localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
  clearSelectedModule();
}
function requireAuth(managerAbove = false) {
  const token = getToken(); const user = getUser();
  if (!token || !user || isTokenExpired(token)) {
    clearSession();
    redirectToLogin('Your session expired. Please sign in again.');
    return false;
  }
  if (managerAbove && !['manager','partner'].includes(user.role)) {
    setAuthNotice('You do not have access to that page.');
    window.location.href = getDefaultLandingPage();
    return false;
  }
  return true;
}
function requirePartner() {
  const user = getUser();
  if (!user) {
    redirectToLogin('Please sign in to continue.');
    return false;
  }
  if (user.role !== 'partner') {
    setAuthNotice('That page is available only to partners.');
    window.location.href = getDefaultLandingPage();
    return false;
  }
  return true;
}
function requirePermission(permission) {
  const user = getUser();
  if (!user) {
    redirectToLogin('Please sign in to continue.');
    return false;
  }
  if (!hasPermission(permission)) {
    setAuthNotice(`You do not have permission to open ${permission}.`);
    window.location.href = getDefaultLandingPage();
    return false;
  }
  return true;
}
function logout() { clearSession(); window.location.href = '/'; }

async function refreshSession({ force = false } = {}) {
  const token = getToken();
  const user = getUser();
  if (!token || !user || isTokenExpired(token)) return false;
  if (!force && (!isRecentlyActive() || !shouldRefreshSession(token))) return false;
  if (sessionRefreshPromise) return sessionRefreshPromise;

  sessionRefreshPromise = fetch(`${API}/auth/refresh-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    }
    }).then(async res => {
      if (!res.ok) {
        if (res.status === 401) {
          clearSession();
          setAuthNotice('Your session expired. Please sign in again.');
        }
        return false;
      }
    const data = await res.json().catch(() => ({}));
    if (!data?.token || !data?.user) return false;
    setSession(data.token, data.user);
    return true;
  }).finally(() => {
    sessionRefreshPromise = null;
  });

  return sessionRefreshPromise;
}

function bootSessionKeepAlive() {
  if (window.__tsSessionKeepAliveBooted) return;
  window.__tsSessionKeepAliveBooted = true;

  ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'scroll'].forEach(eventName => {
    window.addEventListener(eventName, recordSessionActivity, { passive: true });
  });
  window.addEventListener('focus', () => {
    recordSessionActivity();
    if (getToken() && isTokenExpired()) logout();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      recordSessionActivity();
      if (getToken() && isTokenExpired()) logout();
    }
  });

  if (hasUsableSession()) {
    recordSessionActivity();
  }

  window.setInterval(() => {
    if (getToken() && isTokenExpired()) logout();
  }, SESSION_REFRESH_CHECK_MS);
}

let contactCatchupBootstrapped = false;
let contactCatchupSubmitting = false;

function ensureContactCatchupModal() {
  if (document.getElementById('contact-catchup-modal')) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal-overlay contact-catchup-overlay" id="contact-catchup-modal">
      <div class="modal contact-catchup-modal">
        <div class="modal-header">
          <div class="modal-header-copy">
            <div class="modal-kicker">Profile Check</div>
            <div class="modal-title">Complete Your Contact Details</div>
            <div class="modal-subtitle contact-catchup-subtitle">We need your mobile number and email ID for password reset and login authentication.</div>
          </div>
        </div>
        <form id="contact-catchup-form" class="modal-body">
          <div class="alert alert-info contact-catchup-alert">
            Update these once now so your account can support recovery and future sign-in checks.
          </div>
          <div class="form-group">
            <label class="form-label" for="contact-email">Email ID *</label>
            <input class="form-control" type="email" id="contact-email" placeholder="name@firm.com" autocomplete="email" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="contact-mobile">Mobile Number *</label>
            <input class="form-control" type="tel" id="contact-mobile" placeholder="Enter mobile number" autocomplete="tel" required>
          </div>
          <div id="contact-catchup-error" class="contact-catchup-error"></div>
          <button type="submit" class="btn btn-primary contact-catchup-submit" id="contact-catchup-submit">Save and Continue</button>
        </form>
      </div>
    </div>`;
  document.body.appendChild(wrapper.firstElementChild);

  document.getElementById('contact-catchup-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (contactCatchupSubmitting) return;

    const submitBtn = document.getElementById('contact-catchup-submit');
    const errorEl = document.getElementById('contact-catchup-error');
    const email = document.getElementById('contact-email').value.trim();
    const mobile_number = document.getElementById('contact-mobile').value.trim();

    contactCatchupSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    errorEl.style.display = 'none';
    errorEl.textContent = '';

    try {
      const result = await apiFetch('/auth/complete-contact-info', {
        method: 'POST',
        body: { email, mobile_number }
      });
      const nextUser = updateSessionUser(result?.user || { email, mobile_number, contact_info_required: false });
      hideContactCatchupGate();
      toast(`Thanks, ${safeUserName(nextUser)}. Your contact details are updated.`, 'success');
    } catch (err) {
      errorEl.textContent = err.message || 'Unable to save contact details';
      errorEl.style.display = 'block';
    } finally {
      contactCatchupSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save and Continue';
    }
  });
}

function showContactCatchupGate() {
  const user = getUser();
  if (!user || isContactInfoComplete(user)) return;
  ensureContactCatchupModal();
  const modal = document.getElementById('contact-catchup-modal');
  if (!modal) return;
  document.getElementById('contact-email').value = normalizeUserEmail(user);
  document.getElementById('contact-mobile').value = normalizeUserMobile(user);
  document.getElementById('contact-catchup-error').style.display = 'none';
  modal.classList.add('open');
  document.body.classList.add('contact-catchup-active');
}

function hideContactCatchupGate() {
  document.getElementById('contact-catchup-modal')?.classList.remove('open');
  document.body.classList.remove('contact-catchup-active');
}

function bootContactCatchupGate() {
  if (contactCatchupBootstrapped) return;
  contactCatchupBootstrapped = true;
  ensureContactCatchupModal();
  showContactCatchupGate();
}

// API fetch wrapper
async function apiFetch(path, options = {}) {
  const token = getToken();
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(API + path, {
    ...options,
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {})
    },
    body: options.body ? (isFormData ? options.body : (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))) : undefined
  });
  if (res.status === 401) {
    clearSession();
    redirectToLogin('Your session expired or the server rejected your session. Please sign in again.');
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function localCacheKey(key) {
  return `${LOCAL_CACHE_PREFIX}${key}`;
}

function readLocalCache(key) {
  try {
    const cached = JSON.parse(localStorage.getItem(localCacheKey(key)) || 'null');
    if (!cached || typeof cached !== 'object') return null;
    return cached;
  } catch {
    return null;
  }
}

function writeLocalCache(key, value) {
  try {
    localStorage.setItem(localCacheKey(key), JSON.stringify({
      value,
      savedAt: Date.now()
    }));
  } catch {}
}

function clearLocalCache(key) {
  try {
    localStorage.removeItem(localCacheKey(key));
  } catch {}
}

function readViewState(key) {
  try {
    return JSON.parse(sessionStorage.getItem(`ts_view:${key}`) || 'null');
  } catch {
    return null;
  }
}

function writeViewState(key, value) {
  try {
    sessionStorage.setItem(`ts_view:${key}`, JSON.stringify(value));
  } catch {}
}

function clearViewState(key) {
  try {
    sessionStorage.removeItem(`ts_view:${key}`);
  } catch {}
}

function renderEmptyState({ icon = 'ℹ', title = 'Nothing here yet', subtitle = '', actionLabel = '', action = '' } = {}) {
  const actionHtml = actionLabel && action
    ? `<div style="margin-top:12px;"><button class="btn btn-ghost btn-sm" type="button" onclick="${action}">${actionLabel}</button></div>`
    : '';
  const subtitleHtml = subtitle ? `<div class="empty-sub">${subtitle}</div>` : '';
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-title">${title}</div>${subtitleHtml}${actionHtml}</div>`;
}

// Toast
function toast(message, type = 'success') {
  const container = document.getElementById('toast-container') || (() => {
    const el = document.createElement('div'); el.id = 'toast-container'; el.className = 'toast-container'; el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true');
    document.body.appendChild(el); return el;
  })();
  const icons = { success: '✓', error: '!', info: 'i' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.setAttribute('role', 'status');
  t.innerHTML = `<span>${icons[type]||'i'}</span><span>${message}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='0.3s'; setTimeout(()=>t.remove(),300); }, 3500);
}

// Modal helpers
function viewportHeightPx() {
  if (window.visualViewport?.height) return `${window.visualViewport.height}px`;
  return `${window.innerHeight}px`;
}

function syncMobileViewportState() {
  const root = document.documentElement;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const layoutHeight = window.innerHeight || viewportHeight;
  const keyboardOffset = Math.max(layoutHeight - viewportHeight, 0);
  const keyboardOpen = keyboardOffset > 120;
  root.style.setProperty('--app-vh', `${viewportHeight}px`);
  root.style.setProperty('--keyboard-offset', `${keyboardOffset}px`);
  document.body.classList.toggle('keyboard-open', keyboardOpen);
}

function scrollFieldIntoView(target) {
  if (!target || !isMobileListPickerViewport()) return;
  window.setTimeout(() => {
    try {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (_) {}
  }, 180);
}

function bootMobileKeyboardSupport() {
  if (window.__tsMobileKeyboardBooted) return;
  window.__tsMobileKeyboardBooted = true;
  syncMobileViewportState();

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncMobileViewportState);
    window.visualViewport.addEventListener('scroll', syncMobileViewportState);
  }
  window.addEventListener('resize', syncMobileViewportState);
  window.addEventListener('orientationchange', syncMobileViewportState);
  document.addEventListener('focusin', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches('input, textarea, select')) return;
    if (!target.closest('.modal, .mobile-list-picker-sheet, .contact-catchup-modal')) return;
    scrollFieldIntoView(target);
  });
  document.addEventListener('focusout', () => {
    window.setTimeout(syncMobileViewportState, 120);
  });
}

function syncGlobalOverlayState() {
  const hasOpenOverlay = document.querySelector('.modal-overlay.open');
  document.body.classList.toggle('modal-open', !!hasOpenOverlay);
  syncMobileViewportState();
}
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
  syncGlobalOverlayState();
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  syncGlobalOverlayState();
}
function closeAllModals() {
  document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  syncGlobalOverlayState();
}
document.addEventListener('keydown', e => { if (e.key==='Escape') closeAllModals(); });

let mobileListPickerState = null;

function isMobileListPickerViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
}

function ensureMobileListPickerShell() {
  if (document.getElementById('mobile-list-picker')) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal-overlay mobile-list-picker-overlay" id="mobile-list-picker" aria-hidden="true">
      <div class="mobile-list-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-list-picker-title">
        <div class="mobile-list-picker-header">
          <div class="mobile-list-picker-title" id="mobile-list-picker-title">Select</div>
          <button class="modal-close mobile-list-picker-close" type="button" id="mobile-list-picker-close" aria-label="Close selection">&times;</button>
        </div>
        <div class="mobile-list-picker-search-wrap">
          <label class="mobile-list-picker-search-label" for="mobile-list-picker-search">Search</label>
          <input class="form-control mobile-list-picker-search" id="mobile-list-picker-search" type="text" placeholder="Search">
        </div>
        <div class="mobile-list-picker-options" id="mobile-list-picker-options"></div>
        <div class="mobile-list-picker-footer">
          <button class="btn btn-primary" type="button" id="mobile-list-picker-done">Done</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrapper.firstElementChild);

  const overlay = document.getElementById('mobile-list-picker');
  const search = document.getElementById('mobile-list-picker-search');
  const done = document.getElementById('mobile-list-picker-done');
  const close = document.getElementById('mobile-list-picker-close');
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeMobileListPicker();
  });
  search.addEventListener('input', () => renderMobileListPickerOptions(search.value));
  close.addEventListener('click', () => closeMobileListPicker());
  done.addEventListener('click', () => {
    commitMobileListPickerSelection();
    closeMobileListPicker();
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mobileListPickerOptionsForElement(element) {
  if (!element) return [];
  if (element.matches('select')) {
    return [...element.options]
      .filter(option => option.value !== '' && option.textContent.trim())
      .map(option => ({
        value: option.value,
        label: option.textContent.trim(),
        disabled: !!option.disabled
      }));
  }

  if (element.matches('input[list]')) {
    const listId = element.getAttribute('list');
    const datalist = listId ? document.getElementById(listId) : null;
    if (!datalist) return [];
    return [...datalist.querySelectorAll('option')].map(option => ({
      value: option.value,
      label: option.label || option.value,
      disabled: !!option.disabled
    }));
  }

  return [];
}

function shouldUseMobileListPicker(element) {
  if (!isMobileListPickerViewport() || !element || element.disabled) return false;
  return mobileListPickerOptionsForElement(element).some(option => !option.disabled);
}

function syncMobileListPickerState(element) {
  if (!element || !element.matches('input[list]')) return;
  element.readOnly = shouldUseMobileListPicker(element);
}

function openMobileListPicker(element) {
  if (!isMobileListPickerViewport()) return false;
  ensureMobileListPickerShell();
  const options = mobileListPickerOptionsForElement(element).filter(option => !option.disabled);
  if (!options.length) return false;

  const currentValue = element.matches('select') ? element.value : element.value || '';
  const selected = options.find(option => option.value === currentValue) || null;
  mobileListPickerState = {
    element,
    options,
    filtered: options,
    selectedValue: selected ? selected.value : currentValue
  };

  document.getElementById('mobile-list-picker-title').textContent =
    element.dataset.mobilePickerTitle || element.getAttribute('aria-label') || element.closest('.form-group')?.querySelector('.form-label')?.textContent || 'Select';
  const search = document.getElementById('mobile-list-picker-search');
  search.value = '';
  renderMobileListPickerOptions(search.value);
  openModal('mobile-list-picker');
  document.body.classList.add('mobile-list-picker-open');
  window.setTimeout(() => {
    const selected = document.querySelector('.mobile-list-picker-option.selected');
    try {
      selected?.scrollIntoView({ block: 'nearest' });
    } catch (_) {}
  }, 20);
  return true;
}

function renderMobileListPickerOptions(query = '') {
  if (!mobileListPickerState) return;
  const normalizedQuery = String(query || '').trim().toLowerCase();
  mobileListPickerState.filtered = normalizedQuery
    ? mobileListPickerState.options.filter(option => `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery))
    : mobileListPickerState.options;

  const container = document.getElementById('mobile-list-picker-options');
  if (!mobileListPickerState.filtered.length) {
    container.innerHTML = '<div class="mobile-list-picker-empty">No matching options</div>';
    return;
  }

  container.innerHTML = mobileListPickerState.filtered.map(option => {
    const checked = String(option.value) === String(mobileListPickerState.selectedValue);
    return `
      <button type="button" class="mobile-list-picker-option ${checked ? 'selected' : ''}" data-value="${escapeHtml(option.value)}">
        <span class="mobile-list-picker-radio" aria-hidden="true"></span>
        <span class="mobile-list-picker-option-text">${escapeHtml(option.label || option.value)}</span>
      </button>`;
  }).join('');

  container.querySelectorAll('.mobile-list-picker-option').forEach(button => {
    button.addEventListener('click', () => {
      mobileListPickerState.selectedValue = button.dataset.value;
      renderMobileListPickerOptions(document.getElementById('mobile-list-picker-search').value);
    });
  });
}

function commitMobileListPickerSelection() {
  if (!mobileListPickerState?.element) return;
  const { element, options, selectedValue } = mobileListPickerState;
  const selected = options.find(option => String(option.value) === String(selectedValue));
  if (!selected) return;
  element.value = selected.value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function closeMobileListPicker() {
  closeModal('mobile-list-picker');
  document.body.classList.remove('mobile-list-picker-open');
  mobileListPickerState = null;
}

function bindMobileListPicker(element) {
  if (!element || element.dataset.mobilePickerBound === 'true') return;
  element.dataset.mobilePickerBound = 'true';

  const openHandler = event => {
    if (!shouldUseMobileListPicker(element)) {
      syncMobileListPickerState(element);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openMobileListPicker(element);
  };

  if (element.matches('input[list]')) {
    syncMobileListPickerState(element);
    window.addEventListener('resize', () => {
      syncMobileListPickerState(element);
    });
  }

  element.addEventListener('mousedown', openHandler);
  element.addEventListener('touchstart', openHandler, { passive: false });
  element.addEventListener('focus', event => {
    if (!shouldUseMobileListPicker(element)) {
      syncMobileListPickerState(element);
      return;
    }
    event.preventDefault();
    openMobileListPicker(element);
    element.blur();
  });
}

function bootMobileListPickers(root = document) {
  root.querySelectorAll('select.form-control:not([multiple]), input.form-control[list]').forEach(bindMobileListPicker);
  root.querySelectorAll('input.form-control[list]').forEach(syncMobileListPickerState);
}

// Format helpers
function fmtDate(d) { if (!d) return '-'; return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtHours(h) {
  const totalMinutes = Math.max(0, Math.round((parseFloat(h) || 0) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
function fmtCurrency(v) { return 'Rs ' + (parseFloat(v)||0).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:0}); }

const MASTER_DATA_CACHE_KEY = 'ts_master_data_cache';
let MASTER_DATA = {
  work_categories: [],
  work_classifications: [],
  udin_assignments: [],
  financial_years: []
};

const TIMESHEET_MASTER_CACHE_KEY = 'ts_timesheet_master_cache';
let TIMESHEET_MASTER_DATA = {
  holidays: [],
  shifts: [],
  client_sites: [],
  configured_clients: []
};

try {
  const cached = JSON.parse(localStorage.getItem(MASTER_DATA_CACHE_KEY) || 'null');
  if (cached?.work_categories && cached?.work_classifications) {
    MASTER_DATA = cached;
  }
} catch {}

function humanizeKey(value = '') {
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function setMasterData(data = {}) {
  MASTER_DATA = {
    work_categories: Array.isArray(data.work_categories) ? data.work_categories : [],
    work_classifications: Array.isArray(data.work_classifications) ? data.work_classifications : [],
    udin_assignments: Array.isArray(data.udin_assignments) ? data.udin_assignments : [],
    financial_years: Array.isArray(data.financial_years) ? data.financial_years : []
  };
  try {
    localStorage.setItem(MASTER_DATA_CACHE_KEY, JSON.stringify(MASTER_DATA));
  } catch {}
}

async function ensureMasterDataLoaded(force = false) {
  if (!force && MASTER_DATA.work_categories.length && MASTER_DATA.work_classifications.length) {
    return MASTER_DATA;
  }
  const data = await apiFetch('/master-data');
  setMasterData(data);
  return MASTER_DATA;
}

function setTimesheetMasterData(data = {}) {
  TIMESHEET_MASTER_DATA = {
    holidays: Array.isArray(data.holidays) ? data.holidays : [],
    shifts: Array.isArray(data.shifts) ? data.shifts : [],
    client_sites: Array.isArray(data.client_sites) ? data.client_sites : [],
    configured_clients: Array.isArray(data.configured_clients) ? data.configured_clients : []
  };
  try {
    localStorage.setItem(TIMESHEET_MASTER_CACHE_KEY, JSON.stringify(TIMESHEET_MASTER_DATA));
  } catch {}
}

try {
  const cached = JSON.parse(localStorage.getItem(TIMESHEET_MASTER_CACHE_KEY) || 'null');
  if (cached?.holidays && cached?.shifts && cached?.client_sites && cached?.configured_clients) {
    TIMESHEET_MASTER_DATA = cached;
  }
} catch {}

async function ensureTimesheetMastersLoaded(force = false) {
  if (!force && TIMESHEET_MASTER_DATA.holidays.length && TIMESHEET_MASTER_DATA.shifts.length && TIMESHEET_MASTER_DATA.client_sites.length) {
    return TIMESHEET_MASTER_DATA;
  }
  const data = await apiFetch('/timesheet-masters');
  setTimesheetMasterData(data);
  return TIMESHEET_MASTER_DATA;
}

function getTimesheetHolidays() {
  return TIMESHEET_MASTER_DATA.holidays || [];
}

function getTimesheetShifts() {
  return TIMESHEET_MASTER_DATA.shifts || [];
}

function getTimesheetClientSites() {
  return TIMESHEET_MASTER_DATA.client_sites || [];
}

function getConfiguredTimesheetClients() {
  return TIMESHEET_MASTER_DATA.configured_clients || [];
}

function getWorkCategories(includeInactive = false) {
  return MASTER_DATA.work_categories.filter(item => includeInactive || item.active);
}

function getWorkClassifications(includeInactive = false) {
  return MASTER_DATA.work_classifications.filter(item => includeInactive || item.active);
}

function normalizeWorkClassification(value, billable = null) {
  if (value) return value;
  if (billable === 1 || billable === true) return 'client_work';
  if (billable === 0 || billable === false) return 'internal';
  return 'client_work';
}

function workClassificationMeta(value, billable = null) {
  const normalized = normalizeWorkClassification(value, billable);
  const match = getWorkClassifications(true).find(c => c.key === normalized || c.value === normalized);
  if (match) {
    return {
      value: match.key || match.value,
      label: match.label,
      shortLabel: match.short_label || match.shortLabel || match.label
    };
  }
  return {
    value: normalized,
    label: humanizeKey(normalized),
    shortLabel: humanizeKey(normalized)
  };
}

function workClassificationBadge(value, billable = null) {
  const meta = workClassificationMeta(value, billable);
  return `<span class="badge badge-work-${meta.value}">${meta.label}</span>`;
}

// Status badge â€” 5 statuses for 3-tier
function statusBadge(status) {
  const map = {
    draft: ['badge-draft','Draft'],
    pending_manager: ['badge-pending_manager','Mgr Review'],
    pending_partner: ['badge-pending_partner','Partner Review'],
    approved: ['badge-approved','Approved'],
    rejected: ['badge-rejected','Rejected']
  };
  const [cls, label] = map[status] || ['badge-draft', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function compactStatusBadge(status) {
  const map = {
    draft: ['badge-draft', 'Draft'],
    pending_manager: ['badge-pending_manager', 'Pending'],
    pending_partner: ['badge-pending_partner', 'Pending'],
    approved: ['badge-approved', 'Approved'],
    rejected: ['badge-rejected', 'Rejected']
  };
  const [cls, label] = map[status] || ['badge-draft', 'Draft'];
  return `<span class="status-chip ${cls}"><span class="status-dot"></span>${label}</span>`;
}

// Role badge
function roleBadge(role) {
  const map = { partner:'badge-partner', manager:'badge-manager', article:'badge-article' };
  return `<span class="badge ${map[role]||'badge-article'}">${role}</span>`;
}

function canViewFirmActivityReport(user = getUser()) {
  return !!(user && (
    hasPermission('firm.dashboard.view') ||
    hasPermission('reports.view') ||
    hasPermission('access.manage')
  ));
}

function formatFirmActivityTimestamp(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  }).format(date);
}

function renderFirmActivitySummary(summary = {}, users = []) {
  return {
    totalUsers: String(summary.total_users ?? users.length ?? 0),
    onlineUsers: String(summary.online_users ?? users.filter(user => user.is_online).length),
    offlineUsers: String(summary.offline_users ?? users.filter(user => !user.is_online).length)
  };
}

function renderFirmActivityRows(users = []) {
  if (!users.length) {
    return `<tr><td colspan="5">${renderEmptyState({ icon: '👥', title: 'No firm activity yet', subtitle: 'Login and activity data will appear here after users start signing in.' })}</td></tr>`;
  }

  return users.map(user => `
    <tr>
      <td data-label="User">
        <div style="font-weight:700;">${escapeHtml(user.name || user.username || 'User')}</div>
        <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(user.username || '')}</div>
      </td>
      <td data-label="Role">${roleBadge(user.role || 'article')}</td>
      <td data-label="Status">${user.is_online ? '<span class="badge badge-online">Online</span>' : '<span class="badge badge-offline">Offline</span>'}</td>
      <td data-label="Last Login">${formatFirmActivityTimestamp(user.last_login_at)}</td>
      <td data-label="Last Activity">${formatFirmActivityTimestamp(user.last_activity_at)}</td>
    </tr>
  `).join('');
}

async function fetchFirmActivitySummary() {
  return apiFetch('/reports/firm-login-summary');
}

function applyFirmActivityReport({
  badgeEl,
  totalEl,
  onlineEl,
  offlineEl,
  bodyEl
}, data = {}) {
  if (!bodyEl) return;
  const users = Array.isArray(data.users) ? data.users : [];
  const summary = renderFirmActivitySummary(data.summary || {}, users);
  if (badgeEl) badgeEl.textContent = users.length ? 'Live access' : 'No activity';
  if (totalEl) totalEl.textContent = summary.totalUsers;
  if (onlineEl) onlineEl.textContent = summary.onlineUsers;
  if (offlineEl) offlineEl.textContent = summary.offlineUsers;
  bodyEl.innerHTML = renderFirmActivityRows(users);
}

async function loadFirmActivityReport(elements = {}) {
  const {
    badgeEl,
    totalEl,
    onlineEl,
    offlineEl,
    bodyEl
  } = elements;

  if (!bodyEl || !canViewFirmActivityReport()) return false;
  bodyEl.innerHTML = `<tr><td colspan="5">${renderEmptyState({ icon: '⏳', title: 'Loading firm activity', subtitle: 'Fetching the latest login and activity snapshot.' })}</td></tr>`;
  try {
    const data = await fetchFirmActivitySummary();
    applyFirmActivityReport({ badgeEl, totalEl, onlineEl, offlineEl, bodyEl }, data);
    return true;
  } catch (err) {
    if (badgeEl) badgeEl.textContent = 'Unavailable';
    bodyEl.innerHTML = `<tr><td colspan="5">${renderEmptyState({ icon: '⚠', title: 'Could not load firm activity', subtitle: err.message || 'The access report is temporarily unavailable.' })}</td></tr>`;
    return false;
  }
}

function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function today() { return localISODate(); }
function weekBounds() {
  const now = new Date(); const day = now.getDay();
  const diff = day===0 ? -6 : 1-day;
  const mon = new Date(now); mon.setDate(now.getDate()+diff);
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  return { from: localISODate(mon), to: localISODate(sun) };
}

// Build sidebar nav based on role
function buildSidebar() {
  const user = getUser();
  if (!user) return;
  const displayName = safeUserName(user);
  const displayRole = String(user.role || 'user');

  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  const avatarEl = document.getElementById('sidebar-avatar');
  if (nameEl) nameEl.textContent = displayName;
  if (roleEl) roleEl.textContent = displayRole.charAt(0).toUpperCase() + displayRole.slice(1);
  if (avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();

  // Show/hide role-gated nav items
  document.querySelectorAll('[data-roles]').forEach(el => {
    const allowed = el.dataset.roles.split(',');
    el.style.display = allowed.includes(displayRole) ? '' : 'none';
  });

  document.querySelectorAll('[data-permissions]').forEach(el => {
    const allowed = el.dataset.permissions.split(',');
    el.style.display = allowed.some(permission => hasPermission(permission)) ? '' : 'none';
  });

  // Mark active
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === current);
  });

  injectModuleSwitcher();
}

function injectModuleSwitcher() {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  if (['module-select.html', 'firm-dashboard.html', 'index.html'].includes(current)) return;

  const actions = document.querySelector('.topbar-actions');
  const topbar = document.querySelector('.topbar');
  const host = actions || topbar;
  if (!host || host.querySelector('[data-module-switcher]')) return;

  const link = document.createElement('a');
  link.href = '/module-select.html';
  link.className = 'btn btn-ghost btn-sm';
  link.dataset.moduleSwitcher = 'true';
  link.innerHTML = '<span class="btn-symbol" aria-hidden="true">⇆</span><span class="btn-label">Modules</span>';
  if (actions) {
    actions.prepend(link);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'topbar-actions';
  wrapper.appendChild(link);
  topbar.appendChild(wrapper);
}

// Canonical sidebar HTML â€” call this in each page's <aside>
function SIDEBAR_HTML() {
  return `
    <div class="sidebar-logo">
      <div class="logo-mark">
        <div class="logo-icon">CA</div>
        <div><div class="logo-text">Samay</div><div class="logo-sub">Practice Management</div></div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <span class="nav-section-label">Workspace</span>
      <a class="nav-item nav-item-dashboard" data-page="dashboard.html" href="/dashboard.html"><span class="nav-icon" aria-hidden="true">⌂</span><span class="nav-label">Dashboard</span></a>
      <a class="nav-item nav-item-timesheet" data-page="timesheet.html" href="/timesheet.html"><span class="nav-icon" aria-hidden="true">◔</span><span class="nav-label">Log Time</span></a>
      <a class="nav-item nav-item-mine" data-page="my-timesheets.html" href="/my-timesheets.html"><span class="nav-icon" aria-hidden="true">▤</span><span class="nav-label">My Timesheets</span></a>
      <a class="nav-item nav-item-attendance" data-page="attendance.html" href="/attendance.html" data-permissions="attendance.view_reports,attendance.view_own,attendance.create_own,staff.view"><span class="nav-icon" aria-hidden="true">⧗</span><span class="nav-label">Attendance</span></a>
      <a class="nav-item nav-item-udin" data-page="udin.html" href="/udin.html" data-permissions="udin.dashboard.view,udin.view_own,udin.create,udin.review,udin.update,udin.revoke"><span class="nav-icon" aria-hidden="true">#</span><span class="nav-label">UDIN Tracker</span></a>
      <span class="nav-section-label" data-permissions="approvals.view_manager_queue,approvals.view_partner_queue,reports.view,feedback.view">Management</span>
      <a class="nav-item nav-item-approvals" data-page="approvals.html" href="/approvals.html" data-permissions="approvals.view_manager_queue,approvals.view_partner_queue"><span class="nav-icon" aria-hidden="true">✓</span><span class="nav-label">Approvals</span></a>
      <a class="nav-item nav-item-reports" data-page="reports.html" href="/reports.html" data-permissions="reports.view,feedback.view"><span class="nav-icon" aria-hidden="true">◌</span><span class="nav-label">Reports</span></a>
      <span class="nav-section-label" data-permissions="firm.dashboard.view,modules.view">Firm</span>
      <a class="nav-item nav-item-firm-dashboard" data-page="firm-dashboard.html" href="/firm-dashboard.html" data-permissions="firm.dashboard.view"><span class="nav-icon" aria-hidden="true">⌂</span><span class="nav-label">Firm Dashboard</span></a>
      <a class="nav-item nav-item-modules" data-page="module-select.html" href="/module-select.html" data-permissions="modules.view"><span class="nav-icon" aria-hidden="true">⇄</span><span class="nav-label">Go to Module</span></a>
    </nav>
    <div class="sidebar-footer">
      <div class="user-pill">
        <div class="user-avatar" id="sidebar-avatar">A</div>
        <div class="user-info">
          <div class="user-name" id="sidebar-user-name">-</div>
          <div class="user-role" id="sidebar-user-role">-</div>
        </div>
        <button class="logout-btn" onclick="logout()" title="Logout">&#x21AA;</button>
      </div>
    </div>`;
}

function TIMESHEET_SIDEBAR_HTML() {
  return `
    <div class="sidebar-logo">
      <div class="logo-mark">
        <div class="logo-icon">CA</div>
        <div><div class="logo-text">Samay</div><div class="logo-sub">Practice Management</div></div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <span class="nav-section-label">Workspace</span>
      <a class="nav-item nav-item-dashboard" data-page="dashboard.html" href="/dashboard.html"><span class="nav-icon" aria-hidden="true">⌂</span><span class="nav-label">Dashboard</span></a>
      <a class="nav-item nav-item-timesheet" data-page="timesheet.html" href="/timesheet.html"><span class="nav-icon" aria-hidden="true">◔</span><span class="nav-label">Log Time</span></a>
      <a class="nav-item nav-item-mine" data-page="my-timesheets.html" href="/my-timesheets.html"><span class="nav-icon" aria-hidden="true">▤</span><span class="nav-label">My Timesheets</span></a>
      <a class="nav-item nav-item-timesheet-masters" data-page="timesheet-masters.html" href="/timesheet-masters.html" data-permissions="timesheets.masters.view"><span class="nav-icon" aria-hidden="true">▣</span><span class="nav-label">Timesheet Masters</span></a>
      <a class="nav-item nav-item-attendance" data-page="attendance.html" href="/attendance.html" data-permissions="attendance.view_reports,attendance.view_own,attendance.create_own,staff.view"><span class="nav-icon" aria-hidden="true">⧗</span><span class="nav-label">Attendance</span></a>
      <a class="nav-item nav-item-udin" data-page="udin.html" href="/udin.html" data-permissions="udin.dashboard.view,udin.view_own,udin.create,udin.review,udin.update,udin.revoke"><span class="nav-icon" aria-hidden="true">#</span><span class="nav-label">UDIN Tracker</span></a>
      <span class="nav-section-label" data-permissions="approvals.view_manager_queue,approvals.view_partner_queue,reports.view,feedback.view">Management</span>
      <a class="nav-item nav-item-approvals" data-page="approvals.html" href="/approvals.html" data-permissions="approvals.view_manager_queue,approvals.view_partner_queue"><span class="nav-icon" aria-hidden="true">✓</span><span class="nav-label">Approvals</span></a>
      <a class="nav-item nav-item-reports" data-page="reports.html" href="/reports.html" data-permissions="reports.view,feedback.view"><span class="nav-icon" aria-hidden="true">◌</span><span class="nav-label">Reports</span></a>
      <span class="nav-section-label" data-permissions="firm.dashboard.view,modules.view">Firm</span>
      <a class="nav-item nav-item-firm-dashboard" data-page="firm-dashboard.html" href="/firm-dashboard.html" data-permissions="firm.dashboard.view"><span class="nav-icon" aria-hidden="true">⌂</span><span class="nav-label">Firm Dashboard</span></a>
      <a class="nav-item nav-item-modules" data-page="module-select.html" href="/module-select.html" data-permissions="modules.view"><span class="nav-icon" aria-hidden="true">⇄</span><span class="nav-label">Go to Module</span></a>
    </nav>
    <div class="sidebar-footer">
      <div class="user-pill">
        <div class="user-avatar" id="sidebar-avatar">A</div>
        <div class="user-info">
          <div class="user-name" id="sidebar-user-name">-</div>
          <div class="user-role" id="sidebar-user-role">-</div>
        </div>
        <button class="logout-btn" onclick="logout()" title="Logout">&#x21AA;</button>
      </div>
    </div>`;
}

// Sidebar HTML for Form 15CB module
function FORM15CB_SIDEBAR_HTML() {
  return `
    <div class="sidebar-logo">
      <div class="logo-mark">
        <div class="logo-icon">CA</div>
        <div><div class="logo-text">Samay</div><div class="logo-sub">Form 15CB</div></div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <span class="nav-section-label">Form 15CB</span>
      <a class="nav-item nav-item-form15cb-dashboard" data-page="form15cb.html" href="/form15cb.html"><span class="nav-icon" aria-hidden="true">⌂</span><span class="nav-label">Dashboard</span></a>
      <a class="nav-item nav-item-form15cb-convert" data-page="form15cb-convert.html" href="/form15cb-convert.html"><span class="nav-icon" aria-hidden="true">⇄</span><span class="nav-label">Convert 15CB</span></a>
      <a class="nav-item nav-item-form15cb-transactions" data-page="form15cb-transactions.html" href="/form15cb-transactions.html"><span class="nav-icon" aria-hidden="true">▤</span><span class="nav-label">Transactions</span></a>
      <span class="nav-section-label">Masters</span>
      <a class="nav-item nav-item-form15cb-masters" data-page="form15cb-masters.html" href="/form15cb-masters.html"><span class="nav-icon" aria-hidden="true">◎</span><span class="nav-label">Masters</span></a>
      <span class="nav-section-label">Settings</span>
      <a class="nav-item" href="/module-select.html"><span class="nav-icon" aria-hidden="true">⇦</span><span class="nav-label">Switch Module</span></a>
    </nav>
    <div class="sidebar-footer">
      <div class="user-pill">
        <div class="user-avatar" id="sidebar-avatar">A</div>
        <div class="user-info">
          <div class="user-name" id="sidebar-user-name">-</div>
          <div class="user-role" id="sidebar-user-role">-</div>
        </div>
        <button class="logout-btn" onclick="logout()" title="Logout">&#x21AA;</button>
      </div>
    </div>`;
}

function FIRM_SIDEBAR_HTML() {
  return `
    <div class="sidebar-logo">
      <div class="logo-mark">
        <div class="logo-icon">CA</div>
        <div><div class="logo-text">Samay</div><div class="logo-sub">Firm Control</div></div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <span class="nav-section-label">Firm</span>
      <a class="nav-item nav-item-firm-dashboard" data-page="firm-dashboard.html" href="/firm-dashboard.html" data-permissions="firm.dashboard.view"><span class="nav-icon" aria-hidden="true">⌂</span><span class="nav-label">Firm Dashboard</span></a>
      <a class="nav-item nav-item-firm-masters" data-page="firm-masters.html" href="/firm-masters.html" data-permissions="firm.dashboard.view"><span class="nav-icon" aria-hidden="true">▤</span><span class="nav-label">Firm Masters</span></a>
      <a class="nav-item nav-item-modules" data-page="module-select.html" href="/module-select.html" data-permissions="modules.view"><span class="nav-icon" aria-hidden="true">⇄</span><span class="nav-label">Go to Module</span></a>
      <a class="nav-item nav-item-users" data-page="users.html" href="/users.html" data-permissions="staff.view"><span class="nav-icon" aria-hidden="true">◎</span><span class="nav-label">Users</span></a>
      <a class="nav-item nav-item-clients" data-page="clients.html" href="/clients.html" data-permissions="clients.view"><span class="nav-icon" aria-hidden="true">▣</span><span class="nav-label">Clients</span></a>
    </nav>
    <div class="sidebar-footer">
      <div class="user-pill">
        <div class="user-avatar" id="sidebar-avatar">A</div>
        <div class="user-info">
          <div class="user-name" id="sidebar-user-name">-</div>
          <div class="user-role" id="sidebar-user-role">-</div>
        </div>
        <button class="logout-btn" onclick="logout()" title="Logout">&#x21AA;</button>
      </div>
    </div>`;
}

function getTaskTypes(includeInactive = false) {
  return getWorkCategories(includeInactive).map(item => item.label);
}

if (typeof window !== 'undefined' && window.location.pathname !== '/') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bootMobileKeyboardSupport();
      bootSessionKeepAlive();
      bootContactCatchupGate();
      bootMobileListPickers();
    }, { once: true });
  } else {
    bootMobileKeyboardSupport();
    bootSessionKeepAlive();
    bootContactCatchupGate();
    bootMobileListPickers();
  }
}



