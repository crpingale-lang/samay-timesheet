const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getDefaultPermissions } = require('../js/permissions');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const htmlFiles = fs.readdirSync(publicDir).filter(file => file.endsWith('.html'));
const appSource = fs.readFileSync(path.join(publicDir, 'js', 'app.js'), 'utf8');
const failures = [];

function check(label, test) {
  try {
    test();
    process.stdout.write(`✓ ${label}\n`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    process.stderr.write(`✗ ${label}: ${error.message}\n`);
  }
}

check('shared application script parses', () => new vm.Script(appSource, { filename: 'public/js/app.js' }));

check('all HTML inline scripts parse beside the shared app', () => {
  for (const file of htmlFiles) {
    const source = fs.readFileSync(path.join(publicDir, file), 'utf8');
    const inlineScripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map(match => match[1])
      .filter(Boolean);
    for (const [index, inline] of inlineScripts.entries()) {
      const combined = source.includes('/js/app.js') ? `${appSource}\n${inline}` : inline;
      new vm.Script(combined, { filename: `${file}:inline-${index + 1}` });
    }
  }
});

check('every product screen loads the revamp stylesheet', () => {
  const excluded = new Set(['udin-coming-soon.html']);
  const missing = htmlFiles.filter(file => !excluded.has(file))
    .filter(file => !fs.readFileSync(path.join(publicDir, file), 'utf8').includes('/css/revamp.css'));
  assert.deepStrictEqual(missing, []);
});

check('workspace chooser exposes three direct workspace actions', () => {
  const source = fs.readFileSync(path.join(publicDir, 'module-select.html'), 'utf8');
  assert.strictEqual((source.match(/data-module=/g) || []).length, 3);
  assert(!source.includes('continue-module-btn'), 'legacy dropdown/continue flow remains');
});

check('top bars no longer duplicate workspace switching', () => {
  const offenders = htmlFiles.filter(file => {
    const source = fs.readFileSync(path.join(publicDir, file), 'utf8');
    return /topbar-actions[\s\S]{0,500}href="\/module-select\.html"/.test(source);
  });
  assert.deepStrictEqual(offenders, []);
});

check('shared navigation uses one factory and four thin context wrappers', () => {
  assert(appSource.includes('function createSidebarHTML'));
  assert.strictEqual((appSource.match(/function (?:TIMESHEET_|FORM15CB_|FIRM_)?SIDEBAR_HTML/g) || []).length, 4);
  assert(!appSource.includes('injectModuleSwitcher()'));
});

check('partner and manager receive full UDIN workflow permissions', () => {
  for (const role of ['partner', 'manager']) {
    const permissions = getDefaultPermissions(role);
    for (const permission of ['udin.view_own', 'udin.create', 'udin.update', 'udin.review', 'udin.revoke', 'udin.dashboard.view']) {
      assert(permissions.includes(permission), `${role} missing ${permission}`);
    }
  }
});

check('article UDIN access stays limited to view/create/dashboard', () => {
  const permissions = getDefaultPermissions('article');
  assert(permissions.includes('udin.view_own'));
  assert(permissions.includes('udin.create'));
  assert(permissions.includes('udin.dashboard.view'));
  for (const denied of ['udin.update', 'udin.review', 'udin.revoke']) {
    assert(!permissions.includes(denied), `article unexpectedly receives ${denied}`);
  }
});

check('SQLite and Firebase UDIN route guards remain represented', () => {
  for (const relative of ['routes/udin.js', 'functions/routes/udin.js']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const permission of ['udin.view_own', 'udin.create', 'udin.update', 'udin.review', 'udin.revoke']) {
      assert(source.includes(permission), `${relative} missing ${permission}`);
    }
  }
});

check('dialogs use the shared responsive spacing contract', () => {
  const css = fs.readFileSync(path.join(publicDir, 'css', 'revamp.css'), 'utf8');
  for (const token of ['--dialog-edge-gap', '--dialog-gutter', '.modal>form', '.modal>.modal-actions']) {
    assert(css.includes(token), `dialog spacing contract missing ${token}`);
  }
});
if (failures.length) {
  process.stderr.write(`\n${failures.length} validation check(s) failed.\n`);
  process.exit(1);
}
process.stdout.write(`\nRevamp validation passed for ${htmlFiles.length} HTML screens.\n`);