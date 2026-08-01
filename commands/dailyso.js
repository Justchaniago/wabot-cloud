const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || undefined
});

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Group JID to Daily SO Spreadsheet ID mapping
const SPREADSHEET_MAPPING = {
    '120363413671609227@g.us': { name: 'TP', id: '1zWJddVVEEMULyjWcCAJojaNZKJHmKIlE4kXphK0tJ9g' }, // TP
    '120363428551466980@g.us': { name: 'PMS', id: '1iERB0D5LlVG0m4dV3ZhZofjFrp5DwSiOwtOQCNcyfCU' } // PMS
};

// Model candidates
const CANDIDATE_MODELS = [
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-2.0-flash'
];

// Convert 1-based column index to A, B, C... Z, AA, AB...
function colIndexToLetter(col) {
    let temp = '';
    let letter = '';
    while (col > 0) {
        temp = (col - 1) % 26;
        letter = String.fromCharCode(65 + temp) + letter;
        col = (col - temp - 1) / 26;
    }
    return letter;
}

// Helper to look up user nickname from Firestore
async function getUserNickname(userId) {
    try {
        const doc = await db.collection('users').doc(userId.replace(/[/:\s]/g, '_')).get();
        if (doc.exists) {
            return doc.data().nickname;
        }
    } catch (err) {
        console.error('[DAILYSO] Nickname fetch error:', err.message);
    }
    return null;
}

