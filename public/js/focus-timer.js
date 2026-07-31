(() => {
  const state = {
    initialized: false,
    active: null,
    clients: [],
    categories: [],
    clockOffsetMs: 0,
    pipWindow: null,
    pipCollapsed: false,
    pipRenderedMode: '',
    pipNotice: '',
    lastSaved: null,
    tickHandle: null,
    pollHandle: null,
    busy: false,
    channel: null,
    draft: {
      client_id: '',
      task_type: '',
      work_classification: 'internal',
      description: ''
    }
  };

  const PIP_SIZES = {
    idle: { width: 316, height: 300 },
    idleError: { width: 316, height: 336 },
    running: { width: 286, height: 176 },
    paused: { width: 286, height: 176 },
    runningError: { width: 286, height: 218 },
    collapsed: { width: 226, height: 58 },
    saved: { width: 300, height: 184 }
  };

  const ids = {
    launcher: 'focus-timer-launcher',
    overlay: 'focus-timer-overlay',
    idle: 'focus-timer-idle',
    running: 'focus-timer-running',
    client: 'focus-timer-client',
    task: 'focus-timer-task',
    description: 'focus-timer-description',
    notice: 'focus-timer-notice'
  };

  function el(id, root = document) {
    return root?.getElementById(id);
  }

  function supportsPiP() {
    return 'documentPictureInPicture' in window;
  }

  function sourceName() {
    if (state.pipWindow) return 'chrome_pip';
    if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa';
    return 'web';
  }

  function setServerTime(serverNow) {
    const parsed = Date.parse(serverNow);
    if (Number.isFinite(parsed)) state.clockOffsetMs = parsed - Date.now();
  }

  function currentServerTime() {
    return Date.now() + state.clockOffsetMs;
  }

  function elapsedSeconds() {
    if (!state.active?.started_at) return 0;
    const startedAt = Date.parse(state.active.started_at);
    const pausedAt = Date.parse(state.active.paused_at);
    const endAt = state.active.status === 'paused' && Number.isFinite(pausedAt)
      ? pausedAt
      : currentServerTime();
    const totalPausedMs = Math.max(0, Number(state.active.total_paused_ms) || 0);
    return Math.max(0, Math.floor((endAt - startedAt - totalPausedMs) / 1000));
  }

  function formatElapsed(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds) || 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = Math.floor(seconds % 60);
    return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
  }

  function setText(target, value) {
    if (target) target.textContent = value == null ? '' : String(value);
  }

  function clientLabel(client) {
    if (!client) return '';
    return `${client.name || 'Unnamed client'}${client.code ? ` [${client.code}]` : ''}`;
  }

  function resolveClient(value) {
    const query = String(value || '').trim().toLocaleLowerCase();
    if (!query) return null;
    return state.clients.find(client => [
      clientLabel(client),
      client.name,
      client.code
    ].some(candidate => String(candidate || '').trim().toLocaleLowerCase() === query)) || null;
  }

  function resolveTask(value) {
    const query = String(value || '').trim().toLocaleLowerCase();
    if (!query) return null;
    return state.categories.find(category => String(category.label || '').trim().toLocaleLowerCase() === query) || null;
  }

  function timerInput(root, name) {
    const mainIds = {
      client_id: ids.client,
      task_type: ids.task,
      description: ids.description
    };
    return root === document
      ? el(mainIds[name])
      : root?.querySelector(`[data-timer-input="${name}"]`);
  }

  function captureDraft(root = document) {
    const clientInput = timerInput(root, 'client_id');
    const taskInput = timerInput(root, 'task_type');
    const descriptionInput = timerInput(root, 'description');

    if (clientInput) {
      state.draft.client_id = clientInput.matches('select')
        ? clientInput.value
        : String(resolveClient(clientInput.value)?.id || '');
    }
    if (taskInput) {
      state.draft.task_type = taskInput.matches('select')
        ? taskInput.value
        : (resolveTask(taskInput.value)?.label || taskInput.value.trim());
    }
    if (descriptionInput) state.draft.description = descriptionInput.value;
    state.draft.work_classification = state.draft.client_id ? 'client_work' : 'internal';
    return { ...state.draft };
  }

  function addOption(select, label, value) {
    const option = select.ownerDocument.createElement('option');
    option.value = value == null ? '' : String(value);
    option.textContent = label == null ? '' : String(label);
    select.appendChild(option);
  }

  function applyDraft(root = document) {
    const client = timerInput(root, 'client_id');
    const task = timerInput(root, 'task_type');
    const description = timerInput(root, 'description');
    if (client) {
      if (client.matches('select')) client.value = String(state.draft.client_id || '');
      else client.value = clientLabel(state.clients.find(item => String(item.id) === String(state.draft.client_id))) || '';
    }
    if (task) task.value = state.draft.task_type || '';
    if (description) description.value = state.draft.description || '';
  }

  function populateMainOptions() {
    const client = timerInput(document, 'client_id');
    const task = timerInput(document, 'task_type');
    if (!client || !task) return;
    client.replaceChildren();
    addOption(client, 'Internal / no client', '');
    state.clients.forEach(item => addOption(client, clientLabel(item), item.id));
    task.replaceChildren();
    addOption(task, 'Select work', '');
    state.categories.forEach(item => addOption(task, item.label, item.label));
    applyDraft(document);
  }

  function populatePiPInputs(root) {
    const clientList = root.querySelector('[data-timer-client-options]');
    const taskList = root.querySelector('[data-timer-task-options]');
    if (clientList) {
      clientList.replaceChildren();
      state.clients.forEach(item => addOption(clientList, '', clientLabel(item)));
    }
    if (taskList) {
      taskList.replaceChildren();
      state.categories.forEach(item => addOption(taskList, '', item.label));
    }
    applyDraft(root);
  }

  function pipMode() {
    if (state.active) {
      if (state.pipCollapsed) return 'collapsed';
      return state.active.status === 'paused' ? 'paused' : 'running';
    }
    return state.lastSaved ? 'saved' : 'idle';
  }

  function resizePiP(mode = pipMode()) {
    const pip = state.pipWindow;
    const size = PIP_SIZES[mode];
    if (!pip || pip.closed || !size) return;
    window.requestAnimationFrame(() => {
      try {
        pip.resizeTo(size.width, size.height);
      } catch {
        // Chromium may clamp Picture-in-Picture dimensions for the current display.
      }
    });
  }

  function showNotice(message = '') {
    const notice = el(ids.notice);
    if (!notice) return;
    notice.hidden = !message;
    setText(notice, message);
  }

  function showInputNotice(root, message = '') {
    if (!root || root === document) {
      showNotice(message);
      return;
    }
    state.pipNotice = message;
    const notice = root.querySelector('[data-timer-pip-notice]');
    if (!notice) return;
    notice.hidden = !message;
    setText(notice, message);
    if (!state.active) resizePiP(message ? 'idleError' : 'idle');
    else if (!state.pipCollapsed) resizePiP(message ? 'runningError' : pipMode());
  }

  function rememberActiveAsDraft(active, { clearDescription = false } = {}) {
    if (!active) return;
    state.draft = {
      client_id: active.client_id == null ? '' : String(active.client_id),
      task_type: active.task_type || '',
      work_classification: active.client_id ? 'client_work' : 'internal',
      description: clearDescription ? '' : (active.description || '')
    };
    applyDraft(document);
  }

  function setBusy(busy) {
    state.busy = busy;
    [document, state.pipWindow?.document].filter(Boolean).forEach(root => {
      root.querySelectorAll('[data-timer-action], [data-timer-pip-action]').forEach(button => {
        button.disabled = busy;
      });
    });
  }

  function injectMarkup() {
    if (el(ids.launcher)) return;
    const launcher = document.createElement('button');
    launcher.id = ids.launcher;
    launcher.className = 'focus-timer-launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Open Samay timer');
    launcher.innerHTML = '<span class="focus-timer-launcher-dot" aria-hidden="true"></span><span class="focus-timer-launcher-label">Timer</span><span class="focus-timer-launcher-time" hidden>00:00:00</span>';
    document.body.appendChild(launcher);

    const overlay = document.createElement('div');
    overlay.id = ids.overlay;
    overlay.className = 'focus-timer-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <section class="focus-timer-dialog" role="dialog" aria-modal="true" aria-labelledby="focus-timer-title">
        <header class="focus-timer-head">
          <div>
            <div class="focus-timer-kicker">Samay capture</div>
            <h2 class="focus-timer-title" id="focus-timer-title">Focus timer</h2>
            <p class="focus-timer-subtitle">Choose the work once. Paused time is excluded automatically.</p>
          </div>
          <button class="focus-timer-close" type="button" data-timer-close aria-label="Exit timer">&times;</button>
        </header>
        <div class="focus-timer-body">
          <div class="focus-timer-notice" id="${ids.notice}" hidden></div>
          <div id="${ids.idle}">
            <div class="focus-timer-form">
              <div class="focus-timer-field">
                <label for="${ids.client}">Client <span>(optional for internal work)</span></label>
                <select id="${ids.client}"><option value="">Internal / no client</option></select>
              </div>
              <div class="focus-timer-field">
                <label for="${ids.task}">Work</label>
                <select id="${ids.task}"><option value="">Select work</option></select>
              </div>
              <div class="focus-timer-field is-wide">
                <label for="${ids.description}">Note <span>(optional)</span></label>
                <textarea id="${ids.description}" maxlength="2000" placeholder="What are you working on?"></textarea>
              </div>
            </div>
            <div class="focus-timer-actions">
              <button class="focus-timer-btn focus-timer-btn-secondary" type="button" data-timer-close>Exit</button>
              <button class="focus-timer-btn focus-timer-btn-primary" type="button" data-timer-action="start">Start</button>
            </div>
          </div>
          <div id="${ids.running}" class="focus-timer-running" hidden>
            <div class="focus-timer-running-card">
              <div class="focus-timer-running-top">
                <div>
                  <div class="focus-timer-running-label" data-timer-state-label>Time in progress</div>
                  <div class="focus-timer-running-time" data-timer-elapsed>00:00:00</div>
                </div>
                <span class="focus-timer-live-mark" data-timer-live-mark>Live</span>
              </div>
              <div class="focus-timer-context">
                <div class="focus-timer-context-item"><div class="focus-timer-context-label">Client</div><div class="focus-timer-context-value" data-timer-client></div></div>
                <div class="focus-timer-context-item"><div class="focus-timer-context-label">Work</div><div class="focus-timer-context-value" data-timer-task></div></div>
              </div>
            </div>
            <div class="focus-timer-actions">
              <button class="focus-timer-btn focus-timer-btn-secondary" type="button" data-timer-action="toggle">Pause</button>
              <button class="focus-timer-btn focus-timer-btn-stop" type="button" data-timer-action="stop">End &amp; save</button>
            </div>
          </div>
        </div>
      </section>`;
    document.body.appendChild(overlay);
  }

  function renderRunningContext(root = document) {
    if (!state.active) return;
    root.querySelectorAll('[data-timer-client]').forEach(node => {
      setText(node, state.active.client_name || 'Internal work');
      node.title = node.textContent;
    });
    root.querySelectorAll('[data-timer-task]').forEach(node => {
      setText(node, state.active.task_type || 'Work');
      node.title = node.textContent;
    });
    const paused = state.active.status === 'paused';
    root.querySelectorAll('[data-timer-state-label]').forEach(node => setText(node, paused ? 'Timer paused' : 'Time in progress'));
    root.querySelectorAll('[data-timer-live-mark]').forEach(node => {
      setText(node, paused ? 'Paused' : 'Live');
      node.classList.toggle('is-paused', paused);
    });
  }

  function updateElapsed(root = document) {
    const value = formatElapsed(elapsedSeconds());
    root.querySelectorAll('[data-timer-elapsed]').forEach(node => setText(node, value));
    const launcherTime = el(ids.launcher)?.querySelector('.focus-timer-launcher-time');
    if (launcherTime) setText(launcherTime, value);
  }

  function render() {
    const launcher = el(ids.launcher);
    const idle = el(ids.idle);
    const running = el(ids.running);
    if (!launcher || !idle || !running) return;
    const paused = state.active?.status === 'paused';
    launcher.classList.toggle('is-running', !!state.active && !paused);
    launcher.classList.toggle('is-paused', !!paused);
    launcher.querySelector('.focus-timer-launcher-label').textContent = paused ? 'Paused' : (state.active ? 'Tracking' : 'Timer');
    launcher.querySelector('.focus-timer-launcher-time').hidden = !state.active;
    idle.hidden = !!state.active;
    running.hidden = !state.active;
    if (state.active) {
      renderRunningContext();
      updateElapsed();
      const toggle = document.querySelector('[data-timer-action="toggle"]');
      if (toggle) toggle.textContent = paused ? 'Resume' : 'Pause';
    }
    renderPiP();
  }

  function openModal() {
    const overlay = el(ids.overlay);
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    showNotice('');
    window.setTimeout(() => {
      const target = state.active ? overlay.querySelector('[data-timer-action="toggle"]') : el(ids.client);
      target?.focus();
    }, 0);
  }

  function closeModal(restoreFocus = true) {
    const overlay = el(ids.overlay);
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    if (restoreFocus) el(ids.launcher)?.focus();
  }

  async function openTimer() {
    if (supportsPiP()) {
      await requestPiPWindow();
      return;
    }
    openModal();
  }

  async function loadOptions() {
    try {
      const [clients, masters] = await Promise.all([apiFetch('/clients'), apiFetch('/master-data')]);
      state.clients = (clients || []).filter(item => item.active !== false && item.active !== 0 && item.active !== '0');
      state.categories = (masters?.work_categories || []).filter(item => item.active !== false && item.active !== 0 && item.active !== '0');
      populateMainOptions();
      if (state.pipWindow) renderPiP(true);
    } catch (error) {
      showNotice(error.message || 'Timer options could not be loaded.');
    }
  }

  async function loadActive({ quiet = true } = {}) {
    try {
      const previousSessionId = state.active?.session_id;
      const result = await apiFetch('/timer/active');
      setServerTime(result.server_now);
      state.active = result.active || null;
      if (state.active && state.active.session_id !== previousSessionId) {
        state.lastSaved = null;
        state.pipNotice = '';
        state.pipCollapsed = true;
        rememberActiveAsDraft(state.active);
      }
      render();
    } catch (error) {
      if (!quiet) showNotice(error.message || 'The active timer could not be checked.');
    }
  }

  async function requestPiPWindow({ syncFromMain = true } = {}) {
    if (!supportsPiP()) return null;
    if (state.pipWindow && !state.pipWindow.closed) {
      state.pipWindow.focus();
      return state.pipWindow;
    }
    if (!state.active && syncFromMain) captureDraft(document);
    if (state.active) state.pipCollapsed = true;
    const size = PIP_SIZES[pipMode()];
    try {
      state.pipWindow = await documentPictureInPicture.requestWindow(size);
      state.pipWindow.document.documentElement.className = 'focus-timer-pip-root';
      state.pipWindow.document.body.className = 'focus-timer-pip-body';
      const stylesheet = state.pipWindow.document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = '/css/focus-timer.css';
      state.pipWindow.document.head.appendChild(stylesheet);
      state.pipWindow.document.title = 'Samay timer';
      state.pipWindow.addEventListener('pagehide', () => {
        state.pipWindow = null;
        state.pipRenderedMode = '';
      }, { once: true });
      state.pipRenderedMode = '';
      renderPiP(true);
      state.pipWindow.focus();
      return state.pipWindow;
    } catch {
      state.pipWindow = null;
      state.pipRenderedMode = '';
      showNotice('The floating timer could not open. Continue in this window.');
      openModal();
      return null;
    }
  }

  function makePiPShell(pip, mode) {
    const shell = pip.document.createElement('main');
    shell.className = `focus-timer-pip focus-timer-pip-${mode}`;
    shell.classList.toggle('is-paused', state.active?.status === 'paused');
    shell.dataset.timerPipMode = mode;
    return shell;
  }

  function renderPiP(force = false) {
    const pip = state.pipWindow;
    if (!pip || pip.closed) return;
    const mode = pipMode();
    const body = pip.document.body;
    const existing = body.querySelector(`[data-timer-pip-mode="${mode}"]`);
    if (!force && state.pipRenderedMode === mode && existing) {
      existing.classList.toggle('is-paused', state.active?.status === 'paused');
      if (state.active) {
        renderRunningContext(pip.document);
        updateElapsed(pip.document);
      }
      showInputNotice(pip.document, state.pipNotice);
      return;
    }

    state.pipRenderedMode = mode;
    body.replaceChildren();
    const shell = makePiPShell(pip, mode);

    if (mode === 'collapsed') {
      shell.innerHTML = `
        <button class="focus-timer-pip-banner" type="button" data-timer-pip-action="expand" aria-label="Expand running Samay timer">
          <span class="focus-timer-pip-status-dot" aria-hidden="true"></span>
          <span class="focus-timer-pip-banner-time" data-timer-elapsed>00:00:00</span>
          <span class="focus-timer-pip-chevron" aria-hidden="true">&#8249;</span>
        </button>`;
      body.appendChild(shell);
      shell.querySelector('[data-timer-pip-action="expand"]').addEventListener('click', () => {
        state.pipCollapsed = false;
        renderPiP(true);
      });
      renderRunningContext(pip.document);
      updateElapsed(pip.document);
      resizePiP('collapsed');
      setBusy(state.busy);
      return;
    }

    if (mode === 'idle') {
      shell.innerHTML = `
        <section class="focus-timer-pip-card" aria-label="Start a new timer">
          <header class="focus-timer-pip-head">
            <div class="focus-timer-pip-brand"><img src="/icons/samay-icon.svg" alt="" width="18" height="18"><div><span>Samay</span><strong>New timer</strong></div></div>
            <button class="focus-timer-pip-icon-btn" type="button" data-timer-pip-action="exit" aria-label="Exit timer">&times;</button>
          </header>
          <div class="focus-timer-pip-notice" data-timer-pip-notice hidden></div>
          <div class="focus-timer-pip-form">
            <label>Client <span>optional</span><input type="search" autocomplete="off" list="focus-timer-pip-client-list" data-timer-input="client_id" placeholder="Search name or code"><datalist id="focus-timer-pip-client-list" data-timer-client-options></datalist></label>
            <label>Work<input type="search" autocomplete="off" list="focus-timer-pip-task-list" data-timer-input="task_type" placeholder="Search work"><datalist id="focus-timer-pip-task-list" data-timer-task-options></datalist></label>
            <label>Note <span>optional</span><input type="text" maxlength="2000" data-timer-input="description" placeholder="What are you working on?"></label>
          </div>
          <div class="focus-timer-pip-actions">
            <button class="focus-timer-pip-btn is-quiet" type="button" data-timer-pip-action="exit">Exit</button>
            <button class="focus-timer-pip-btn is-primary" type="button" data-timer-pip-action="start">Start</button>
          </div>
        </section>`;
      body.appendChild(shell);
      populatePiPInputs(pip.document);
      showInputNotice(pip.document, state.pipNotice);
      shell.querySelectorAll('[data-timer-input]').forEach(input => {
        input.addEventListener('input', () => captureDraft(pip.document));
        input.addEventListener('change', () => captureDraft(pip.document));
      });
      shell.querySelectorAll('[data-timer-pip-action="exit"]').forEach(button => button.addEventListener('click', () => pip.close()));
      shell.querySelector('[data-timer-pip-action="start"]').addEventListener('click', () => startTimer(pip.document));
      resizePiP(state.pipNotice ? 'idleError' : 'idle');
      setBusy(state.busy);
      return;
    }

    if (mode === 'saved') {
      const entryCount = state.lastSaved?.entry_ids?.length || 0;
      shell.innerHTML = `
        <section class="focus-timer-pip-card focus-timer-pip-saved" aria-label="Timer saved">
          <header class="focus-timer-pip-head">
            <div class="focus-timer-pip-brand"><span class="focus-timer-pip-saved-mark" aria-hidden="true">&#10003;</span><div><span>Draft saved</span><strong data-timer-saved-duration></strong></div></div>
            <button class="focus-timer-pip-icon-btn" type="button" data-timer-pip-action="exit" aria-label="Exit timer">&times;</button>
          </header>
          <p data-timer-saved-message></p>
          <div class="focus-timer-pip-actions is-saved">
            <button class="focus-timer-pip-btn is-quiet" type="button" data-timer-pip-action="reenter">Re-enter</button>
            <button class="focus-timer-pip-btn is-primary" type="button" data-timer-pip-action="new">New timer</button>
          </div>
        </section>`;
      body.appendChild(shell);
      setText(shell.querySelector('[data-timer-saved-duration]'), formatElapsed(state.lastSaved?.elapsed_seconds));
      setText(shell.querySelector('[data-timer-saved-message]'), state.lastSaved?.warning || `${entryCount || 1} draft ${entryCount === 1 ? 'entry' : 'entries'} ready for review.`);
      shell.querySelector('[data-timer-pip-action="exit"]').addEventListener('click', () => pip.close());
      shell.querySelector('[data-timer-pip-action="reenter"]').addEventListener('click', reenterSavedDraft);
      shell.querySelector('[data-timer-pip-action="new"]').addEventListener('click', () => {
        state.lastSaved = null;
        state.pipNotice = '';
        renderPiP(true);
      });
      resizePiP('saved');
      setBusy(state.busy);
      return;
    }

    shell.innerHTML = `
      <section class="focus-timer-pip-card focus-timer-pip-running-card" aria-label="${mode === 'paused' ? 'Paused' : 'Running'} timer">
        <header class="focus-timer-pip-head">
          <div class="focus-timer-pip-running-client" data-timer-client></div>
          <button class="focus-timer-pip-icon-btn is-collapse" type="button" data-timer-pip-action="collapse" aria-label="Collapse timer">&#8250;</button>
        </header>
        <div class="focus-timer-pip-running-row">
          <div class="focus-timer-pip-running-time" data-timer-elapsed>00:00:00</div>
          <span class="focus-timer-live-mark" data-timer-live-mark>Live</span>
        </div>
        <div class="focus-timer-pip-running-task" data-timer-task></div>
        <div class="focus-timer-pip-notice is-compact" data-timer-pip-notice hidden></div>
        <div class="focus-timer-pip-actions is-running">
          <button class="focus-timer-pip-btn is-quiet" type="button" data-timer-pip-action="toggle">${mode === 'paused' ? 'Resume' : 'Pause'}</button>
          <button class="focus-timer-pip-btn is-end" type="button" data-timer-pip-action="stop">End</button>
        </div>
      </section>`;
    body.appendChild(shell);
    renderRunningContext(pip.document);
    updateElapsed(pip.document);
    showInputNotice(pip.document, state.pipNotice);
    shell.querySelector('[data-timer-pip-action="collapse"]').addEventListener('click', () => {
      state.pipCollapsed = true;
      state.pipNotice = '';
      renderPiP(true);
    });
    shell.querySelector('[data-timer-pip-action="toggle"]').addEventListener('click', pauseOrResumeTimer);
    shell.querySelector('[data-timer-pip-action="stop"]').addEventListener('click', stopTimer);
    resizePiP(state.pipNotice ? 'runningError' : mode);
    setBusy(state.busy);
  }

  async function startTimer(inputRoot = document) {
    if (state.busy) return;
    const clientInput = timerInput(inputRoot, 'client_id');
    const taskInput = timerInput(inputRoot, 'task_type');
    const typedClient = clientInput && !clientInput.matches('select') ? clientInput.value.trim() : '';
    const draft = captureDraft(inputRoot);
    const selectedTask = resolveTask(draft.task_type);
    if (typedClient && !draft.client_id) {
      return showInputNotice(inputRoot, 'Choose a client from the search results, or clear it for internal work.');
    }
    if (!selectedTask) return showInputNotice(inputRoot, 'Choose the work from the search results.');
    draft.task_type = selectedTask.label;
    draft.work_classification = draft.client_id ? 'client_work' : 'internal';
    state.draft = { ...draft };

    setBusy(true);
    state.pipNotice = '';
    state.lastSaved = null;
    showInputNotice(inputRoot, '');
    try {
      const result = await apiFetch('/timer/start', {
        method: 'POST',
        body: {
          client_id: draft.client_id || null,
          task_type: draft.task_type,
          work_classification: draft.work_classification,
          description: draft.description,
          source: sourceName()
        }
      });
      setServerTime(result.server_now);
      state.active = result.active;
      state.pipCollapsed = !!state.pipWindow;
      rememberActiveAsDraft(result.active);
      state.channel?.postMessage('changed');
      render();
      closeModal(false);
      if (!state.pipWindow) toast('Timer started. Use the Timer pill to manage it.', 'success');
    } catch (error) {
      await loadActive();
      if (state.active) {
        state.pipCollapsed = !!state.pipWindow;
        render();
        closeModal(false);
        toast('Your active timer was recovered.', 'info');
      } else {
        const message = error.message || 'Timer could not be started.';
        renderPiP(true);
        showInputNotice(inputRoot === document ? document : (state.pipWindow?.document || document), message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function pauseOrResumeTimer() {
    if (state.busy || !state.active) return;
    const action = state.active.status === 'paused' ? 'resume' : 'pause';
    setBusy(true);
    state.pipNotice = '';
    showNotice('');
    try {
      const result = await apiFetch(`/timer/${action}`, { method: 'POST', body: {} });
      setServerTime(result.server_now);
      state.active = result.active;
      state.channel?.postMessage('changed');
      render();
    } catch (error) {
      await loadActive();
      const message = error.message || `Timer could not be ${action === 'pause' ? 'paused' : 'resumed'}.`;
      state.pipNotice = message;
      showNotice(message);
      renderPiP(true);
    } finally {
      setBusy(false);
    }
  }

  async function stopTimer() {
    if (state.busy || !state.active) return;
    const completed = state.active;
    setBusy(true);
    showNotice('');
    state.pipNotice = '';
    try {
      const result = await apiFetch('/timer/stop', {
        method: 'POST',
        body: { description: state.active.description || '' }
      });
      rememberActiveAsDraft(completed, { clearDescription: true });
      state.active = null;
      state.pipCollapsed = false;
      state.lastSaved = result;
      state.channel?.postMessage('changed');
      render();
      closeModal(false);
      if (!state.pipWindow) toast(result.warning || 'Timer ended. Draft timesheet created.', result.warning ? 'info' : 'success');
      window.dispatchEvent(new CustomEvent('samay:timer-stopped', { detail: result }));
      if (typeof window.loadEntries === 'function') window.loadEntries();
    } catch (error) {
      await loadActive();
      if (!state.active) {
        state.pipNotice = 'The timer was ended elsewhere. Check My Work for the draft.';
        state.lastSaved = null;
        renderPiP(true);
        closeModal(false);
        toast(state.pipNotice, 'info');
      } else {
        const message = error.message || 'Timer could not be ended. It remains active.';
        state.pipNotice = message;
        showNotice(message);
        renderPiP(true);
        if (!state.pipWindow) openModal();
      }
    } finally {
      setBusy(false);
    }
  }

  function reenterSavedDraft() {
    const entries = state.lastSaved?.entries || [];
    const canEdit = typeof hasPermission === 'function' && hasPermission('timesheets.edit_own');
    if (entries.length === 1 && canEdit) {
      sessionStorage.setItem('ts_edit_entry', JSON.stringify(entries[0]));
      state.pipWindow?.close();
      window.location.href = '/timesheet.html';
      return;
    }
    state.pipWindow?.close();
    window.location.href = '/my-timesheets.html?status=draft';
  }

  function bindEvents() {
    el(ids.launcher).addEventListener('click', openTimer);
    el(ids.overlay).addEventListener('click', event => {
      if (event.target === el(ids.overlay)) closeModal();
    });
    document.querySelectorAll('[data-timer-close]').forEach(button => button.addEventListener('click', closeModal));
    document.querySelector('[data-timer-action="start"]').addEventListener('click', () => startTimer(document));
    document.querySelector('[data-timer-action="toggle"]').addEventListener('click', pauseOrResumeTimer);
    document.querySelector('[data-timer-action="stop"]').addEventListener('click', stopTimer);
    [ids.client, ids.task, ids.description].forEach(inputId => {
      el(inputId).addEventListener('input', () => captureDraft(document));
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && el(ids.overlay).classList.contains('is-open')) closeModal();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) loadActive();
    });
  }

  async function init() {
    if (state.initialized || !document.body) return;
    state.initialized = true;
    injectMarkup();
    bindEvents();
    if ('BroadcastChannel' in window) {
      state.channel = new BroadcastChannel('samay-focus-timer');
      state.channel.addEventListener('message', () => loadActive());
    }
    state.tickHandle = window.setInterval(() => {
      if (state.active) {
        updateElapsed();
        if (state.pipWindow) updateElapsed(state.pipWindow.document);
      }
    }, 1000);
    state.pollHandle = window.setInterval(() => loadActive(), 30000);
    await Promise.all([loadOptions(), loadActive({ quiet: false })]);
  }

  window.SamayFocusTimer = { init, open: openTimer, openFloating: requestPiPWindow, refresh: loadActive };
})();
