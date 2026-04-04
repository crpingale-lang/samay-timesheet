const express = require('express');
const router = express.Router();
const { db, seedDefaultAdmin } = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'ca-timesheet-secret-2024';

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    await seedDefaultAdmin(); // Safely ensure default partner exists or bypasses if already seeded

    const snapshot = await db.collection('users').where('username', '==', username).limit(1).get();
    if (snapshot.empty) return res.status(401).json({ error: 'Invalid credentials' });
    
    const userDoc = snapshot.docs[0];
    const user = userDoc.data();
    
    if (!user.active) return res.status(403).json({ error: 'Account disabled' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: userDoc.id, username: user.username, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '12h' });
    
    res.json({
      token,
      user: { id: userDoc.id, username: user.username, name: user.name, role: user.role, designation: user.designation }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/change-password', async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { old_password, new_password } = req.body;
    
    const userRef = db.collection('users').doc(decoded.id);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    const user = userDoc.data();

    const valid = await bcrypt.compare(old_password, user.password);
    if (!valid) return res.status(400).json({ error: 'Incorrect old password' });

    const newHash = await bcrypt.hash(new_password, 10);
    await userRef.update({ password: newHash });
    
    res.json({ success: true });
  } catch (e) {
    res.status(401).json({ error: 'Invalid request' });
  }
});

module.exports = router;
