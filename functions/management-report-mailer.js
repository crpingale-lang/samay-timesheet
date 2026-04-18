const functions = require('firebase-functions');
const nodemailer = require('nodemailer');
const { db } = require('./db');
const { getUsersMap, getClientsMap } = require('./data-cache');

const REPORT_TIMEZONE = 'Asia/Kolkata';
const SHORT_DAY_THRESHOLD = 6;
const APPROVAL_BACKLOG_HOURS = 24;

let cachedTransport = null;

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isActiveUser(user = {}) {
  return user.active !== false && user.active !== 0 && user.active !== '0';
}

function isPartner(role) {
  return normalizeRole(role) === 'partner';
}

function isManagerLike(role) {
  return ['manager', 'partner'].includes(normalizeRole(role));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function currentIndiaDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseIsoDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10)
  };
}

function formatIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftIsoDate(value, deltaDays) {
  const parts = parseIsoDateParts(value);
  if (!parts) return value;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return formatIsoDate(date);
}

function weekBoundsForDate(value) {
  const parts = parseIsoDateParts(value);
  if (!parts) return { from: value, to: value };
  const current = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = current.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  current.setUTCDate(current.getUTCDate() + diff);
  const start = new Date(current);
  const end = new Date(current);
  end.setUTCDate(end.getUTCDate() + 6);
  return { from: formatIsoDate(start), to: formatIsoDate(end) };
}

function previousWeekBounds(referenceDate = currentIndiaDate()) {
  const currentWeek = weekBoundsForDate(referenceDate);
  return {
    from: shiftIsoDate(currentWeek.from, -7),
    to: shiftIsoDate(currentWeek.to, -7)
  };
}

function dateRangeDays(from, to) {
  const dayKeys = [];
  if (!from || !to) return dayKeys;
  for (let cursor = from; cursor <= to; cursor = shiftIsoDate(cursor, 1)) {
    dayKeys.push(cursor);
    if (cursor === to) break;
  }
  return dayKeys;
}

