const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const root = path.resolve(__dirname, '..');
const currentSecret = 'current-test-secret-'.repeat(4);
const previousSecret = 'previous-test-secret-'.repeat(4);
const validUntilMs = Date.now() + (60 * 60 * 1000);

process.env.JWT_SECRET = currentSecret;
process.env.JWT_SECRET_PREVIOUS = JSON.stringify({ secret: previousSecret, validUntil: new Date(validUntilMs).toISOString() });
delete process.env.K_SERVICE;

const {
  previousJwtSecretIsActive,
  signJwtToken,
  verifyJwtToken
} = require('../functions/lib/session-jwt');

const currentToken = signJwtToken({ id: 'current-user' }, { expiresIn: '1h' });
const previousToken = jwt.sign({ id: 'previous-user' }, previousSecret, { expiresIn: '1h' });

assert.strictEqual(verifyJwtToken(currentToken).id, 'current-user');
assert.strictEqual(verifyJwtToken(previousToken).id, 'previous-user');
assert.strictEqual(previousJwtSecretIsActive(), true);
assert.throws(() => jwt.verify(currentToken, previousSecret));

const originalDateNow = Date.now;
try {
  Date.now = () => validUntilMs + 1;
  assert.strictEqual(previousJwtSecretIsActive(), false);
  assert.throws(() => verifyJwtToken(previousToken));
} finally {
  Date.now = originalDateNow;
}

const configSource = fs.readFileSync(path.join(root, 'functions', 'config.js'), 'utf8');
assert(!/process\.env\.JWT_SECRET\s*\|\|\s*['"][^'"]+/.test(configSource), 'a JWT fallback literal remains in source');
assert(configSource.includes('JWT_SECRET_PREVIOUS must be a valid JSON rotation envelope'));

const indexSource = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
assert(indexSource.includes("secrets: ['JWT_SECRET', 'JWT_SECRET_PREVIOUS']"));

for (const relative of ['functions/app.js', 'functions/routes/auth.js', 'functions/routes/reports.js']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  assert(!source.includes('jwt.verify('), `${relative} bypasses the shared verifier`);
  assert(!source.includes("require('jsonwebtoken')"), `${relative} imports jsonwebtoken directly`);
}

console.log('Time-limited JWT rotation validation passed.');
