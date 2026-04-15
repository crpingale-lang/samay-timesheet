const useFirestoreBackend = ['1', 'true', 'yes'].includes(
  String(process.env.USE_FIREBASE_BACKEND || '').trim().toLowerCase()
);
const backendName = useFirestoreBackend ? 'Firestore' : 'SQLite local';
const { app } = useFirestoreBackend
  ? require('./functions/app')
  : require('./local-app');

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`\nOK Samay Server running at http://localhost:${PORT}`);
  console.log(`Using ${backendName} backend for app and API routes`);
});
