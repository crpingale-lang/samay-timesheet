const crypto = require('crypto');

function resolveJwtSecret() {
  const configured = String(process.env.JWT_SECRET || '').trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production' || process.env.K_SERVICE) {
    throw new Error('JWT_SECRET must be configured in the production environment');
  }
  return crypto.randomBytes(48).toString('hex');
}

const JWT_SECRET = resolveJwtSecret();
const SESSION_TTL = process.env.SESSION_TTL || '30d';

module.exports = {
  JWT_SECRET,
  SESSION_TTL
};
