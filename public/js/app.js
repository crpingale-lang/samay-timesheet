// ─── SHARED APP UTILITIES ───────────────────────────────────────────────────

const API = '/api';

// Auth helpers
function getToken() { return localStorage.getItem('ts_token'); }
function getUser() { return JSON.parse(localStorage.getItem('ts_user') || 'null'); }
function isPartner() { return getUser()?.role === 'partner'; }
function isManager() { return getUser()?.role === 'manager'; }
function isManagerOrAbove() { return ['partner','manager'].includes(getUser()?.role); }
function isArticle() { return getUser()?.role === 'article'; }

function setSession(token, user) {
  localStorage.setItem('ts_token', token);
  localStorage.setItem('ts_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('ts_token');
  localStorage.removeItem('ts_user');
}
function requireAuth(managerAbove = false) {
  const token = getToken(); const user = getUser();
  if (!token || !user) { window.location.href = '/'; return false; }
  if (managerAbove && !['manager','partner'].includes(user.role)) { window.location.href = '/dashboard.html'; return false; }
  return true;
}
function requirePartner() {
  const user = getUser();
  if (!user) { window.location.href = '/'; return false; }
  if (user.role !== 'partner') { window.location.href = '/dashboard.html'; return false; }
  return true;
}
function logout() { clearSession(); window.location.href = '/'; }

// API fetch wrapper
async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// Toast
function toast(message, type = 'success') {
  const container = document.getElementById('toast-container') || (() => {
    const el = document.createElement('div'); el.id = 'toast-container'; el.className = 'toast-container';
    document.body.appendChild(el); return el;
  })();
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='0.3s'; setTimeout(()=>t.remove(),300); }, 3500);
}

// Modal helpers
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function closeAllModals() { document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open')); }
document.addEventListener('keydown', e => { if (e.key==='Escape') closeAllModals(); });

// Format helpers
function fmtDate(d) { if (!d) return '—'; return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtHours(h) { return (parseFloat(h)||0).toFixed(1)+' hrs'; }
function fmtCurrency(v) { return '₹'+(parseFloat(v)||0).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:0}); }

// Status badge — 5 statuses for 3-tier
function statusBadge(status) {
  const map = {
    draft: ['badge-draft','Draft'],
    pending_manager: ['badge-pending_manager','⏳ Mgr Review'],
    pending_partner: ['badge-pending_partner','⏳ Partner Review'],
    approved: ['badge-approved','✓ Approved'],
    rejected: ['badge-rejected','✕ Rejected']
  };
  const [cls, label] = map[status] || ['badge-draft', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

// Role badge
function roleBadge(role) {
  const map = { partner:'badge-partner', manager:'badge-manager', article:'badge-article' };
  return `<span class="badge ${map[role]||'badge-article'}">${role}</span>`;
}

function today() { return new Date().toISOString().split('T')[0]; }
function weekBounds() {
  const now = new Date(); const day = now.getDay();
  const diff = day===0 ? -6 : 1-day;
  const mon = new Date(now); mon.setDate(now.getDate()+diff);
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  return { from: mon.toISOString().split('T')[0], to: sun.toISOString().split('T')[0] };
}

// Build sidebar nav based on role
function buildSidebar() {
  const user = getUser();
  if (!user) return;

  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  const avatarEl = document.getElementById('sidebar-avatar');
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
  if (avatarEl) avatarEl.textContent = user.name.charAt(0).toUpperCase();

  // Show/hide role-gated nav items
  document.querySelectorAll('[data-roles]').forEach(el => {
    const allowed = el.dataset.roles.split(',');
    el.style.display = allowed.includes(user.role) ? '' : 'none';
  });

  // Mark active
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === current);
  });
}

// Canonical sidebar HTML — call this in each page's <aside>
function SIDEBAR_HTML() {
  return `
    <div class="sidebar-logo">
      <div class="logo-mark">
        <div class="logo-icon">CA</div>
        <div><div class="logo-text">Samay</div><div class="logo-sub">Practice Management</div></div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <span class="nav-section-label">Main</span>
      <a class="nav-item" data-page="dashboard.html" href="/dashboard.html"><span class="icon">📊</span> Dashboard</a>
      <a class="nav-item" data-page="timesheet.html" href="/timesheet.html"><span class="icon">⏱️</span> Log Time</a>
      <a class="nav-item" data-page="my-timesheets.html" href="/my-timesheets.html"><span class="icon">📋</span> My Timesheets</a>
      <span class="nav-section-label" data-roles="partner,manager">Management</span>
      <a class="nav-item" data-page="approvals.html" href="/approvals.html" data-roles="partner,manager"><span class="icon">✅</span> Approvals</a>
      <a class="nav-item" data-page="reports.html" href="/reports.html" data-roles="partner,manager"><span class="icon">📈</span> Reports</a>
      <span class="nav-section-label" data-roles="partner">Admin</span>
      <a class="nav-item" data-page="clients.html" href="/clients.html" data-roles="partner"><span class="icon">🏢</span> Clients</a>
      <a class="nav-item" data-page="staff.html" href="/staff.html" data-roles="partner"><span class="icon">👥</span> Staff</a>
    </nav>
    <div class="sidebar-footer">
      <div class="user-pill">
        <div class="user-avatar" id="sidebar-avatar">A</div>
        <div class="user-info">
          <div class="user-name" id="sidebar-user-name">—</div>
          <div class="user-role" id="sidebar-user-role">—</div>
        </div>
        <button class="logout-btn" onclick="logout()" title="Logout">⏻</button>
      </div>
    </div>`;
}

// Task types specific to CA industry
const TASK_TYPES = [
  'GST Filing', 'GST Reconciliation', 'Income Tax Return', 'TDS / TCS Filing',
  'Statutory Audit', 'Tax Audit', 'Internal Audit', 'ROC / MCA Filing',
  'Company Incorporation', 'Accounts & Bookkeeping', 'Payroll Processing',
  'Advisory / Consultation', 'Client Meeting', 'Internal Meeting',
  'Training / CPD', 'FEMA / RBI Compliance', 'Administrative', 'Other'
];
