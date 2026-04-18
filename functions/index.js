const functions = require('firebase-functions/v1');
const { app } = require('./app');
const {
  sendDailyManagementReport,
  sendWeeklyManagementReport
} = require('./management-report-mailer');

exports.api = functions.https.onRequest(app);
exports.dailyManagementReport = functions.pubsub
  .schedule('0 20 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => sendDailyManagementReport());

exports.weeklyManagementReport = functions.pubsub
  .schedule('0 8 * * 1')
  .timeZone('Asia/Kolkata')
  .onRun(async () => sendWeeklyManagementReport());
