const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function normalizeSecret(value) {
  return String(value || '').replace(/[^A-Z2-7]/gi, '').toUpperCase();
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(secret) {
  const normalized = normalizeSecret(secret);
  let bits = 0;
  let value = 0;
  const output = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function generateSecret(length = 20) {
  return base32Encode(crypto.randomBytes(length));
}

function generateOtpAuthUri({ issuer = 'Samay', accountName, secret, digits = 6, period = 30, algorithm = 'SHA1' }) {
  const normalizedSecret = normalizeSecret(secret);
  const label = issuer ? `${issuer}:${accountName}` : accountName;
  const params = new URLSearchParams({
    secret: normalizedSecret,
    digits: String(digits),
    period: String(period),
    algorithm: String(algorithm || 'SHA1').toUpperCase()
  });
  if (issuer) params.set('issuer', issuer);
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function generateTotp(secret, { time = Date.now(), step = 30, digits = 6 } = {}) {
  const normalizedSecret = normalizeSecret(secret);
  const counter = Math.floor(Math.floor(time / 1000) / step);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(normalizedSecret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const modulus = 10 ** digits;
  return String(binary % modulus).padStart(digits, '0');
}

function verifyTotp(secret, code, { time = Date.now(), step = 30, digits = 6, window = 1 } = {}) {
  const normalizedCode = String(code || '').trim().replace(/\D/g, '');
  if (!normalizedCode) return { matched: false, counter: null };

  const currentCounter = Math.floor(Math.floor(time / 1000) / step);
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = currentCounter + offset;
    if (counter < 0) continue;
    const candidate = generateTotp(secret, {
      time: counter * step * 1000,
      step,
      digits
    });
    if (candidate === normalizedCode) {
      return { matched: true, counter };
    }
  }

  return { matched: false, counter: null };
}

module.exports = {
  generateSecret,
  generateOtpAuthUri,
  generateTotp,
  normalizeSecret,
  verifyTotp
};
