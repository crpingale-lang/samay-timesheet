const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

function validateManifest() {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'alarms', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://samay-timesheet.web.app/*']);
  assert(manifest.content_scripts[0].matches.includes('https://*/*'));
  assert(manifest.content_scripts[0].matches.includes('http://*/*'));
  assert(manifest.content_scripts[0].exclude_matches.includes('https://samay-timesheet.web.app/*'));
  assert(!manifest.permissions.includes('tabs'));
  assert(!manifest.permissions.includes('cookies'));
  assert(!manifest.permissions.includes('scripting'));
}

function validateScripts() {
  const background = read('extension/background.js');
  const content = read('extension/content.js');
  const popup = read('extension/popup.js');
  const timerCore = read('functions/lib/focus-timer-core.js');

  new vm.Script(background, { filename: 'background.js' });
  new vm.Script(content, { filename: 'content.js' });
  new vm.Script(popup, { filename: 'popup.js' });

  assert(background.includes("chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })"));
  assert(background.includes("source: 'browser_extension'"));
  assert(background.includes("cache: 'no-store'"));
  assert(background.includes('AbortController'));
  assert(!background.includes('console.log'));
  assert(!background.includes('chrome.storage.local'));
  assert(!content.includes('authToken'));
  assert(!content.includes('Authorization'));
  assert(content.includes("attachShadow({ mode: 'closed' })"));
  assert(content.includes('Internal / no client'));
  assert(content.includes('What are you working on?'));
  assert(content.includes("await runAction('SAMAY_PAUSE')"));
  assert(content.includes("await runAction('SAMAY_RESUME')"));
  assert(content.includes("await runAction('SAMAY_STOP', 'saved')"));
  assert(content.includes('prefers-reduced-motion'));
  assert(popup.includes("type: 'SAMAY_LOGIN'"));
  assert(popup.includes("passwordInput.value = ''"));
  assert(timerCore.includes("'browser_extension'"));
}

function validateAssetsAndMarkup() {
  const popupHtml = read('extension/popup.html');
  for (const file of [
    'extension/icons/icon-72.png',
    'extension/icons/icon-96.png',
    'extension/icons/icon-128.png',
    'extension/popup.css'
  ]) {
    assert(fs.existsSync(path.join(root, file)), `${file} must exist`);
  }
  assert(popupHtml.includes('autocomplete="username"'));
  assert(popupHtml.includes('autocomplete="current-password"'));
  assert(!popupHtml.match(/<script[^>]*>\s*[^<]/));
  assert(!popupHtml.match(/\son[a-z]+=/i));
}

validateManifest();
validateScripts();
validateAssetsAndMarkup();
console.log('Browser extension validation passed.');
