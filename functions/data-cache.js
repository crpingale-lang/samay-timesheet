const { db } = require('./db');

const cacheStore = new Map();

async function remember(key, ttlMs, loader) {
  const now = Date.now();
  const cached = cacheStore.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const pendingKey = `${key}:pending`;
  const pending = cacheStore.get(pendingKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await loader();
      cacheStore.set(key, { value, expiresAt: now + ttlMs });
      return value;
    } finally {
      cacheStore.delete(pendingKey);
    }
  })();

  cacheStore.set(pendingKey, promise);
  return promise;
}

function invalidateCache(...keys) {
  for (const key of keys) {
    cacheStore.delete(key);
    cacheStore.delete(`${key}:pending`);
  }
}

function invalidateCacheByPrefix(prefix) {
  for (const key of [...cacheStore.keys()]) {
    if (key === prefix || key.startsWith(prefix)) {
      cacheStore.delete(key);
    }
  }
}

async function getUsersMap() {
  return remember('users:all', 30000, async () => {
    const snapshot = await db.collection('users').get();
    const users = new Map();
    snapshot.forEach(doc => {
      users.set(doc.id, doc.data());
    });
    return users;
  });
}

async function getClientsMap() {
  return remember('clients:all', 30000, async () => {
    const snapshot = await db.collection('clients').get();
    const clients = new Map();
    snapshot.forEach(doc => {
      clients.set(doc.id, doc.data());
    });
    return clients;
  });
}

async function getMasterDataItems() {
  return remember('master-data:all', 300000, async () => {
    const snapshot = await db.collection('master_data').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  });
}

async function getLocationMasterItems() {
  return remember('location-master:all', 300000, async () => {
    const snapshot = await db.collection('location_master').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  });
}

module.exports = {
  remember,
  getUsersMap,
  getClientsMap,
  getMasterDataItems,
  getLocationMasterItems,
  invalidateCache,
  invalidateCacheByPrefix
};
