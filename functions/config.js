const JWT_SECRET = process.env.JWT_SECRET || 'ca-timesheet-secret-2024';
const SESSION_TTL = process.env.SESSION_TTL || '30d';

module.exports = {
  JWT_SECRET,
  SESSION_TTL
};
