const fs = require('fs');
const path = require('path');
const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || undefined
});

const dataDir = path.join(__dirname, '../data');
const usersFilePath = path.join(dataDir, 'users.json');

// Ensure local data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Helper to save user profile to both Firestore & local file
async function saveUserProfile(userId, nickname) {
    const userData = {
        userId,
        nickname,
        updatedAt: new Date().toISOString()
    };

    // 1. Save to Cloud Firestore
    try {
        await db.collection('users').doc(userId.replace(/[/:\s]/g, '_')).set(userData, { merge: true });
        console.log(`[USER_STORE] Saved user ${userId} (${nickname}) to Firestore.`);
    } catch (err) {
        console.error('[USER_STORE] Firestore save error:', err.message);
    }

    // 2. Save/Sync to local data/users.json
    try {
        let users = {};
        if (fs.existsSync(usersFilePath)) {
            const raw = fs.readFileSync(usersFilePath, 'utf8');
            users = JSON.parse(raw || '{}');
        }
        users[userId] = userData;
        fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');
    } catch (err) {
        console.error('[USER_STORE] Local file save error:', err.message);
    }
}

module.exports = {
    name: 'halo',
    description: 'Gather user id & nickname member grup',
    execute: async (sock, message, args) => {
        const jid = message.key.remoteJid;
        const senderJid = message.key.participantAlt || message.key.participant || message.key.remoteJid;
        const nickname = args.join(' ').trim() || message.pushName || 'Teman';

        // Save user ID & nickname
        await saveUserProfile(senderJid, nickname);

        const replyMessage = `👋 *Halo ${nickname}!*\nID/JID user kamu berhasil direkam:\n\`${senderJid}\`\n\nData kamu sudah tersimpan di sistem bot.`;

        // Pure plain text send WITHOUT quoted message context to avoid E2EE LID lock
        await sock.sendMessage(jid, { text: replyMessage });
    }
};
