const { db } = require('./db');
const { submitDailyDrafts } = require('./lib/daily-draft-auto-submit');

async function runDailyDraftAutoSubmit(options = {}) {
  return submitDailyDrafts({ db, ...options });
}

module.exports = { runDailyDraftAutoSubmit };
