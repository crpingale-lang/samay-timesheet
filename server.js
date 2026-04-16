function parseBooleanEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'firestore'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'sqlite', 'local'].includes(normalized)) return false;
  return null;
}

const explicitBackendSetting = parseBooleanEnv(process.env.USE_FIREBASE_BACKEND);
const isCloudRun = !!process.env.K_SERVICE;
const useFirestoreBackend = explicitBackendSetting === true || (explicitBackendSetting === null && isCloudRun);
const backendName = useFirestoreBackend ? 'Firestore' : 'SQLite local';
const { app } = useFirestoreBackend
  ? require('./functions/app')
  : require('./local-app');

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`\nOK Samay Server running at http://localhost:${PORT}`);
  console.log(`Using ${backendName} backend for app and API routes`);
  console.log(`USE_FIREBASE_BACKEND=${process.env.USE_FIREBASE_BACKEND || ''}`);
  console.log(`K_SERVICE=${process.env.K_SERVICE || ''}`);
});
