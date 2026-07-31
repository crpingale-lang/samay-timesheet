const loadingView = document.getElementById('loading-view');
const loginView = document.getElementById('login-view');
const accountView = document.getElementById('account-view');
const loginForm = document.getElementById('login-form');
const loginButton = document.getElementById('login-button');
const loginError = document.getElementById('login-error');
const accountError = document.getElementById('account-error');

function messageExtension(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'Samay request failed.'));
      resolve(response.state);
    });
  });
}

function initials(name) {
  return String(name || 'S')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'S';
}

function showError(node, message = '') {
  node.textContent = message;
  node.hidden = !message;
}

function render(state) {
  loadingView.hidden = true;
  loginView.hidden = Boolean(state?.authenticated);
  accountView.hidden = !state?.authenticated;
  showError(loginError);
  showError(accountError);
  if (!state?.authenticated) {
    queueMicrotask(() => document.getElementById('identifier').focus());
    return;
  }

  const user = state.user || {};
  document.getElementById('user-name').textContent = user.name || user.username || 'Samay user';
  document.getElementById('user-role').textContent = user.role || 'Signed in';
  document.getElementById('user-initials').textContent = initials(user.name || user.username);

  const status = document.getElementById('timer-status');
  const title = document.getElementById('status-title');
  const detail = document.getElementById('status-detail');
  status.className = 'timer-status';
  if (state.active) {
    status.classList.add(state.active.status === 'paused' ? 'paused' : 'active');
    title.textContent = state.active.status === 'paused' ? 'Timer paused' : 'Timer is running';
    detail.textContent = state.active.client_name || 'Internal work';
  } else {
    title.textContent = 'Ready to record';
    detail.textContent = 'No timer running';
  }
}

async function setButtonBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
    delete button.dataset.label;
  }
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  showError(loginError);
  const identifier = document.getElementById('identifier').value.trim();
  const passwordInput = document.getElementById('password');
  await setButtonBusy(loginButton, true, 'Signing in…');
  try {
    const state = await messageExtension({ type: 'SAMAY_LOGIN', identifier, password: passwordInput.value });
    passwordInput.value = '';
    render(state);
  } catch (error) {
    passwordInput.value = '';
    showError(loginError, error.message);
    passwordInput.focus();
  } finally {
    await setButtonBusy(loginButton, false);
  }
});

document.getElementById('show-overlay').addEventListener('click', async event => {
  const button = event.currentTarget;
  showError(accountError);
  await setButtonBusy(button, true, 'Showing timer…');
  try {
    await messageExtension({ type: 'SAMAY_SHOW_ON_ACTIVE_TAB' });
    window.close();
  } catch (error) {
    showError(accountError, error.message);
  } finally {
    await setButtonBusy(button, false);
  }
});

document.getElementById('open-samay').addEventListener('click', async () => {
  try {
    await messageExtension({ type: 'SAMAY_OPEN_APP', path: '/dashboard.html' });
    window.close();
  } catch (error) {
    showError(accountError, error.message);
  }
});

document.getElementById('sign-out').addEventListener('click', async () => {
  showError(accountError);
  try {
    render(await messageExtension({ type: 'SAMAY_LOGOUT' }));
  } catch (error) {
    showError(accountError, error.message);
  }
});

messageExtension({ type: 'SAMAY_GET_STATE' })
  .then(render)
  .catch(error => {
    loadingView.hidden = true;
    loginView.hidden = false;
    showError(loginError, error.message);
  });
