const { initAuthCreds, BufferJSON, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');

/**
 * Production-grade, per-key durable Firestore SignalKeyStore.
 * Directly persists state.keys.set() modifications (session, sender-key, pre-key, etc.)
 * atomically to Firestore subcollections, combined with Baileys' native makeCacheableSignalKeyStore.
 */
async function useFirestoreAuthState(db, collectionName = 'whatsapp_sessions', sessionId = 'default_session', logger) {
    const docRef = db.collection(collectionName).doc(sessionId);
    const keysRef = docRef.collection('keys');

    // 1. Load initial credentials from Firestore
    const docSnap = await docRef.get();
    let creds;

    if (docSnap.exists && docSnap.data().creds) {
        creds = JSON.parse(JSON.stringify(docSnap.data().creds), BufferJSON.reviver);
    } else {
        creds = initAuthCreds();
    }

    // Helper to sanitize key document IDs
    const sanitizeKey = (type, id) => `${type}_${id}`.replace(/[/]/g, '__slash__').replace(/[\s#?]/g, '_');

    const keyStore = {
        get: async (type, ids) => {
            const data = {};
            await Promise.all(
                ids.map(async (id) => {
                    try {
                        const docId = sanitizeKey(type, id);
                        const keyDoc = await keysRef.doc(docId).get();
                        if (keyDoc.exists) {
                            let val = keyDoc.data().value;
                            if (val) {
                                val = JSON.parse(JSON.stringify(val), BufferJSON.reviver);
                            }
                            data[id] = val;
                        }
                    } catch (err) {
                        console.error(`[FIRESTORE_KEYSTORE] Error reading key ${type}-${id}:`, err.message);
                    }
                })
            );
            return data;
        },
        set: async (data) => {
            let batch = db.batch();
            let count = 0;

            for (const category in data) {
                for (const id in data[category]) {
                    try {
                        const value = data[category][id];
                        const docId = sanitizeKey(category, id);
                        const keyDocRef = keysRef.doc(docId);

                        if (value) {
                            const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
                            batch.set(keyDocRef, {
                                value: serialized,
                                category,
                                id,
                                updatedAt: new Date().toISOString()
                            });
                        } else {
                            batch.delete(keyDocRef);
                        }
                        count++;

                        if (count >= 400) {
                            await batch.commit();
                            batch = db.batch();
                            count = 0;
                        }
                    } catch (err) {
                        console.error(`[FIRESTORE_KEYSTORE] Error writing key ${category}-${id}:`, err.message);
                    }
                }
            }

            if (count > 0) {
                try {
                    await batch.commit();
                } catch (err) {
                    console.error('[FIRESTORE_KEYSTORE] Batch commit error:', err.message);
                }
            }
        }
    };

    return {
        state: {
            creds,
            keys: makeCacheableSignalKeyStore(keyStore, logger)
        },
        saveCreds: async () => {
            const serializedCreds = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
            await docRef.set({ creds: serializedCreds, updatedAt: new Date().toISOString() }, { merge: true });
        }
    };
}

module.exports = { useFirestoreAuthState };
