const crypto = require('crypto');

function resolveJwtSecret() {
  const configured = String(process.env.JWT_SECRET || '').trim();
  if (configured) return configured;
  if (process.env.K_SERVICE) {
    throw new Error('JWT_SECRET must be bound from Firebase Secret Manager');
  }
  return crypto.randomBytes(48).toString('hex');
}

const JWT_SECRET = resolveJwtSecret();
// Keep sessions short so users re-authenticate daily.
const SESSION_TTL = process.env.SESSION_TTL || '1d';

module.exports = {
  JWT_SECRET,
  SESSION_TTL
};
