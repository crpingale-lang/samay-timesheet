const functions = require('firebase-functions/v1');
const { onRequest } = require('firebase-functions/v2/https');

let apiApp = null;

function getApiApp() {
  if (!apiApp) apiApp = require('./app').app;
  return apiApp;
}

function getManagementReportMailer() {
  return require('./management-report-mailer');
}

function getDailyDraftSubmitter() {
  return require('./daily-draft-submitter');
}

exports.api = onRequest(
  { secrets: ['JWT_SECRET', 'JWT_SECRET_PREVIOUS'] },
  (req, res) => getApiApp()(req, res)
);
exports.dailyManagementReport = functions.pubsub
  .schedule('5 20 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => getManagementReportMailer().sendDailyManagementReport());

exports.dailyDraftAutoSubmit = functions.pubsub
  .schedule('0 20 * * *')
  .timeZone('Asia/Kolkata')
  .retryConfig({
    retryCount: 3,
    minBackoffDuration: '60s',
    maxBackoffDuration: '300s'
  })
  .onRun(async () => getDailyDraftSubmitter().runDailyDraftAutoSubmit());


exports.weeklyManagementReport = functions.pubsub
  .schedule('0 8 * * 1')
  .timeZone('Asia/Kolkata')
  .onRun(async () => getManagementReportMailer().sendWeeklyManagementReport());
