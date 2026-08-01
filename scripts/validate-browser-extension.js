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
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://samay-timesheet.web.app/*']);
  assert(manifest.content_scripts[0].matches.includes('https://*/*'));
  assert(manifest.content_scripts[0].matches.includes('http://*/*'));
  assert(manifest.content_scripts[0].exclude_matches.includes('https://samay-timesheet.web.app/*'));
  assert(!manifest.permissions.includes('tabs'));
  assert(!manifest.permissions.includes('cookies'));
  assert(!manifest.permissions.includes('activeTab'));
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
    'extension/icons/icon-16.png',
    'extension/icons/icon-32.png',
    'extension/icons/icon-48.png',
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

function pngSize(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `${relativePath} must be a PNG`);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function validateStoreSubmission() {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert(manifest.description.length <= 132, 'Manifest description exceeds the Web Store limit');
  assert.deepEqual(Object.keys(manifest.icons).map(Number).sort((a, b) => a - b), [16, 32, 48, 72, 96, 128]);

  const popupHtml = read('extension/popup.html');
  const privacy = read('public/extension-privacy.html');
  const support = read('public/extension-support.html');
  const listing = read('docs/CHROME_WEB_STORE_LISTING.md');
  assert(popupHtml.includes('https://samay-timesheet.web.app/extension-privacy.html'));
  assert(privacy.includes('does not read, collect, or transmit the content or URL'));
  assert(privacy.includes('Limited Use requirements'));
  assert(support.includes('Samay Focus Timer'));
  assert(listing.includes('Personally identifiable information'));
  assert(listing.includes('Authentication information'));

  for (const name of ['01-collapsed-timer.png', '02-start-timer.png', '03-running-timer.png']) {
    assert.deepEqual(pngSize(`store-assets/chrome-web-store/${name}`), [1280, 800], `${name} must be 1280x800`);
  }
  assert.deepEqual(
    pngSize('store-assets/chrome-web-store/promo-small-440x280.png'),
    [440, 280]
  );
  assert.deepEqual(
    pngSize('store-assets/chrome-web-store/promo-marquee-1400x560.png'),
    [1400, 560]
  );
}

validateManifest();
validateScripts();
validateAssetsAndMarkup();
validateStoreSubmission();
console.log('Browser extension validation passed.');
