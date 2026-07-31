const crypto = require('crypto');

function resolveJwtSecret() {
  const configured = String(process.env.JWT_SECRET || '').trim();
  if (configured) return configured;
  if (process.env.K_SERVICE) {
    throw new Error('JWT_SECRET must be bound from Firebase Secret Manager');
  }
  return crypto.randomBytes(48).toString('hex');
}

function resolvePreviousJwtSecret() {
  const raw = String(process.env.JWT_SECRET_PREVIOUS || '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JWT_SECRET_PREVIOUS must be a valid JSON rotation envelope');
  }

  const secret = String(parsed?.secret || '').trim();
  const validUntil = String(parsed?.validUntil || '').trim();
  const validUntilMs = Date.parse(validUntil);
  if (!secret || !Number.isFinite(validUntilMs)) {
    throw new Error('JWT_SECRET_PREVIOUS requires secret and validUntil values');
  }

  return Object.freeze({ secret, validUntil, validUntilMs });
}

const JWT_SECRET = resolveJwtSecret();
const JWT_SECRET_PREVIOUS = resolvePreviousJwtSecret();
// Keep sessions short so users re-authenticate daily.
const SESSION_TTL = process.env.SESSION_TTL || '1d';

module.exports = {
  JWT_SECRET,
  JWT_SECRET_PREVIOUS,
  SESSION_TTL
};
