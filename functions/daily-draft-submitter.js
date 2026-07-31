const { db } = require('./db');
const { submitDailyDrafts } = require('./lib/daily-draft-auto-submit');

async function runDailyDraftAutoSubmit() {
  return submitDailyDrafts({ db });
}

module.exports = { runDailyDraftAutoSubmit };
