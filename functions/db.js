const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

// Helper to seed default admin if none exists
async function seedDefaultAdmin() {
  const usersRef = db.collection('users');
  const snapshot = await usersRef.where('role', 'in', ['partner', 'admin']).limit(1).get();
  if (snapshot.empty) {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('admin123', 10);
    await usersRef.add({
      name: 'Default Partner',
      username: 'partner',
      password: hash,
      role: 'partner',
      designation: 'Managing Partner',
      active: true,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ Default partner created: partner / admin123');
  }
}

module.exports = { db, admin, seedDefaultAdmin };
