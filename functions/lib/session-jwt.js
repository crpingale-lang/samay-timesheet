const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_SECRET_PREVIOUS } = require('../config');

function previousJwtSecretIsActive(now = Date.now()) {
  return Boolean(JWT_SECRET_PREVIOUS && now <= JWT_SECRET_PREVIOUS.validUntilMs);
}

function signJwtToken(payload, options) {
  return jwt.sign(payload, JWT_SECRET, options);
}

function verifyJwtToken(token, options) {
  try {
    return jwt.verify(token, JWT_SECRET, options);
  } catch (primaryError) {
    if (!previousJwtSecretIsActive()) throw primaryError;
    try {
      return jwt.verify(token, JWT_SECRET_PREVIOUS.secret, options);
    } catch {
      throw primaryError;
    }
  }
}

module.exports = {
  previousJwtSecretIsActive,
  signJwtToken,
  verifyJwtToken
};
