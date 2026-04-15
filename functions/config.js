const JWT_SECRET = process.env.JWT_SECRET || 'ca-timesheet-secret-2024';
// Keep sessions short so users re-authenticate daily.
const SESSION_TTL = process.env.SESSION_TTL || '1d';

module.exports = {
  JWT_SECRET,
  SESSION_TTL
};
