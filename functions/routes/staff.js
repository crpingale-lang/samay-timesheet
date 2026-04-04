const express = require('express');
const router = express.Router();
const { db, admin } = require('../db');
const bcrypt = require('bcryptjs');

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const users = [];
    snapshot.forEach(doc => {
      const u = doc.data();
      delete u.password;
      users.push({ id: doc.id, ...u });
    });
    users.sort((a,b) => a.name.localeCompare(b.name));
    res.json(users);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/', async (req, res) => {
  const { name, username, password, role, designation, department, active } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const exists = await db.collection('users').where('username','==',username).limit(1).get();
    if (!exists.empty) return res.status(400).json({ error: 'Username taken' });

    const hash = await bcrypt.hash(password, 10);
    const docRef = await db.collection('users').add({
      name, username, password: hash,
      role: role || 'article',
      designation: designation || '',
      department: department || '',
      active: active !== undefined ? active : true,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ id: docRef.id });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put('/:id', async (req, res) => {
  const { name, username, password, role, designation, department, active } = req.body;
  const updates = { name, username, role, designation: designation||'', department: department||'', active: active!==undefined?active:true };
  try {
    if (password) updates.password = await bcrypt.hash(password, 10);
    await db.collection('users').doc(req.params.id).update(updates);
    res.json({ success: true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