module.exports = {
    name: 'dailyso',
    description: 'Input data Daily Stock Opname (SO) ke spreadsheet berdasarkan grup cabang harian',
    execute: async (sock, message, args) => {
        const jid = message.key.remoteJid;
        const senderJid = message.key.participantAlt || message.key.participant || message.key.remoteJid;

        // 1. Validate Group Chat and Get Mapping
        const config = SPREADSHEET_MAPPING[jid];
        if (!config) {
            const helpError = `
⚠️ *Akses Ditolak!*
Command \`/dailyso\` hanya dapat dijalankan di dalam grup resmi cabang TP atau PMS:
- *Grup TP:* JID \`120363413671609227@g.us\`
- *Grup PMS:* JID \`120363428551466980@g.us\`
            `.trim();
            return await sock.sendMessage(jid, { text: helpError });
        }

        // Get sender profile name
        const senderName = await getUserNickname(senderJid) || message.pushName || 'Teman';

        // 2. Extract input text
        const fullBody = message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            '';

        const lines = fullBody.split('\n');
        lines.shift(); // Remove /dailyso
        const inputText = lines.join('\n').trim();

        if (!inputText) {
            const helpText = `
⚠️ *Format /dailyso Salah!*

*Contoh Cara Kirim:*
/dailyso
30.7.26
gong cha y16 cups 10
fresh milk diamond 5
            `.trim();
            return await sock.sendMessage(jid, { text: helpText });
        }

        if (!ai) {
            return await sock.sendMessage(jid, { text: '⚠️ GEMINI_API_KEY belum dikonfigurasi.' });
        }

        // Extract Date line
        const inputLines = inputText.split('\n').map(l => l.trim()).filter(Boolean);
        const dateRaw = inputLines.shift();

        // Parse date
        const dateParts = dateRaw.split(/[./-]/);
        if (dateParts.length < 3) {
            return await sock.sendMessage(jid, { text: '❌ Format tanggal salah. Gunakan format tanggal seperti: `30.7.26`' });
        }
        const day = parseInt(dateParts[0], 10);
        const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];

        // Day 1 is Col D (index 4) -> Formula: 3 + day
        const targetColIdx = 3 + day;
        const colLetter = colIndexToLetter(targetColIdx);

        await sock.sendMessage(jid, { text: `⏳ Menghubungkan ke Spreadsheet Daily SO *${config.name}*, Kolom *${colLetter}* (Tanggal ${day})...` });

        try {
            const auth = new google.auth.GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            const authClient = await auth.getClient();
            const sheets = google.sheets({ version: 'v4', auth: authClient });

            // Fetch spreadsheet metadata to get active tab title
            const metaRes = await sheets.spreadsheets.get({ spreadsheetId: config.id });
            const allSheets = metaRes.data.sheets || [];
            if (allSheets.length === 0) {
                return await sock.sendMessage(jid, { text: `❌ Gagal menemukan tab di spreadsheet Daily SO ${config.name}.` });
            }

            // Find matching tab or fallback to first sheet
            let targetTab = allSheets[0].properties.title;
            const formattedTabCandidate = `${day} - ${year}`;
            const matchedSheet = allSheets.find(s => s.properties.title === formattedTabCandidate);
            if (matchedSheet) {
                targetTab = matchedSheet.properties.title;
            }

            // Read Column B (Product Names) and Target Date Column (Column D + day - 1)
            const rangeToRead = `'${targetTab}'!B1:${colLetter}150`;
            const readRes = await sheets.spreadsheets.values.get({
                spreadsheetId: config.id,
                range: rangeToRead
            });

            const rows = readRes.data.values || [];
            if (rows.length === 0) {
                return await sock.sendMessage(jid, { text: `❌ Gagal membaca produk dari tab "${targetTab}".` });
            }

            const validProducts = [];

            rows.forEach((row, idx) => {
                const prodName = String(row[0] || '').trim();
                // Column B index is 0 in this range. Target date column index in row array:
                const targetColInRowIdx = targetColIdx - 2; // Since B is index 0 (Col 2), targetColIdx is 1-based index (e.g. D is 4 -> array index 2)
                const existingQty = String(row[targetColInRowIdx] || '').trim();

                if (prodName && !prodName.startsWith('---') && !prodName.includes('NAMA PRODUK') && !prodName.includes('KODE')) {
                    validProducts.push({
                        name: prodName,
                        rowIndex: idx + 1,
                        existingQty: (existingQty && existingQty !== '0' && existingQty !== '') ? existingQty : null
                    });
                }
            });

            const validProductNamesList = validProducts.map(p => p.name);

            // 5. Ask Gemini
            const prompt = `
Anda adalah AI parser tangguh untuk laporan Stock Opname (SO) harian toko minuman.
Tugas Anda:
1. Analisis data input yang diberikan oleh staff toko:
"""
${inputLines.join('\n')}
"""

2. Cocokkan nama item yang diketik staff ke daftar nama produk RESMI yang ada di spreadsheet:
${JSON.stringify(validProductNamesList, null, 2)}

Aturan Penting Pencocokan:
- Lakukan fuzzy matching pintar (singkatan/singkatan khas toko, huruf besar/kecil diabaikan).
- Jika item SAMA SEKALI tidak ada kecocokan yang logis, masukkan nilai null di bidang "matchedName".

3. Keluarkan hasil analisis dalam format JSON bersih berikut tanpa markdown backticks:
{
  "items": [
    { "typed": "nama_input_staff", "matchedName": "NAMA_RESMI_DI_SPREADSHEET", "quantity": angka_jumlah },
    { "typed": "nama_input_staff_tidak_dikenal", "matchedName": null, "quantity": angka_jumlah }
  ]
}
            `.trim();

            let aiResult = null;
            let lastAiError = null;

            for (const modelName of CANDIDATE_MODELS) {
                try {
                    const response = await ai.models.generateContent({
                        model: modelName,
                        contents: prompt,
                    });

                    const rawText = response.text || '';
                    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                    aiResult = JSON.parse(cleanJson);
                    if (aiResult && Array.isArray(aiResult.items)) break;
                } catch (err) {
                    lastAiError = err;
                }
            }

            if (!aiResult || !Array.isArray(aiResult.items)) {
                return await sock.sendMessage(jid, { text: `❌ Gagal memparsing input dengan AI: ${lastAiError ? lastAiError.message : 'JSON Parsing error'}` });
            }

            // 6. Check Conflict
            const matchedOfficialItems = aiResult.items.filter(item => item.matchedName);
            const itemsWithConflict = [];

            for (const item of matchedOfficialItems) {
                const targetProd = validProducts.find(p => p.name.toUpperCase() === item.matchedName.toUpperCase());
                if (targetProd && targetProd.existingQty) {
                    itemsWithConflict.push({
                        name: targetProd.name,
                        existing: targetProd.existingQty,
                        newVal: item.quantity
                    });
                }
            }

            // 7. Overwrite Conflict Flow
            if (itemsWithConflict.length > 0) {
                await db.collection('pending_inputs').doc(jid.replace(/[/:\s]/g, '_')).set({
                    jid,
                    type: 'dailyso',
                    tabName: targetTab,
                    colLetter,
                    dateRaw,
                    items: aiResult.items,
                    userId: senderJid,
                    userNickname: senderName,
                    config,
                    createdAt: new Date().toISOString()
                });

                let conflictText = `⚠️ *DATA DAILY SO TANGGAL ${dateRaw} SUDAH TERISI!*\n`;
                conflictText += `----------------------------------------\n`;
                conflictText += `Ada data lama tercatat di Spreadsheet SO (${config.name}):\n`;
                itemsWithConflict.forEach(c => {
                    conflictText += `- *${c.name}*: ${c.existing} ➔ *${c.newVal}*\n`;
                });

                conflictText += `\n📥 *DATA BARU YANG INGIN DIINPUT:*\n`;
                aiResult.items.forEach(item => {
                    if (item.matchedName) {
                        conflictText += `- *${item.matchedName}*: ${item.quantity}\n`;
                    } else {
                        conflictText += `- _${item.typed}_ (Tidak dikenal): ${item.quantity}\n`;
                    }
                });

                conflictText += `\n----------------------------------------\n`;
                conflictText += `Ketik */confirm ganti* untuk menimpa.\n`;
                conflictText += `Ketik */confirm batal* untuk membatalkan.\n`;
                conflictText += `_Dipicu oleh:_ *${senderName}*`;

                return await sock.sendMessage(jid, { text: conflictText });
            }

            // 8. Direct Write
            let successWrites = 0;
            const unrecognizedItems = [];
            const successReports = [];

            for (const item of aiResult.items) {
                if (!item.matchedName) {
                    unrecognizedItems.push(item);
                    continue;
                }

                const matchedProd = validProducts.find(p => p.name.toUpperCase() === item.matchedName.toUpperCase());
                if (!matchedProd) {
                    unrecognizedItems.push(item);
                    continue;
                }

                const rowNo = matchedProd.rowIndex;
                await sheets.spreadsheets.values.update({
                    spreadsheetId: config.id,
                    range: `'${targetTab}'!${colLetter}${rowNo}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: {
                        values: [[item.quantity]]
                    }
                });

                successWrites++;
                successReports.push(`• *${item.matchedName}*: \`${item.quantity}\``);
            }

            // Simple Crisp Success Template
            let replyText = `✅ *DAILY SO BERHASIL DICATAT (${config.name})*\n`;
            replyText += `📅 *Tanggal:* ${dateRaw} (Kolom: ${colLetter})\n`;
            replyText += `✍️ *Oleh:* *${senderName}*\n`;
            replyText += `----------------------------------------\n`;

            if (successWrites > 0) {
                replyText += successReports.join('\n') + `\n`;
            } else {
                replyText += `❌ *Tidak ada data Daily SO yang berhasil dicatat.*\n`;
            }

            if (unrecognizedItems.length > 0) {
                replyText += `----------------------------------------\n`;
                replyText += `⚠️ *Item tidak dikenali & tidak dicatat:*\n`;
                unrecognizedItems.forEach(item => {
                    replyText += `- _${item.typed}_ (Kuantitas: \`${item.quantity}\`)\n`;
                });
            }

            replyText += `----------------------------------------\n`;
            replyText += `_Sistem Otomasi WhatsApp Bot Cloud_ 🚀`;

            await sock.sendMessage(jid, { text: replyText });

        } catch (err) {
            console.error('[DAILYSO] Fatal Error:', err);
            await sock.sendMessage(jid, { text: `❌ Terjadi kesalahan fatal sistem: ${err.message}` });
        }
    }
};
