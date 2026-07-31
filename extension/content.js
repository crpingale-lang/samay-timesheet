(() => {
  if (window.top !== window || document.getElementById('samay-extension-host')) return;

  const host = document.createElement('div');
  host.id = 'samay-extension-host';
  host.setAttribute('data-samay-extension', 'true');
  const shadow = host.attachShadow({ mode: 'closed' });
  document.documentElement.appendChild(host);

  const logoUrl = chrome.runtime.getURL('icons/icon-128.png');
  let ticker = null;
  let lastVisibilityRefresh = 0;
  let appState = {
    authenticated: false,
    user: null,
    active: null,
    clients: [],
    categories: [],
    lastSaved: null,
    optionsNotice: '',
    serverNow: new Date().toISOString()
  };
  const view = {
    expanded: false,
    dismissed: false,
    busy: false,
    error: '',
    notice: '',
    ignoreSaved: false,
    serverOffsetMs: 0,
    search: { kind: '', index: 0 },
    draft: {
      clientId: '',
      clientQuery: 'Internal / no client',
      clientChosen: true,
      taskType: '',
      taskQuery: '',
      taskChosen: false,
      description: ''
    }
  };

  const styles = `
    :host { all: initial; color-scheme: light; }
    *, *::before, *::after { box-sizing: border-box; }
    button, input, textarea { font: inherit; }
    button { -webkit-tap-highlight-color: transparent; }
    .samay-shell {
      position: fixed;
      z-index: 2147483647;
      top: 16px;
      right: 16px;
      color: #102a2e;
      font-family: Inter, ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      letter-spacing: 0;
      filter: drop-shadow(0 14px 28px rgba(15, 58, 63, .18));
    }
    .samay-card, .samay-pill {
      border: 1px solid rgba(15, 118, 110, .18);
      background: rgba(247, 252, 251, .90);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.9);
      backdrop-filter: blur(18px) saturate(135%);
      -webkit-backdrop-filter: blur(18px) saturate(135%);
    }
    .samay-pill {
      position: relative;
      display: flex;
      align-items: center;
      min-width: 166px;
      height: 48px;
      padding: 5px 8px 5px 10px;
      border-radius: 15px;
      transition: transform .16s ease, background .16s ease;
    }
    .samay-pill:hover { transform: translateY(-1px); background: rgba(255,255,255,.96); }
    .samay-card {
      position: relative;
      width: 304px;
      max-height: calc(100vh - 32px);
      overflow: auto;
      border-radius: 18px;
      padding: 15px;
      scrollbar-width: thin;
      scrollbar-color: rgba(15,118,110,.24) transparent;
    }
    .edge-toggle {
      position: absolute;
      left: -14px;
      top: 50%;
      width: 28px;
      height: 42px;
      transform: translateY(-50%);
      display: grid;
      place-items: center;
      border: 1px solid rgba(15,118,110,.18);
      border-right: 0;
      border-radius: 12px 0 0 12px;
      color: #0f766e;
      background: rgba(247,252,251,.94);
      cursor: pointer;
      box-shadow: -6px 8px 16px rgba(15,58,63,.08);
    }
    .edge-toggle svg { width: 14px; height: 14px; }
    .pill-main {
      min-width: 0;
      flex: 1;
      display: flex;
      align-items: center;
      gap: 9px;
      border: 0;
      padding: 0;
      color: inherit;
      background: transparent;
      cursor: pointer;
      text-align: left;
    }
    .logo { width: 31px; height: 31px; border-radius: 9px; flex: 0 0 auto; }
    .pill-copy { min-width: 0; display: grid; gap: 0; }
    .pill-title { overflow: hidden; color: #173b3f; font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .elapsed { color: #0f766e; font-size: 17px; font-variant-numeric: tabular-nums; font-weight: 750; letter-spacing: .02em; }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 0 4px rgba(16,185,129,.12); flex: 0 0 auto; }
    .live-dot.paused { background: #f59e0b; box-shadow: 0 0 0 4px rgba(245,158,11,.13); }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .brand { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .brand .logo { width: 34px; height: 34px; }
    .eyebrow { color: #557174; font-size: 10px; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; }
    .title { margin: 1px 0 0; color: #14363a; font-size: 15px; font-weight: 720; }
    .icon-button {
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(15,118,110,.13);
      border-radius: 11px;
      color: #466468;
      background: rgba(255,255,255,.65);
      cursor: pointer;
    }
    .icon-button:hover { color: #0f766e; background: #fff; }
    .field { position: relative; margin-top: 11px; }
    label { display: block; margin: 0 0 5px; color: #405f62; font-size: 11px; font-weight: 680; }
    input, textarea {
      width: 100%;
      min-height: 40px;
      border: 1px solid #ccdcda;
      border-radius: 11px;
      outline: 0;
      padding: 9px 11px;
      color: #15383c;
      background: rgba(255,255,255,.84);
      transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
    }
    textarea { min-height: 70px; max-height: 116px; resize: vertical; }
    input::placeholder, textarea::placeholder { color: #819799; }
    input:focus, textarea:focus { border-color: #14b8a6; background: #fff; box-shadow: 0 0 0 3px rgba(20,184,166,.12); }
    .search-list {
      position: absolute;
      z-index: 4;
      top: calc(100% + 5px);
      right: 0;
      left: 0;
      max-height: 176px;
      overflow: auto;
      padding: 5px;
      border: 1px solid #d4e2e0;
      border-radius: 12px;
      background: rgba(255,255,255,.98);
      box-shadow: 0 14px 28px rgba(21,56,60,.16);
    }
    .search-option {
      width: 100%;
      min-height: 36px;
      display: block;
      overflow: hidden;
      border: 0;
      border-radius: 8px;
      padding: 7px 9px;
      color: #244a4e;
      background: transparent;
      cursor: pointer;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .search-option:hover, .search-option.active { color: #0f5e59; background: #e9f8f5; }
    .empty-option { padding: 11px; color: #71888a; font-size: 12px; }
    .notice, .error {
      margin-top: 11px;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 11px;
    }
    .notice { color: #516b6e; background: rgba(226,242,239,.72); }
    .error { color: #9b2c2c; background: #fff0ef; }
    .actions { display: grid; grid-template-columns: 1fr 1.35fr; gap: 8px; margin-top: 14px; }
    .button {
      min-height: 40px;
      border: 1px solid transparent;
      border-radius: 11px;
      padding: 8px 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .button:disabled { opacity: .58; cursor: wait; }
    .button-primary { color: #fff; background: linear-gradient(135deg, #0f766e, #0891b2); box-shadow: 0 8px 18px rgba(8,145,178,.18); }
    .button-primary:hover:not(:disabled) { filter: brightness(1.04); }
    .button-secondary { border-color: #d4e2e0; color: #395b5e; background: rgba(255,255,255,.72); }
    .button-danger { border-color: #fed7d4; color: #a43b34; background: #fff5f4; }
    .active-time { margin: 2px 0 8px; color: #0f766e; font-size: 30px; font-variant-numeric: tabular-nums; font-weight: 780; letter-spacing: .02em; }
    .status-line { display: flex; align-items: center; gap: 9px; color: #4f6b6e; font-size: 11px; }
    .work-card { margin-top: 12px; padding: 11px; border: 1px solid rgba(15,118,110,.11); border-radius: 12px; background: rgba(232,246,243,.58); }
    .work-client { overflow: hidden; color: #173d41; font-size: 13px; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
    .work-type { margin-top: 2px; color: #4d6d70; font-size: 11px; }
    .work-note { display: -webkit-box; overflow: hidden; margin-top: 7px; color: #2f5155; font-size: 12px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .saved { text-align: center; padding: 7px 3px 2px; }
    .saved-mark { width: 44px; height: 44px; display: grid; place-items: center; margin: 0 auto 9px; border-radius: 14px; color: #087d70; background: #dcf7f0; font-size: 22px; font-weight: 800; }
    .saved h2 { margin: 0; color: #173b3f; font-size: 16px; }
    .saved p { margin: 6px 0 0; color: #627b7e; font-size: 12px; }
    .signin-copy { margin: 0; color: #526e71; font-size: 12px; }
    .spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid rgba(255,255,255,.45); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; vertical-align: -2px; }
    :focus-visible { outline: 3px solid rgba(8,145,178,.27); outline-offset: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 420px) {
      .samay-shell { top: 9px; right: 9px; }
      .samay-card { width: min(304px, calc(100vw - 28px)); max-height: calc(100vh - 18px); }
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
  `;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function messageExtension(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.ok) return reject(new Error(response?.error || 'Samay request failed.'));
        resolve(response.state);
      });
    });
  }

  function applyState(next) {
    if (!next) return;
    const serverMs = Date.parse(next.serverNow);
    if (Number.isFinite(serverMs)) view.serverOffsetMs = serverMs - Date.now();
    appState = { ...appState, ...next };
    if (Object.prototype.hasOwnProperty.call(next, 'notice')) view.notice = next.notice || '';
    if (!view.draft.taskChosen && appState.categories.length) {
      const first = appState.categories[0];
      view.draft.taskType = first.label || '';
      view.draft.taskQuery = first.label || '';
      view.draft.taskChosen = Boolean(first.label);
    }
    if (appState.active) view.ignoreSaved = false;
  }

  function elapsedSeconds(active = appState.active) {
    if (!active) return 0;
    const started = Date.parse(active.started_at);
    const stopped = active.status === 'paused' ? Date.parse(active.paused_at) : Date.now() + view.serverOffsetMs;
    if (!Number.isFinite(started) || !Number.isFinite(stopped)) return 0;
    return Math.max(0, Math.floor((stopped - started - (Number(active.total_paused_ms) || 0)) / 1000));
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function filteredOptions(kind) {
    const query = (kind === 'client' ? view.draft.clientQuery : view.draft.taskQuery).trim().toLowerCase();
    if (kind === 'client') {
      const internal = { id: '', label: 'Internal / no client' };
      const clients = appState.clients.map(client => ({
        id: String(client.id || ''),
        label: client.code ? `${client.name} · ${client.code}` : client.name
      }));
      return [internal, ...clients].filter(item => !query || String(item.label).toLowerCase().includes(query)).slice(0, 8);
    }
    return appState.categories
      .map(category => ({ id: category.label || '', label: category.label || '' }))
      .filter(item => item.label && (!query || item.label.toLowerCase().includes(query)))
      .slice(0, 8);
  }

  function searchList(kind) {
    if (view.search.kind !== kind) return '';
    const options = filteredOptions(kind);
    if (!options.length) return '<div class="search-list"><div class="empty-option">No matching option</div></div>';
    return `<div class="search-list" role="listbox">${options.map((item, index) => `
      <button class="search-option ${index === view.search.index ? 'active' : ''}" type="button" role="option"
        aria-selected="${index === view.search.index}" data-action="select-${kind}" data-option-index="${index}">
        ${escapeHtml(item.label)}
      </button>`).join('')}</div>`;
  }

  function header(title, eyebrow = 'Focus timer') {
    return `<div class="header">
      <div class="brand">
        <img class="logo" src="${logoUrl}" alt="">
        <div><div class="eyebrow">${escapeHtml(eyebrow)}</div><div class="title">${escapeHtml(title)}</div></div>
      </div>
      <button class="icon-button" type="button" data-action="collapse" aria-label="Collapse Samay timer" title="Collapse">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>`;
  }

  function feedback() {
    const error = view.error ? `<div class="error" role="alert">${escapeHtml(view.error)}</div>` : '';
    const notice = !view.error && (view.notice || appState.optionsNotice)
      ? `<div class="notice" role="status">${escapeHtml(view.notice || appState.optionsNotice)}</div>`
      : '';
    return error || notice;
  }

  function collapsedMarkup() {
    const active = appState.active;
    const title = active
      ? (active.client_name || 'Internal work')
      : (appState.authenticated ? 'Ready when you are' : 'Sign in to Samay');
    return `<div class="samay-pill">
      <button class="edge-toggle" type="button" data-action="expand" aria-label="Open Samay timer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6.5L9 12l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="pill-main" type="button" data-action="expand">
        ${active ? `<span class="live-dot ${active.status === 'paused' ? 'paused' : ''}"></span>` : `<img class="logo" src="${logoUrl}" alt="">`}
        <span class="pill-copy">
          <span class="pill-title">${escapeHtml(title)}</span>
          <span class="elapsed" data-role="elapsed">${active ? formatDuration(elapsedSeconds()) : 'Samay'}</span>
        </span>
      </button>
    </div>`;
  }

  function signedOutMarkup() {
    return `<div class="samay-card">
      ${header('Sign in to continue')}
      <p class="signin-copy">Use the Samay extension icon to sign in securely. Your password is never stored.</p>
      ${feedback()}
      <div class="actions">
        <button class="button button-secondary" type="button" data-action="exit">Exit</button>
        <button class="button button-primary" type="button" data-action="open-popup">Sign in</button>
      </div>
    </div>`;
  }

  function idleMarkup() {
    const draft = view.draft;
    return `<div class="samay-card">
      ${header('Start focused work')}
      <div class="field">
        <label for="samay-client">Client</label>
        <input id="samay-client" type="text" role="combobox" aria-autocomplete="list" aria-expanded="${view.search.kind === 'client'}"
          autocomplete="off" data-input="client" value="${escapeHtml(draft.clientQuery)}" placeholder="Search client or choose internal">
        ${searchList('client')}
      </div>
      <div class="field">
        <label for="samay-task">Work category</label>
        <input id="samay-task" type="text" role="combobox" aria-autocomplete="list" aria-expanded="${view.search.kind === 'task'}"
          autocomplete="off" data-input="task" value="${escapeHtml(draft.taskQuery)}" placeholder="Search work category">
        ${searchList('task')}
      </div>
      <div class="field">
        <label for="samay-description">What are you working on?</label>
        <textarea id="samay-description" maxlength="2000" required data-input="description" placeholder="Add a clear work note">${escapeHtml(draft.description)}</textarea>
      </div>
      ${feedback()}
      <div class="actions">
        <button class="button button-secondary" type="button" data-action="exit" ${view.busy ? 'disabled' : ''}>Exit</button>
        <button class="button button-primary" type="button" data-action="start" ${view.busy ? 'disabled' : ''}>
          ${view.busy ? '<span class="spinner"></span>' : 'Start'}
        </button>
      </div>
    </div>`;
  }

  function activeMarkup() {
    const active = appState.active;
    const paused = active.status === 'paused';
    return `<div class="samay-card">
      ${header(paused ? 'Timer paused' : 'Timer running', 'Recording')}
      <div class="active-time" data-role="elapsed">${formatDuration(elapsedSeconds())}</div>
      <div class="status-line"><span class="live-dot ${paused ? 'paused' : ''}"></span>${paused ? 'Paused — time is not increasing' : 'Recording active work'}</div>
      <div class="work-card">
        <div class="work-client">${escapeHtml(active.client_name || 'Internal / no client')}</div>
        <div class="work-type">${escapeHtml(active.task_type || 'Work')}</div>
        <div class="work-note">${escapeHtml(active.description || '')}</div>
      </div>
      ${feedback()}
      <div class="actions">
        <button class="button button-secondary" type="button" data-action="${paused ? 'resume' : 'pause'}" ${view.busy ? 'disabled' : ''}>${paused ? 'Resume' : 'Pause'}</button>
        <button class="button button-danger" type="button" data-action="stop" ${view.busy ? 'disabled' : ''}>${view.busy ? 'Saving…' : 'End'}</button>
      </div>
    </div>`;
  }

  function savedMarkup() {
    const saved = appState.lastSaved || {};
    return `<div class="samay-card">
      ${header('Time recorded', 'Draft saved')}
      <div class="saved">
        <div class="saved-mark">✓</div>
        <h2>${escapeHtml(formatDuration(saved.elapsedSeconds || 0))} captured</h2>
        <p>Your entry is a draft in Samay, ready for review.</p>
      </div>
      ${saved.warning ? `<div class="notice">${escapeHtml(saved.warning)}</div>` : feedback()}
      <div class="actions">
        <button class="button button-secondary" type="button" data-action="view-drafts">View draft</button>
        <button class="button button-primary" type="button" data-action="new">New timer</button>
      </div>
    </div>`;
  }

  function render() {
    host.style.display = view.dismissed ? 'none' : '';
    if (view.dismissed) return;
    const content = !view.expanded
      ? collapsedMarkup()
      : !appState.authenticated
        ? signedOutMarkup()
        : appState.active
          ? activeMarkup()
          : appState.lastSaved && !view.ignoreSaved
            ? savedMarkup()
            : idleMarkup();
    shadow.innerHTML = `<style>${styles}</style><div class="samay-shell" aria-live="polite">${content}</div>`;
    bindEvents();
    restartTicker();
  }

  function restartTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
    if (!appState.active || appState.active.status !== 'running') return;
    ticker = setInterval(() => {
      shadow.querySelectorAll('[data-role="elapsed"]').forEach(node => {
        node.textContent = formatDuration(elapsedSeconds());
      });
    }, 1000);
  }

  function refocus(kind) {
    queueMicrotask(() => {
      const input = shadow.querySelector(`[data-input="${kind}"]`);
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function chooseOption(kind, index) {
    const option = filteredOptions(kind)[index];
    if (!option) return;
    if (kind === 'client') {
      view.draft.clientId = option.id;
      view.draft.clientQuery = option.label;
      view.draft.clientChosen = true;
    } else {
      view.draft.taskType = option.id;
      view.draft.taskQuery = option.label;
      view.draft.taskChosen = true;
    }
    view.search.kind = '';
    view.search.index = 0;
    view.error = '';
    render();
  }

  function handleSearchKey(event, kind) {
    const options = filteredOptions(kind);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      view.search.kind = kind;
      view.search.index = Math.max(0, Math.min(options.length - 1, view.search.index + direction));
      render();
      refocus(kind);
    } else if (event.key === 'Enter' && view.search.kind === kind) {
      event.preventDefault();
      chooseOption(kind, view.search.index);
    } else if (event.key === 'Escape') {
      view.search.kind = '';
      render();
      refocus(kind);
    }
  }

  async function runAction(type, successMode) {
    view.busy = true;
    view.error = '';
    view.notice = '';
    render();
    try {
      const next = await messageExtension({ type });
      applyState(next);
      if (successMode === 'collapse') view.expanded = false;
      if (successMode === 'saved') view.expanded = true;
    } catch (error) {
      view.error = error.message;
    } finally {
      view.busy = false;
      render();
    }
  }

  async function startTimer() {
    const draft = view.draft;
    if (!draft.clientChosen) {
      view.error = 'Select a client from the list, or choose Internal / no client.';
      return render();
    }
    if (!draft.taskChosen || !draft.taskType) {
      view.error = 'Select a work category from the list.';
      return render();
    }
    const description = draft.description.trim();
    if (!description) {
      view.error = 'Add a clear work note before starting.';
      return render();
    }
    view.busy = true;
    view.error = '';
    render();
    try {
      const next = await messageExtension({
        type: 'SAMAY_START',
        clientId: draft.clientId,
        taskType: draft.taskType,
        description
      });
      applyState(next);
      view.expanded = false;
      view.ignoreSaved = false;
    } catch (error) {
      view.error = error.message;
    } finally {
      view.busy = false;
      render();
    }
  }

  function bindEvents() {
    shadow.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;
        if (action === 'expand') {
          view.expanded = true;
          view.error = '';
          render();
        } else if (action === 'collapse') {
          view.expanded = false;
          view.search.kind = '';
          render();
        } else if (action === 'exit') {
          view.dismissed = true;
          render();
        } else if (action === 'open-popup') {
          try { await messageExtension({ type: 'SAMAY_OPEN_POPUP' }); } catch (error) { view.error = error.message; render(); }
        } else if (action === 'start') {
          await startTimer();
        } else if (action === 'pause') {
          await runAction('SAMAY_PAUSE');
        } else if (action === 'resume') {
          await runAction('SAMAY_RESUME');
        } else if (action === 'stop') {
          await runAction('SAMAY_STOP', 'saved');
        } else if (action === 'new') {
          view.ignoreSaved = true;
          view.draft.description = '';
          view.error = '';
          render();
        } else if (action === 'view-drafts') {
          try { await messageExtension({ type: 'SAMAY_OPEN_APP', path: '/my-timesheets.html?status=draft' }); } catch (error) { view.error = error.message; render(); }
        } else if (action === 'select-client' || action === 'select-task') {
          chooseOption(action === 'select-client' ? 'client' : 'task', Number(button.dataset.optionIndex));
        }
      });
    });

    shadow.querySelectorAll('[data-input]').forEach(input => {
      const kind = input.dataset.input;
      if (kind === 'description') {
        input.addEventListener('input', () => { view.draft.description = input.value; });
        return;
      }
      input.addEventListener('focus', () => {
        if (view.search.kind === kind) return;
        view.search.kind = kind;
        view.search.index = 0;
        render();
        refocus(kind);
      });
      input.addEventListener('input', () => {
        if (kind === 'client') {
          view.draft.clientQuery = input.value;
          view.draft.clientChosen = false;
        } else {
          view.draft.taskQuery = input.value;
          view.draft.taskChosen = false;
        }
        view.search.kind = kind;
        view.search.index = 0;
        render();
        refocus(kind);
      });
      input.addEventListener('keydown', event => handleSearchKey(event, kind));
    });
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'SAMAY_STATE_UPDATED') {
      applyState(message.state);
      view.error = '';
      render();
    }
    if (message?.type === 'SAMAY_OVERLAY_SHOW') {
      view.dismissed = false;
      view.expanded = true;
      view.error = '';
      render();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && view.expanded && view.search.kind === '') {
      view.expanded = false;
      render();
    }
  });

  document.addEventListener('pointerdown', event => {
    if (!view.search.kind || event.composedPath().includes(host)) return;
    view.search.kind = '';
    render();
  }, true);

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !appState.authenticated || Date.now() - lastVisibilityRefresh < 30000) return;
    lastVisibilityRefresh = Date.now();
    try {
      applyState(await messageExtension({ type: 'SAMAY_REFRESH' }));
      render();
    } catch {
      // Keep the last known timer visible; explicit actions surface errors.
    }
  });

  render();
  messageExtension({ type: 'SAMAY_GET_STATE' })
    .then(state => { applyState(state); render(); })
    .catch(error => { view.error = error.message; render(); });
})();
