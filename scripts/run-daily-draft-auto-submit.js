const { runDailyDraftAutoSubmit } = require('../functions/daily-draft-submitter');

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

runDailyDraftAutoSubmit({
  dryRun: isEnabled(process.env.SAMAY_AUTO_SUBMIT_DRY_RUN)
}).then(result => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}).catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
