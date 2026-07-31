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
    channel: null
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

  function showNotice(message = '') {
    const notice = el(ids.notice);
    if (!notice) return;
    notice.hidden = !message;
    setText(notice, message);
  }

  function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll('[data-timer-action]').forEach(button => {
      button.disabled = busy;
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
    const client = el(ids.client);
    const task = el(ids.task);
    const classification = el(ids.classification);
    if (!client || !task || !classification) return;

    client.replaceChildren(new Option('Select client', ''));
    state.clients.forEach(item => client.add(new Option(`${item.name}${item.code ? ` [${item.code}]` : ''}`, item.id)));
    task.replaceChildren(new Option('Select work', ''));
    state.categories.forEach(item => task.add(new Option(item.label, item.label)));
    classification.replaceChildren();
    state.classifications.forEach(item => classification.add(new Option(item.label, item.key)));
    if (!classification.value && state.classifications.length) classification.value = state.classifications[0].key;
    updateClientRequirement();
  }

  function updateClientRequirement() {
    const classification = el(ids.classification)?.value || 'client_work';
    const help = el('focus-timer-client-help');
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
    const pipButton = document.querySelector('[data-timer-action="pip"]');
    if (startButton) startButton.textContent = supportsPiP() ? 'Start & float' : 'Start timer';
    if (pipButton) pipButton.hidden = !supportsPiP();
    if (state.active) {
      el(ids.runningDescription).value = state.active.description || '';
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

  function closeModal() {
    const overlay = el(ids.overlay);
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    el(ids.launcher)?.focus();
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
      const result = await apiFetch('/timer/active');
      setServerTime(result.server_now);
      state.active = result.active || null;
      render();
    } catch (error) {
      if (!quiet) showNotice(error.message || 'The active timer could not be checked.');
    }
  }

  async function requestPiPWindow() {
    if (!supportsPiP()) return null;
    if (state.pipWindow && !state.pipWindow.closed) return state.pipWindow;
    try {
      state.pipWindow = await documentPictureInPicture.requestWindow({ width: 340, height: 330 });
      const stylesheet = state.pipWindow.document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = '/css/focus-timer.css';
      state.pipWindow.document.head.appendChild(stylesheet);
      state.pipWindow.document.title = 'Samay timer';
      state.pipWindow.addEventListener('pagehide', () => {
        state.pipWindow = null;
      }, { once: true });
      renderPiP();
      return state.pipWindow;
    } catch {
      state.pipWindow = null;
      return null;
    }
  }

  function renderPiP() {
    const pip = state.pipWindow;
    if (!pip || pip.closed) return;
    const body = pip.document.body;
    body.replaceChildren();
    const shell = pip.document.createElement('main');
    shell.className = 'focus-timer-pip';
    if (!state.active) {
      const message = pip.document.createElement('div');
      message.className = 'focus-timer-running-card';
      message.textContent = 'Starting timer…';
      shell.appendChild(message);
      body.appendChild(shell);
      return;
    }
    shell.innerHTML = `
      <div class="focus-timer-running-card">
        <div class="focus-timer-running-top">
          <div>
            <div class="focus-timer-running-label">Time in progress</div>
            <div class="focus-timer-running-time" data-timer-elapsed>00:00:00</div>
          </div>
          <span class="focus-timer-live-mark">Live</span>
        </div>
        <div class="focus-timer-context">
          <div class="focus-timer-context-item"><div class="focus-timer-context-label">Client</div><div class="focus-timer-context-value" data-timer-client></div></div>
          <div class="focus-timer-context-item"><div class="focus-timer-context-label">Work</div><div class="focus-timer-context-value" data-timer-task></div></div>
        </div>
      </div>
      <div class="focus-timer-actions">
        <button class="focus-timer-btn focus-timer-btn-stop" type="button" data-timer-pip-stop>Stop &amp; save draft</button>
      </div>`;
    body.appendChild(shell);
    renderRunningContext(pip.document);
    updateElapsed(pip.document);
    pip.document.querySelector('[data-timer-pip-stop]').addEventListener('click', stopTimer);
  }

  async function startTimer() {
    if (state.busy) return;
    const classification = el(ids.classification).value;
    const clientId = el(ids.client).value;
    const taskType = el(ids.task).value;
    if (!taskType) return showNotice('Select the work category before starting.');
    if (classification === 'client_work' && !clientId) return showNotice('Select the client for client work.');

    setBusy(true);
    showNotice('');
    const pipPromise = requestPiPWindow();
    try {
      await pipPromise;
      const result = await apiFetch('/timer/start', {
        method: 'POST',
        body: {
          client_id: clientId || null,
          task_type: taskType,
          work_classification: classification,
          description: el(ids.description).value,
          source: sourceName()
        }
      });
      setServerTime(result.server_now);
      state.active = result.active;
      state.channel?.postMessage('changed');
      render();
      closeModal();
      if (!state.pipWindow) toast('Timer started. Use the Timer pill to stop it.', 'success');
    } catch (error) {
      await loadActive();
      if (state.active) {
        render();
        closeModal();
        toast('Your running timer was recovered.', 'info');
      } else {
        state.pipWindow?.close();
        state.pipWindow = null;
        render();
        showNotice(error.message || 'Timer could not be started.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function stopTimer() {
    if (state.busy || !state.active) return;
    setBusy(true);
    showNotice('');
    try {
      const result = await apiFetch('/timer/stop', {
        method: 'POST',
        body: { description: el(ids.runningDescription)?.value ?? state.active.description ?? '' }
      });
      state.active = null;
      state.pipWindow?.close();
      state.pipWindow = null;
      state.channel?.postMessage('changed');
      render();
      closeModal();
      if (result.warning) toast(result.warning, 'info');
      else toast('Timer stopped. Draft timesheet created.', 'success');
      window.dispatchEvent(new CustomEvent('samay:timer-stopped', { detail: result }));
      if (typeof window.loadEntries === 'function') window.loadEntries();
    } catch (error) {
      await loadActive();
      if (!state.active) {
        state.pipWindow?.close();
        state.pipWindow = null;
        render();
        closeModal();
        toast('The timer is no longer running. Check My Work for the recovered draft.', 'info');
      } else {
        showNotice(error.message || 'Timer could not be stopped. It is still running.');
        openModal();
      }
    } finally {
      setBusy(false);
    }
  }

  async function discardTimer() {
    if (state.busy || !state.active) return;
    if (!window.confirm('Discard this running timer without creating a draft?')) return;
    setBusy(true);
    try {
      await apiFetch('/timer/discard', { method: 'POST', body: {} });
      state.active = null;
      state.pipWindow?.close();
      state.pipWindow = null;
      state.channel?.postMessage('changed');
      render();
      closeModal();
      toast('Timer discarded.', 'success');
    } catch (error) {
      showNotice(error.message || 'Timer could not be discarded.');
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
    document.querySelector('[data-timer-action="start"]').addEventListener('click', startTimer);
    document.querySelector('[data-timer-action="stop"]').addEventListener('click', stopTimer);
    document.querySelector('[data-timer-action="discard"]').addEventListener('click', discardTimer);
    document.querySelector('[data-timer-action="pip"]').addEventListener('click', requestPiPWindow);
    el(ids.classification).addEventListener('change', updateClientRequirement);
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

  window.SamayFocusTimer = { init, open: openModal, refresh: loadActive };
})();