function formatHours(hours) {
  const totalMinutes = Math.max(0, Math.round((parseFloat(hours) || 0) * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatLabelForDate(isoDate) {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: REPORT_TIMEZONE
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function formatShortLabelForDate(isoDate) {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: REPORT_TIMEZONE
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function formatRangeLabel(from, to) {
  return `${formatLabelForDate(from)} to ${formatLabelForDate(to)}`;
}

function minutesToAgeHours(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    return (Date.now() - value.toDate().getTime()) / 36e5;
  }
  if (value instanceof Date) {
    return (Date.now() - value.getTime()) / 36e5;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return (Date.now() - parsed.getTime()) / 36e5;
    }
  }
  if (typeof value === 'object' && Number.isFinite(value._seconds)) {
    return (Date.now() - (value._seconds * 1000)) / 36e5;
  }
  return null;
}

function getRuntimeConfig() {
  try {
    return typeof functions.config === 'function' ? (functions.config() || {}) : {};
  } catch {
    return {};
  }
}

function getConfigValue(path, fallback = '') {
  const envValue = process.env[path.toUpperCase().replace(/\./g, '_')];
  if (envValue != null && String(envValue).trim() !== '') return String(envValue).trim();

  const config = getRuntimeConfig();
  const parts = String(path || '').split('.');
  let current = config;
  for (const part of parts) {
    if (current && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part];
    } else {
      current = undefined;
      break;
    }
  }
  if (current == null || current === '') return fallback;
  return String(current).trim();
}

function getConfigBoolean(path, fallback = false) {
  const value = getConfigValue(path, '');
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function getConfigPort(path, fallback = 587) {
  const value = parseInt(getConfigValue(path, ''), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getConfigList(path, fallback = []) {
  const raw = getConfigValue(path, '');
  if (!raw) return fallback;
  return raw.split(',').map(value => value.trim()).filter(Boolean);
}

function getRecipientOverrideEmails() {
  return [
    ...getConfigList('reports.recipients'),
    ...getConfigList('reports.recipient_emails'),
    ...getConfigList('REPORT_RECIPIENT_EMAILS')
  ];
}

async function getPartnerRecipients() {
  const overrideEmails = getRecipientOverrideEmails();
  if (overrideEmails.length) {
    return overrideEmails.map(email => ({
      email,
      name: email
    }));
  }

  const users = await getUsersMap();
  const recipients = [];
  users.forEach((user, id) => {
    if (!isActiveUser(user)) return;
    if (!isPartner(user.role)) return;
    const email = String(user.email || '').trim();
    if (!email) return;
    recipients.push({
      id,
      email,
      name: String(user.name || user.username || email).trim(),
      role: normalizeRole(user.role)
    });
  });

  const seen = new Set();
  return recipients
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(recipient => {
      const normalized = recipient.email.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function getMailTransport() {
  if (cachedTransport) return cachedTransport;

  const host = getConfigValue('smtp.host', getConfigValue('mail.host', ''));
  const user = getConfigValue('smtp.user', getConfigValue('mail.user', ''));
  const pass = getConfigValue('smtp.pass', getConfigValue('mail.pass', ''));
  const secure = getConfigBoolean('smtp.secure', getConfigBoolean('mail.secure', false));
  const port = getConfigPort('smtp.port', getConfigPort('mail.port', secure ? 465 : 587));

  if (!host || !user || !pass) {
    throw new Error('SMTP configuration missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and REPORT_FROM_EMAIL.');
  }

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    }
  });

  return cachedTransport;
}

function formatMetricCards(metrics) {
  return metrics.map(metric => `
    <div class="metric-card">
      <div class="metric-label">${escapeHtml(metric.label)}</div>
      <div class="metric-value">${escapeHtml(metric.value)}</div>
      <div class="metric-note">${escapeHtml(metric.note || '')}</div>
    </div>
  `).join('');
}

function renderTable(headers, rows, emptyLabel = 'No rows to show for this period.') {
  if (!rows.length) {
    return `<div class="empty-block">${escapeHtml(emptyLabel)}</div>`;
  }
  return `
    <table class="report-table">
      <thead>
        <tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;
}

function classifyClientPriority(client) {
  const total = client.total_hours || 0;
  const managerShare = total > 0 ? client.manager_hours / total : 0;
  if (total >= client.highThreshold || client.manager_hours >= client.managerThreshold || managerShare >= 0.35) {
    return 'High';
  }
  if (total >= client.mediumThreshold || client.manager_hours >= 1) {
    return 'Medium';
  }
  return 'Low';
}

async function loadReportData({ from, to, periodLabel, reportKind }) {
  const [usersMap, clientsMap, timesheetSnap] = await Promise.all([
    getUsersMap(),
    getClientsMap(),
    db.collection('timesheets')
      .where('entry_date', '>=', from)
      .where('entry_date', '<=', to)
      .get()
  ]);

  const users = [];
  usersMap.forEach((user, id) => {
    users.push({
      id: String(id),
      name: String(user.name || user.username || 'Unknown'),
      role: normalizeRole(user.role),
      designation: String(user.designation || ''),
      active: isActiveUser(user)
    });
  });

  const activeOperationsUsers = users.filter(user => user.active && ['manager', 'article'].includes(user.role));
  const userById = new Map(users.map(user => [String(user.id), user]));
  const clientById = new Map();
  clientsMap.forEach((client, id) => {
    if (client.active === false || client.active === 0 || client.active === '0') return;
    clientById.set(String(id), {
      id: String(id),
      name: String(client.name || client.code || 'Unknown client'),
      code: String(client.code || ''),
      billing_rate: parseFloat(client.billing_rate) || 0
    });
  });

  const dayKeys = dateRangeDays(from, to);
  const dailyTotals = new Map();
  const clientStats = new Map();
  const backlog = [];
  const statusCounts = {
    draft: 0,
    pending_manager: 0,
    pending_partner: 0,
    approved: 0,
    rejected: 0
  };

  timesheetSnap.forEach(doc => {
    const entry = doc.data() || {};
    const status = String(entry.status || 'draft').trim();
    const user = userById.get(String(entry.user_id || ''));
    const client = entry.client_id ? clientById.get(String(entry.client_id)) : null;
    const hours = parseFloat(entry.hours) || 0;

    if (Object.prototype.hasOwnProperty.call(statusCounts, status)) {
      statusCounts[status] += 1;
    } else {
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    if (status !== 'approved') {
      const ageHours = minutesToAgeHours(entry.created_at || entry.updated_at);
      backlog.push({
        entry_date: String(entry.entry_date || ''),
        staff_name: String(user?.name || 'Unknown'),
        staff_role: String(user?.role || 'article'),
        client_name: String(client?.name || 'Internal'),
        task_type: String(entry.task_type || ''),
        hours,
        status,
        ageHours: Number.isFinite(ageHours) ? ageHours : null
      });
    }

    if (status !== 'approved' || !user || !user.active) return;
    if (!entry.entry_date || !dayKeys.includes(String(entry.entry_date))) return;

    const dayKey = `${entry.user_id}:${entry.entry_date}`;
    dailyTotals.set(dayKey, (dailyTotals.get(dayKey) || 0) + hours);

    if (client) {
      if (!clientStats.has(client.id)) {
        clientStats.set(client.id, {
          id: client.id,
          name: client.name,
          code: client.code,
          article_hours: 0,
          manager_hours: 0,
          total_hours: 0,
          article_entries: 0,
          manager_entries: 0,
          highThreshold: reportKind === 'weekly' ? 20 : 8,
          mediumThreshold: reportKind === 'weekly' ? 10 : 4,
          managerThreshold: reportKind === 'weekly' ? 4 : 2
        });
      }
      const clientRow = clientStats.get(client.id);
      const role = normalizeRole(user?.role);
      clientRow.total_hours += hours;
      if (isManagerLike(role)) {
        clientRow.manager_hours += hours;
        clientRow.manager_entries += 1;
      } else {
        clientRow.article_hours += hours;
        clientRow.article_entries += 1;
      }
    }
  });

  const complianceRows = [];
  let totalMissingDays = 0;
  let totalShortDays = 0;
  let fullyCompliantUsers = 0;
  let totalTrackedHours = 0;

  for (const user of activeOperationsUsers) {
    const days = dayKeys.map(date => {
      const hours = dailyTotals.get(`${user.id}:${date}`) || 0;
      const status = hours === 0 ? 'missing' : hours < SHORT_DAY_THRESHOLD ? 'short' : 'good';
      return { date, hours, status };
    });

    const missingDays = days.filter(day => day.status === 'missing').length;
    const shortDays = days.filter(day => day.status === 'short').length;
    const totalHours = days.reduce((sum, day) => sum + day.hours, 0);
    const activeDays = days.filter(day => day.hours > 0).length;
    const avgHours = activeDays ? totalHours / activeDays : 0;
    const observation = missingDays > 0
      ? 'Missing update'
      : shortDays > 0
        ? 'Short day'
        : 'On track';

    totalMissingDays += missingDays;
    totalShortDays += shortDays;
    totalTrackedHours += totalHours;
    if (missingDays === 0 && shortDays === 0) fullyCompliantUsers += 1;

    complianceRows.push({
      name: user.name,
      role: user.role,
      designation: user.designation,
      totalHours,
      activeDays,
      avgHours,
      missingDays,
      shortDays,
      observation
    });
  }

  complianceRows.sort((a, b) => {
    const missingDiff = b.missingDays - a.missingDays;
    if (missingDiff !== 0) return missingDiff;
    const shortDiff = b.shortDays - a.shortDays;
    if (shortDiff !== 0) return shortDiff;
    const totalDiff = a.totalHours - b.totalHours;
    if (totalDiff !== 0) return totalDiff;
    const roleDiff = (a.role === 'manager' ? 1 : 2) - (b.role === 'manager' ? 1 : 2);
    if (roleDiff !== 0) return roleDiff;
    return a.name.localeCompare(b.name);
  });

  const efficiencyRows = complianceRows.map(row => ({
    ...row,
    avgHours: row.avgHours,
    load: row.totalHours >= (reportKind === 'weekly' ? 45 : 9)
      ? 'Heavy'
      : row.totalHours >= (reportKind === 'weekly' ? 25 : 5)
        ? 'Normal'
        : 'Light'
  }));

  const clientRows = [...clientStats.values()]
    .map(client => {
      client.priority = classifyClientPriority(client);
      client.reason = client.manager_hours >= client.article_hours
        ? 'Manager-heavy'
        : client.total_hours >= (reportKind === 'weekly' ? 20 : 8)
          ? 'High volume'
          : 'Article-heavy';
      return client;
    })
    .filter(client => client.total_hours > 0)
    .sort((a, b) => b.total_hours - a.total_hours || a.name.localeCompare(b.name));

  const backlogRows = backlog
    .sort((a, b) => {
      const ageDiff = (b.ageHours || 0) - (a.ageHours || 0);
      if (ageDiff !== 0) return ageDiff;
      return String(b.entry_date || '').localeCompare(String(a.entry_date || ''));
    })
    .slice(0, 8)
    .map(item => ({
      ...item,
      severity: item.status === 'draft' || item.status === 'pending_partner' || (item.ageHours != null && item.ageHours >= APPROVAL_BACKLOG_HOURS)
        ? 'High'
        : 'Medium'
    }));

  const topClientRows = clientRows.slice(0, 8);

  return {
    from,
    to,
    periodLabel,
    reportKind,
    totalTrackedHours: Number(totalTrackedHours.toFixed(2)),
    fullyCompliantUsers,
    complianceRows,
    efficiencyRows,
    clientRows: topClientRows,
    backlogRows,
    statusCounts,
    totalMissingDays,
    totalShortDays,
    totalOperationsUsers: activeOperationsUsers.length
  };
}

function buildDailyWeeklyHtml({ title, subtitle, rangeLabel, metrics, complianceRows, efficiencyRows, clientRows, backlogRows, statusCounts, footnote }) {
  const complianceTable = renderTable(
    ['Staff', 'Role', 'Total Hrs', 'Active Days', 'Avg/Day', 'Missing', 'Short', 'Observation'],
    complianceRows.map(row => [
      escapeHtml(row.name),
      escapeHtml(row.role),
      formatHours(row.totalHours),
      String(row.activeDays),
      formatHours(row.avgHours),
      row.missingDays ? `<span class="pill pill-red">${row.missingDays}</span>` : '<span class="pill pill-green">0</span>',
      row.shortDays ? `<span class="pill pill-amber">${row.shortDays}</span>` : '<span class="pill pill-green">0</span>',
      escapeHtml(row.observation)
    ])
  );

  const efficiencyTable = renderTable(
    ['Staff', 'Role', 'Total Hrs', 'Avg/Day', 'Load'],
    efficiencyRows.map(row => [
      escapeHtml(row.name),
      escapeHtml(row.role),
      formatHours(row.totalHours),
      formatHours(row.avgHours),
      `<span class="pill ${row.load === 'Heavy' ? 'pill-red' : row.load === 'Normal' ? 'pill-green' : 'pill-amber'}">${escapeHtml(row.load)}</span>`
    ])
  );

  const clientTable = renderTable(
    ['Client', 'Article Time', 'Manager Time', 'Total Time', 'Priority', 'Reason'],
    clientRows.map(row => [
      `${escapeHtml(row.name)}${row.code ? `<div class="subtle">${escapeHtml(row.code)}</div>` : ''}`,
      formatHours(row.article_hours),
      formatHours(row.manager_hours),
      formatHours(row.total_hours),
      `<span class="pill ${row.priority === 'High' ? 'pill-red' : row.priority === 'Medium' ? 'pill-amber' : 'pill-green'}">${escapeHtml(row.priority)}</span>`,
      escapeHtml(row.reason)
    ])
  );

  const backlogTable = renderTable(
    ['Date', 'Staff', 'Client', 'Status', 'Age', 'Issue'],
    backlogRows.map(row => [
      escapeHtml(formatShortLabelForDate(row.entry_date || currentIndiaDate())),
      `${escapeHtml(row.staff_name)}<div class="subtle">${escapeHtml(row.staff_role)}</div>`,
      escapeHtml(row.client_name || 'Internal'),
      `<span class="pill ${row.severity === 'High' ? 'pill-red' : 'pill-amber'}">${escapeHtml(row.status)}</span>`,
      row.ageHours == null ? '-' : `${row.ageHours.toFixed(1)}h`,
      escapeHtml(row.task_type || 'Pending review')
    ])
  );

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin:0; background:#f4f6fb; font-family: Arial, Helvetica, sans-serif; color:#10213a; }
      .wrap { max-width: 960px; margin: 0 auto; padding: 24px; }
      .panel { background:#fff; border-radius:16px; box-shadow:0 10px 30px rgba(16,33,58,.08); overflow:hidden; }
      .hero { padding: 28px 28px 18px; background: linear-gradient(135deg, #10213a 0%, #1e3a5f 100%); color:#fff; }
      .hero h1 { margin:0 0 8px; font-size: 24px; }
      .hero p { margin:0; opacity:.9; line-height:1.5; }
      .meta { padding: 16px 28px 0; font-size: 13px; color:#5c6b82; }
      .metrics { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:12px; padding: 20px 28px 0; }
      .metric-card { background:#f8fafc; border:1px solid #e6ecf4; border-radius:14px; padding:14px; }
      .metric-label { font-size:12px; color:#5c6b82; text-transform:uppercase; letter-spacing:.04em; }
      .metric-value { margin-top:6px; font-size:22px; font-weight:700; color:#10213a; }
      .metric-note { margin-top:6px; font-size:12px; color:#6b7b92; line-height:1.4; }
      .section { padding: 18px 28px 0; }
      .section h2 { margin:0 0 10px; font-size:18px; color:#10213a; }
      .section p { margin:0 0 12px; color:#516177; line-height:1.5; }
      .report-table { width:100%; border-collapse: collapse; font-size:13px; }
      .report-table th { text-align:left; padding:10px 12px; border-bottom:2px solid #dfe7f1; background:#f8fafc; color:#415168; }
      .report-table td { padding:10px 12px; border-bottom:1px solid #edf2f7; vertical-align:top; }
      .report-table tbody tr:nth-child(even) td { background:#fbfdff; }
      .empty-block { padding:14px; border:1px dashed #c9d5e3; border-radius:12px; color:#6b7b92; background:#fbfdff; }
      .pill { display:inline-block; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:700; }
      .pill-green { background:#dcfce7; color:#166534; }
      .pill-amber { background:#fef3c7; color:#92400e; }
      .pill-red { background:#fee2e2; color:#991b1b; }
      .subtle { color:#6b7b92; font-size:12px; margin-top:3px; }
      .footnote { padding: 18px 28px 28px; font-size:12px; color:#6b7b92; line-height:1.6; }
      @media (max-width: 720px) {
        .wrap { padding: 12px; }
        .hero, .meta, .section, .footnote { padding-left: 16px; padding-right: 16px; }
        .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); padding-left:16px; padding-right:16px; }
        .report-table { display:block; overflow-x:auto; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel">
        <div class="hero">
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <div class="meta">
          <strong>Period:</strong> ${escapeHtml(rangeLabel)}
        </div>
        <div class="metrics">
          ${formatMetricCards(metrics)}
        </div>
        <div class="section">
          <h2>Exceptions And Non-Compliance</h2>
          <p>Focus first on missing updates, short days, and approval backlog. The report uses approved timesheet data for workload signals.</p>
          ${complianceTable}
        </div>
        <div class="section">
          <h2>Efficiency Snapshot</h2>
          <p>Use this to review time discipline and load balance. Management can scan for heavy-load and under-target patterns quickly.</p>
          ${efficiencyTable}
        </div>
        <div class="section">
          <h2>Long-Working Clients</h2>
          <p>Manager time includes partner time. Use this section to prioritise meetings and correct load distribution.</p>
          ${clientTable}
        </div>
        <div class="section">
          <h2>Approval Backlog</h2>
          <p>Entries still in draft or pending review are shown here, with the oldest items at the top.</p>
          ${backlogTable}
        </div>
        <div class="footnote">
          <div><strong>Status mix:</strong> ${escapeHtml(Object.entries(statusCounts).map(([key, value]) => `${key}=${value}`).join(' | '))}</div>
          <div>${escapeHtml(footnote)}</div>
        </div>
      </div>
    </div>
  </body>
  </html>`;
}

function buildReportText({ title, rangeLabel, metrics, complianceRows, clientRows, backlogRows, footnote }) {
  const lines = [
    title,
    `Period: ${rangeLabel}`,
    ''
  ];

  for (const metric of metrics) {
    lines.push(`${metric.label}: ${metric.value}`);
  }

  lines.push('');
  lines.push('Exceptions And Non-Compliance');
  for (const row of complianceRows.slice(0, 10)) {
    lines.push(`- ${row.name} (${row.role}): ${row.observation}, missing ${row.missingDays}, short ${row.shortDays}`);
  }
  if (!complianceRows.length) lines.push('- No operational staff rows found.');

  lines.push('');
  lines.push('Long-Working Clients');
  for (const row of clientRows.slice(0, 8)) {
    lines.push(`- ${row.name}: article ${formatHours(row.article_hours)}, manager ${formatHours(row.manager_hours)}, total ${formatHours(row.total_hours)} (${row.priority})`);
  }
  if (!clientRows.length) lines.push('- No client work found for the period.');

  lines.push('');
  lines.push('Approval Backlog');
  for (const row of backlogRows.slice(0, 8)) {
    lines.push(`- ${row.entry_date} ${row.staff_name} / ${row.client_name} / ${row.status} / ${row.task_type}`);
  }
  if (!backlogRows.length) lines.push('- No pending entries found for the period.');

  lines.push('');
  lines.push(footnote);
  return lines.join('\n');
}

async function sendReportEmail({ subject, html, text }) {
  const transport = getMailTransport();
  const from = getConfigValue('report.from_email', getConfigValue('smtp.from', getConfigValue('mail.from', '')));
  if (!from) {
    throw new Error('REPORT_FROM_EMAIL is required for outgoing reports.');
  }

  const recipients = await getPartnerRecipients();
  if (!recipients.length) {
    throw new Error('No active partner recipients with email addresses were found.');
  }

  const replyTo = getConfigValue('report.reply_to', '');
  const sendResults = [];
  for (const recipient of recipients) {
    const info = await transport.sendMail({
      from,
      to: recipient.email,
      subject,
      text,
      html,
      replyTo: replyTo || undefined
    });
    sendResults.push({
      email: recipient.email,
      messageId: info.messageId || ''
    });
  }

  return {
    sentTo: sendResults
  };
}

async function sendManagementReport(reportKind) {
  const currentDate = currentIndiaDate();
  const range = reportKind === 'weekly'
    ? previousWeekBounds(currentDate)
    : { from: currentDate, to: currentDate };
  const data = await loadReportData({
    from: range.from,
    to: range.to,
    periodLabel: reportKind === 'weekly' ? 'Last Week' : 'Today',
    reportKind
  });

  const totalOperations = data.totalOperationsUsers || 0;
  const complianceRate = totalOperations ? Math.round((data.fullyCompliantUsers / totalOperations) * 100) : 0;
  const longWorkingClients = data.clientRows.length;
  const backlogCount = data.backlogRows.length;
  const periodLabel = formatRangeLabel(data.from, data.to);
  const title = reportKind === 'weekly'
    ? 'Weekly Management Report'
    : 'Daily Management Report';
  const subtitle = reportKind === 'weekly'
    ? 'Last week summary focused on exceptions, compliance, efficiency, and client priority.'
    : 'Daily summary focused on exceptions, compliance, efficiency, and client priority.';

  const metrics = [
    {
      label: 'Tracked Hours',
      value: formatHours(data.totalTrackedHours),
      note: 'Approved time recorded in the period'
    },
    {
      label: 'Compliance',
      value: `${complianceRate}%`,
      note: `${data.fullyCompliantUsers}/${totalOperations} operational staff fully clean`
    },
    {
      label: 'Exceptions',
      value: `${data.totalMissingDays + data.totalShortDays}`,
      note: `${data.totalMissingDays} missing | ${data.totalShortDays} short`
    },
    {
      label: 'Priority Clients',
      value: String(longWorkingClients),
      note: `${backlogCount} open items in review`
    }
  ];

  const footnote = reportKind === 'weekly'
    ? 'Weekly timing uses the previous Monday-Sunday window. Partner recipients are resolved from active partner profiles unless REPORT_RECIPIENT_EMAILS is set.'
    : 'Daily timing uses the current India date at send time. Manager time includes partner time in client prioritization.';
  const html = buildDailyWeeklyHtml({
    title,
    subtitle,
    rangeLabel: periodLabel,
    metrics,
    complianceRows: data.complianceRows,
    efficiencyRows: data.efficiencyRows,
    clientRows: data.clientRows,
    backlogRows: data.backlogRows,
    statusCounts: data.statusCounts,
    footnote
  });
  const text = buildReportText({
    title,
    rangeLabel: periodLabel,
    metrics,
    complianceRows: data.complianceRows,
    clientRows: data.clientRows,
    backlogRows: data.backlogRows,
    footnote
  });

  const subjectDate = reportKind === 'weekly' ? periodLabel : formatLabelForDate(currentDate);
  const subject = reportKind === 'weekly'
    ? `Weekly Management Report - ${subjectDate}`
    : `Daily Management Report - ${subjectDate}`;

  const result = await sendReportEmail({ subject, html, text });
  console.log(`[report-mailer] Sent ${reportKind} management report to ${result.sentTo.length} partner recipient(s).`);
  return {
    reportKind,
    range: data.from && data.to ? { from: data.from, to: data.to } : range,
    recipientCount: result.sentTo.length
  };
}

async function sendDailyManagementReport() {
  return sendManagementReport('daily');
}

async function sendWeeklyManagementReport() {
  return sendManagementReport('weekly');
}

module.exports = {
  sendDailyManagementReport,
  sendWeeklyManagementReport
};
