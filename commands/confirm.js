const { google } = require('googleapis');
const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || undefined
});

// Helper to look up user nickname
async function getUserNickname(userId) {
    try {
        const doc = await db.collection('users').doc(userId.replace(/[/:\s]/g, '_')).get();
        if (doc.exists) {
            return doc.data().nickname;
        }
    } catch (err) {
        console.error('[CONFIRM] Nickname fetch error:', err.message);
    }
    return null;
}

module.exports = {
    name: 'confirm',
    description: 'Mengonfirmasi penulisan data produksi, waste, atau dailyso yang tertunda',
    execute: async (sock, message, args) => {
        const jid = message.key.remoteJid;
        const senderJid = message.key.participantAlt || message.key.participant || message.key.remoteJid;

        const subCommand = (args[0] || '').toLowerCase().trim();
        if (subCommand !== 'ganti' && subCommand !== 'batal') {
            return await sock.sendMessage(jid, {
                text: '⚠️ *Perintah Salah!*\nGunakan perintah:\n- `/confirm ganti` (untuk menimpa data)\n- `/confirm batal` (untuk membatalkan)'
            });
        }

        const senderName = await getUserNickname(senderJid) || message.pushName || 'Teman';

        // 1. Fetch pending input for this group
        const pendingRef = db.collection('pending_inputs').doc(jid.replace(/[/:\s]/g, '_'));
        const pendingDoc = await pendingRef.get();

        if (!pendingDoc.exists) {
            return await sock.sendMessage(jid, {
                text: '❌ *Tidak ada data yang sedang tertunda konfirmasi di grup ini.*'
            });
        }

        const pendingData = pendingDoc.data();

        // 2. Handle cancellation
        if (subCommand === 'batal') {
            await pendingRef.delete();
            return await sock.sendMessage(jid, {
                text: `🛑 *INPUT DATA DIBATALKAN*\n\nData baru tanggal *${pendingData.dateRaw}* dibatalkan oleh *${senderName}*.\nData lama di spreadsheet aman tidak diubah.`
            });
        }

        // 3. Handle replacement
        await sock.sendMessage(jid, { text: `⏳ Memproses penimpaan data ke Spreadsheet *${pendingData.config.name}*...` });

        try {
            const auth = new google.auth.GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            const authClient = await auth.getClient();
            const sheets = google.sheets({ version: 'v4', auth: authClient });

            // Read B1:B150
            const readRes = await sheets.spreadsheets.values.get({
                spreadsheetId: pendingData.config.id,
                range: `'${pendingData.tabName}'!B1:B150`
            });

            const colBValues = readRes.data.values || [];
            if (colBValues.length === 0) {
                return await sock.sendMessage(jid, { text: '❌ Gagal membaca spreadsheet saat proses konfirmasi.' });
            }

            const targetProducts = [];

            if (pendingData.type === 'dailyso') {
                // For dailyso: all non-header product names in Column B
                colBValues.forEach((row, idx) => {
                    const prodName = String(row[0] || '').trim();
                    if (prodName && !prodName.startsWith('---') && !prodName.includes('NAMA PRODUK') && !prodName.includes('KODE')) {
                        targetProducts.push({
                            name: prodName,
                            rowIndex: idx + 1
                        });
                    }
                });
            } else {
                // Detect section bounds for produksi / waste
                let sectionStartIdx = -1;
                let sectionEndIdx = colBValues.length;

                if (pendingData.type === 'produksi') {
                    let productionStartIdx = -1;
                    let wasteStartIdx = -1;
                    colBValues.forEach((row, idx) => {
                        const cellVal = String(row[0] || '').trim().toUpperCase();
                        if (cellVal === 'PRODUCTION') productionStartIdx = idx;
                        else if (cellVal === 'WASTE') wasteStartIdx = idx;
                    });
                    sectionStartIdx = productionStartIdx;
                    sectionEndIdx = wasteStartIdx !== -1 ? wasteStartIdx : colBValues.length;
                } else if (pendingData.type === 'waste') {
                    let wasteStartIdx = -1;
                    colBValues.forEach((row, idx) => {
                        const cellVal = String(row[0] || '').trim().toUpperCase();
                        if (cellVal === 'WASTE') wasteStartIdx = idx;
                    });
                    sectionStartIdx = wasteStartIdx;
                }

                if (sectionStartIdx === -1) {
                    return await sock.sendMessage(jid, {
                        text: `❌ Bagian "${pendingData.type.toUpperCase()}" tidak ditemukan di spreadsheet.`
                    });
                }

                for (let i = sectionStartIdx + 1; i < sectionEndIdx; i++) {
                    const prodName = String(colBValues[i]?.[0] || '').trim();
                    if (prodName && !prodName.startsWith('---') && !prodName.includes('KODE')) {
                        targetProducts.push({
                            name: prodName,
                            rowIndex: i + 1
                        });
                    }
                }
            }

            // Target Column: D for produksi/waste, or pendingData.colLetter for dailyso
            const targetCol = pendingData.type === 'dailyso' ? pendingData.colLetter : 'D';

            // Write quantities to target column
            let successWrites = 0;
            const successReports = [];

            for (const item of pendingData.items) {
                if (!item.matchedName) continue;

                const matchedProd = targetProducts.find(p => p.name.toUpperCase() === item.matchedName.toUpperCase());
                if (!matchedProd) continue;

                const rowNo = matchedProd.rowIndex;
                await sheets.spreadsheets.values.update({
                    spreadsheetId: pendingData.config.id,
                    range: `'${pendingData.tabName}'!${targetCol}${rowNo}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: {
                        values: [[item.quantity]]
                    }
                });

                successWrites++;
                successReports.push(`• *${item.matchedName}*: \`${item.quantity}\``);
            }

            // Simple Crisp Success Template
            let replyText = `✅ *SUKSES TIMPA DATA (${pendingData.config.name})*\n`;
            replyText += `📅 *Tanggal:* ${pendingData.dateRaw} (${pendingData.type.toUpperCase()})\n`;
            replyText += `✍️ *Oleh:* *${pendingData.userNickname}* (Disetujui: *${senderName}*)\n`;
            replyText += `----------------------------------------\n`;

            if (successWrites > 0) {
                replyText += successReports.join('\n') + `\n`;
            } else {
                replyText += `❌ *Tidak ada data yang berhasil diperbarui.*\n`;
            }

            replyText += `----------------------------------------\n`;
            replyText += `_Sistem Otomasi WhatsApp Bot Cloud_ 🚀`;

            // Delete pending state
            await pendingRef.delete();

            await sock.sendMessage(jid, { text: replyText });

        } catch (err) {
            console.error('[CONFIRM] Replace error:', err);
            await sock.sendMessage(jid, { text: `❌ Gagal mengonfirmasi penulisan ke spreadsheet: ${err.message}` });
        }
    }
};
