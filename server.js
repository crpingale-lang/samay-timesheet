const { app } = require('./functions/app');


const PORT = process.env.PORT || 8080;


app.listen(PORT, () => {
  console.log(`\n✅ Samay Server running at http://localhost:${PORT}`);
  console.log('Using Firestore backend for app and API routes');
});
