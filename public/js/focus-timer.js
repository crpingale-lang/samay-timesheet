(() => {
  const state = {
    initialized: false,
    active: null,
    clients: [],
    categories: [],
    classifications: [],
    clockOffsetMs: 0,
    pipWindow: null,
    tickHandle: null,
    pollHandle: null,
    busy: false,
    channel: null,
    pipRenderedMode: '',
    pipNotice: '',
    draft: {
      client_id: '',
      task_type: '',
      work_classification: 'client_work',
      description: ''
    }
  };

  const PIP_SIZES = {
    idle: { width: 360, height: 390 },
    running: { width: 300, height: 185 },
    runningError: { width: 300, height: 245 }
  };

  const ids = {
    launcher: 'focus-timer-launcher',
    overlay: 'focus-timer-overlay',
    idle: 'focus-timer-idle',
    running: 'focus-timer-running',
    client: 'focus-timer-client',
    task: 'focus-timer-task',
    classification: 'focus-timer-classification',
    description: 'focus-timer-description',
    runningDescription: 'focus-timer-running-description',
    notice: 'focus-timer-notice'
  };

  function el(id, root = document) {
    return root.getElementById(id);
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
    return Math.max(0, Math.floor((currentServerTime() - Date.parse(state.active.started_at)) / 1000));
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

  function timerInput(root, name) {
    const mainIds = {
      client_id: ids.client,
      task_type: ids.task,
      work_classification: ids.classification,
      description: ids.description
    };
    return root === document
      ? el(mainIds[name])
      : root?.querySelector(`[data-timer-input="${name}"]`);
  }

  function captureDraft(root = document) {
    Object.keys(state.draft).forEach(name => {
      const input = timerInput(root, name);
      if (!input) return;
      if (name === 'work_classification' && !input.value) return;
      state.draft[name] = input.value;
    });
    return { ...state.draft };
  }

  function addOption(select, label, value) {
    const option = select.ownerDocument.createElement('option');
    option.value = value == null ? '' : String(value);
    option.textContent = label == null ? '' : String(label);
    select.appendChild(option);
  }

  function applyDraft(root = document) {
    Object.entries(state.draft).forEach(([name, value]) => {
      const input = timerInput(root, name);
      if (!input) return;
      if (input.matches('select')) {
        const hasValue = [...input.options].some(option => option.value === String(value || ''));
        if (hasValue) input.value = String(value || '');
        else if (name === 'work_classification' && input.options.length) {
          input.value = input.options[0].value;
          state.draft.work_classification = input.value;
        }
      } else {
        input.value = value || '';
      }
    });
    updateClientRequirement(root);
  }

  function populateTimerOptions(root = document) {
    const client = timerInput(root, 'client_id');
    const task = timerInput(root, 'task_type');
    const classification = timerInput(root, 'work_classification');
    if (!client || !task || !classification) return;

    client.replaceChildren();
    addOption(client, 'Select client', '');
    state.clients.forEach(item => addOption(client, `${item.name}${item.code ? ` [${item.code}]` : ''}`, item.id));
    task.replaceChildren();
    addOption(task, 'Select work', '');
    state.categories.forEach(item => addOption(task, item.label, item.label));
    classification.replaceChildren();
    state.classifications.forEach(item => addOption(classification, item.label, item.key));
    applyDraft(root);
  }

  function showInputNotice(root, message = '') {
    if (root === document) {
      showNotice(message);
      return;
    }
    state.pipNotice = message;
    const notice = root?.querySelector('[data-timer-pip-notice]');
    if (!notice) return;
    notice.hidden = !message;
    setText(notice, message);
    resizePiP(state.active && message ? 'runningError' : (state.active ? 'running' : 'idle'));
  }

  function rememberActiveAsDraft(active, { clearDescription = false } = {}) {
    if (!active) return;
    state.draft = {
      client_id: active.client_id == null ? '' : String(active.client_id),
      task_type: active.task_type || '',
      work_classification: active.work_classification || 'client_work',
      description: clearDescription ? '' : (active.description || '')
    };
    applyDraft(document);
  }

  function resizePiP(mode) {
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

  function setBusy(busy) {
    state.busy = busy;
    [document, state.pipWindow?.document].filter(Boolean).forEach(root => {
      root.querySelectorAll('[data-timer-action], [data-timer-pip-start], [data-timer-pip-stop]').forEach(button => {
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
    launcher.setAttribute('aria-haspopup', 'dialog');
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
            <div class="focus-timer-kicker">Live capture</div>
            <h2 class="focus-timer-title" id="focus-timer-title">Focus timer</h2>
            <p class="focus-timer-subtitle">Select the work once. Samay will prepare the draft when you stop.</p>
          </div>
          <button class="focus-timer-close" type="button" data-timer-close aria-label="Close timer">&times;</button>
        </header>
        <div class="focus-timer-body">
          <div class="focus-timer-notice" id="${ids.notice}" hidden></div>
          <div id="${ids.idle}">
            <div class="focus-timer-form">
              <div class="focus-timer-field">
                <label for="${ids.classification}">Work classification</label>
                <select id="${ids.classification}"></select>
              </div>
              <div class="focus-timer-field">
                <label for="${ids.client}">Client / matter</label>
                <select id="${ids.client}"><option value="">Select client</option></select>
                <div class="focus-timer-field-help" id="focus-timer-client-help">Required for client work.</div>
              </div>
              <div class="focus-timer-field is-wide">
                <label for="${ids.task}">Work category</label>
                <select id="${ids.task}"><option value="">Select work</option></select>
              </div>
              <div class="focus-timer-field is-wide">
                <label for="${ids.description}">Note <span style="font-weight:500;color:#64748b;">(optional)</span></label>
                <textarea id="${ids.description}" maxlength="2000" placeholder="What are you working on?"></textarea>
              </div>
            </div>
            <div class="focus-timer-actions">
              <button class="focus-timer-btn focus-timer-btn-secondary" type="button" data-timer-close>Not now</button>
              <button class="focus-timer-btn focus-timer-btn-secondary" type="button" data-timer-action="pip">Open floating box</button>
              <button class="focus-timer-btn focus-timer-btn-primary" type="button" data-timer-action="start">Start &amp; float</button>
            </div>
          </div>
          <div id="${ids.running}" class="focus-timer-running" hidden>
            <div class="focus-timer-running-card">
              <div class="focus-timer-running-top">
                <div>
                  <div class="focus-timer-running-label">Time in progress</div>
                  <div class="focus-timer-running-time" data-timer-elapsed>00:00:00</div>
                  <div class="focus-timer-running-started" data-timer-started></div>
                </div>
                <span class="focus-timer-live-mark">Live</span>
              </div>
              <div class="focus-timer-context">
                <div class="focus-timer-context-item">
                  <div class="focus-timer-context-label">Client</div>
                  <div class="focus-timer-context-value" data-timer-client></div>
                </div>
                <div class="focus-timer-context-item">
                  <div class="focus-timer-context-label">Work</div>
                  <div class="focus-timer-context-value" data-timer-task></div>
                </div>
              </div>
            </div>
            <div class="focus-timer-field" style="margin-top:20px;">
              <label for="${ids.runningDescription}">Final note</label>
              <textarea id="${ids.runningDescription}" maxlength="2000" placeholder="Add a note before stopping"></textarea>
            </div>
            <div class="focus-timer-actions">
              <button class="focus-timer-text-action" type="button" data-timer-action="discard">Discard timer</button>
              <button class="focus-timer-btn focus-timer-btn-secondary" type="button" data-timer-action="pip">Open floating box</button>
              <button class="focus-timer-btn focus-timer-btn-stop" type="button" data-timer-action="stop">Stop &amp; save draft</button>
            </div>
          </div>
        </div>
      </section>`;
    document.body.appendChild(overlay);
  }

  function renderOptions() {
    captureDraft(document);
    populateTimerOptions(document);
    renderPiP(true);
  }

  function updateClientRequirement(root = document) {
    const classification = timerInput(root, 'work_classification')?.value || 'client_work';
    const client = timerInput(root, 'client_id');
    const help = root === document
      ? el('focus-timer-client-help')
      : root?.querySelector('[data-timer-client-help]');
    if (client) client.required = classification === 'client_work';
    setText(help, classification === 'client_work' ? 'Required for client work.' : 'Optional for this classification.');
  }

  function renderRunningContext(root = document) {
    if (!state.active) return;
    root.querySelectorAll('[data-timer-client]').forEach(node => {
      setText(node, state.active.client_name || 'Internal / no client');
      node.title = node.textContent;
    });
    root.querySelectorAll('[data-timer-task]').forEach(node => {
      setText(node, state.active.task_type || 'Work');
      node.title = node.textContent;
    });
    root.querySelectorAll('[data-timer-started]').forEach(node => {
      const started = new Date(state.active.started_at);
      setText(node, `Started ${started.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`);
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
    launcher.classList.toggle('is-running', !!state.active);
    launcher.querySelector('.focus-timer-launcher-label').textContent = state.active ? 'Tracking' : 'Timer';
    launcher.querySelector('.focus-timer-launcher-time').hidden = !state.active;
    idle.hidden = !!state.active;
    running.hidden = !state.active;
    const startButton = document.querySelector('[data-timer-action="start"]');
    const pipButtons = document.querySelectorAll('[data-timer-action="pip"]');
    if (startButton) startButton.textContent = supportsPiP() ? 'Start & float' : 'Start timer';
    pipButtons.forEach(button => { button.hidden = !supportsPiP(); });
    if (state.active) {
      const runningDescription = el(ids.runningDescription);
      if (document.activeElement !== runningDescription) runningDescription.value = state.active.description || '';
      renderRunningContext();
      updateElapsed();
    }
    renderPiP();
  }

  function openModal() {
    const overlay = el(ids.overlay);
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    showNotice('');
    window.setTimeout(() => {
      const target = state.active ? overlay.querySelector('[data-timer-action="stop"]') : el(ids.classification);
      target?.focus();
    }, 0);
  }

  function closeModal(restoreFocus = true) {
    const overlay = el(ids.overlay);
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    if (restoreFocus) el(ids.launcher)?.focus();
  }

  async function loadOptions() {
    try {
      const [clients, masters] = await Promise.all([apiFetch('/clients'), apiFetch('/master-data')]);
      state.clients = (clients || []).filter(item => item.active !== false && item.active !== 0 && item.active !== '0');
      state.categories = (masters?.work_categories || []).filter(item => item.active !== false && item.active !== 0 && item.active !== '0');
      state.classifications = (masters?.work_classifications || []).filter(item => item.active !== false && item.active !== 0 && item.active !== '0');
      renderOptions();
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
        state.pipNotice = '';
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
    const size = PIP_SIZES[state.active ? 'running' : 'idle'];
    try {
      state.pipWindow = await documentPictureInPicture.requestWindow(size);
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
      showNotice('The floating timer could not open. You can continue in this window.');
      return null;
    }
  }

  async function openPiPFromModal() {
    const pip = await requestPiPWindow();
    if (pip) closeModal(false);
  }

  function renderPiP(force = false) {
    const pip = state.pipWindow;
    if (!pip || pip.closed) return;
    const mode = state.active ? 'running' : 'idle';
    const body = pip.document.body;
    const existing = body.querySelector(`[data-timer-pip-mode="${mode}"]`);
    if (!force && state.pipRenderedMode === mode && existing) {
      if (mode === 'running') {
        renderRunningContext(pip.document);
        updateElapsed(pip.document);
      } else {
        showInputNotice(pip.document, state.pipNotice);
      }
      return;
    }

    state.pipRenderedMode = mode;
    body.replaceChildren();
    const shell = pip.document.createElement('main');
    shell.className = 'focus-timer-pip';
    shell.dataset.timerPipMode = mode;

    if (mode === 'idle') {
      shell.innerHTML = `
        <section class="focus-timer-pip-card" aria-label="Start a new timer">
          <header class="focus-timer-pip-head">
            <div>
              <div class="focus-timer-pip-kicker"><span aria-hidden="true"></span> Samay</div>
              <h1>New timer</h1>
            </div>
            <button class="focus-timer-pip-close" type="button" data-timer-pip-close aria-label="Close floating timer">&times;</button>
          </header>
          <div class="focus-timer-pip-notice" data-timer-pip-notice hidden></div>
          <div class="focus-timer-pip-form">
            <label>Classification<select data-timer-input="work_classification"></select></label>
            <label>Client / matter<select data-timer-input="client_id"></select><small data-timer-client-help></small></label>
            <label>Work category<select data-timer-input="task_type"></select></label>
            <label>Note <span>(optional)</span><input type="text" maxlength="2000" data-timer-input="description" placeholder="What are you working on?"></label>
          </div>
          <button class="focus-timer-btn focus-timer-btn-primary focus-timer-pip-start" type="button" data-timer-pip-start>Start recording</button>
          <p class="focus-timer-pip-footnote">Stopping saves a draft and prepares the next timer.</p>
        </section>`;
      body.appendChild(shell);
      populateTimerOptions(pip.document);
      showInputNotice(pip.document, state.pipNotice);
      shell.querySelectorAll('[data-timer-input]').forEach(input => {
        input.addEventListener('input', () => {
          captureDraft(pip.document);
          updateClientRequirement(pip.document);
        });
      });
      shell.querySelector('[data-timer-pip-close]').addEventListener('click', () => pip.close());
      shell.querySelector('[data-timer-pip-start]').addEventListener('click', () => startTimer(pip.document));
      resizePiP('idle');
      setBusy(state.busy);
      return;
    }

    shell.innerHTML = `
      <section class="focus-timer-pip-running" aria-label="Running timer">
        <header class="focus-timer-pip-running-head">
          <div class="focus-timer-pip-running-client" data-timer-client></div>
          <span class="focus-timer-live-mark">Live</span>
        </header>
        <div class="focus-timer-running-time" data-timer-elapsed>00:00:00</div>
        <div class="focus-timer-pip-running-task" data-timer-task></div>
        <div class="focus-timer-pip-notice is-compact" data-timer-pip-notice hidden></div>
        <button class="focus-timer-btn focus-timer-btn-stop" type="button" data-timer-pip-stop>Stop &amp; save</button>
      </section>`;
    body.appendChild(shell);
    renderRunningContext(pip.document);
    updateElapsed(pip.document);
    showInputNotice(pip.document, state.pipNotice);
    shell.querySelector('[data-timer-pip-stop]').addEventListener('click', stopTimer);
    resizePiP('running');
    setBusy(state.busy);
  }

  async function startTimer(inputRoot = document) {
    if (state.busy) return;
    const draft = captureDraft(inputRoot);
    const classification = draft.work_classification;
    const clientId = draft.client_id;
    const taskType = draft.task_type;
    if (!taskType) return showInputNotice(inputRoot, 'Select the work category before starting.');
    if (classification === 'client_work' && !clientId) {
      return showInputNotice(inputRoot, 'Select the client for client work.');
    }

    setBusy(true);
    state.pipNotice = '';
    showInputNotice(inputRoot, '');
    const pipPromise = inputRoot === document
      ? requestPiPWindow({ syncFromMain: false })
      : Promise.resolve(state.pipWindow);
    try {
      await pipPromise;
      const result = await apiFetch('/timer/start', {
        method: 'POST',
        body: {
          client_id: clientId || null,
          task_type: taskType,
          work_classification: classification,
          description: draft.description,
          source: sourceName()
        }
      });
      setServerTime(result.server_now);
      state.active = result.active;
      rememberActiveAsDraft(result.active);
      state.channel?.postMessage('changed');
      render();
      closeModal(false);
      if (!state.pipWindow) toast('Timer started. Use the Timer pill to stop it.', 'success');
    } catch (error) {
      await loadActive();
      if (state.active) {
        render();
        closeModal(false);
        toast('Your running timer was recovered.', 'info');
      } else {
        const message = error.message || 'Timer could not be started.';
        renderPiP(true);
        showInputNotice(inputRoot === document ? document : (state.pipWindow?.document || document), message);
        if (inputRoot === document && state.pipWindow) showInputNotice(state.pipWindow.document, message);
      }
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
        body: { description: el(ids.runningDescription)?.value ?? state.active.description ?? '' }
      });
      rememberActiveAsDraft(completed, { clearDescription: true });
      state.active = null;
      state.pipNotice = result.warning || 'Draft saved. Ready for the next timer.';
      state.channel?.postMessage('changed');
      render();
      closeModal(false);
      if (result.warning) toast(result.warning, 'info');
      else toast('Timer stopped. Draft timesheet created.', 'success');
      window.dispatchEvent(new CustomEvent('samay:timer-stopped', { detail: result }));
      if (typeof window.loadEntries === 'function') window.loadEntries();
    } catch (error) {
      await loadActive();
      if (!state.active) {
        state.pipNotice = 'Timer saved or stopped remotely. Ready for the next timer.';
        renderPiP(true);
        closeModal(false);
        toast('The timer is no longer running. Check My Work for the recovered draft.', 'info');
      } else {
        const message = error.message || 'Timer could not be stopped. It is still running.';
        state.pipNotice = message;
        showNotice(message);
        showInputNotice(state.pipWindow?.document, message);
        if (!state.pipWindow) openModal();
      }
    } finally {
      setBusy(false);
    }
  }

  async function discardTimer() {
    if (state.busy || !state.active) return;
    if (!window.confirm('Discard this running timer without creating a draft?')) return;
    const discarded = state.active;
    setBusy(true);
    try {
      await apiFetch('/timer/discard', { method: 'POST', body: {} });
      rememberActiveAsDraft(discarded, { clearDescription: true });
      state.active = null;
      state.pipNotice = 'Timer discarded. Ready to start another.';
      state.channel?.postMessage('changed');
      render();
      closeModal(false);
      toast('Timer discarded.', 'success');
    } catch (error) {
      const message = error.message || 'Timer could not be discarded.';
      showNotice(message);
      showInputNotice(state.pipWindow?.document, message);
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    el(ids.launcher).addEventListener('click', openModal);
    el(ids.overlay).addEventListener('click', event => {
      if (event.target === el(ids.overlay)) closeModal();
    });
    document.querySelectorAll('[data-timer-close]').forEach(button => button.addEventListener('click', closeModal));
    document.querySelector('[data-timer-action="start"]').addEventListener('click', () => startTimer(document));
    document.querySelector('[data-timer-action="stop"]').addEventListener('click', stopTimer);
    document.querySelector('[data-timer-action="discard"]').addEventListener('click', discardTimer);
    document.querySelectorAll('[data-timer-action="pip"]').forEach(button => button.addEventListener('click', openPiPFromModal));
    [ids.client, ids.task, ids.classification, ids.description].forEach(inputId => {
      el(inputId).addEventListener('input', () => {
        captureDraft(document);
        updateClientRequirement(document);
      });
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

  window.SamayFocusTimer = { init, open: openModal, openFloating: openPiPFromModal, refresh: loadActive };
})();
