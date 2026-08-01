const { google } = require('googleapis');

// Spreadsheet IDs
const SPREADSHEETS = {
    TP: '1673K8akr2mXuTEPLPPnL9X5TiA4GEVDi1hbgMLThvo4',
    PMS: '1eN2n1esCQU5kgOxQRf7zlHaETCp_d92GKHjF-ZgRAHI'
};

module.exports = {
    name: 'testsheet',
    description: 'Menguji koneksi baca & tulis Google Sheets API ke kedua spreadsheet di sel A78',
    execute: async (sock, message, args) => {
        const jid = message.key.remoteJid;

        await sock.sendMessage(jid, { text: '⏳ Menginisialisasi Google Sheets API & menulis ke sel A78...' });

        try {
            // 1. Authenticate with Google Application Default Credentials (ADC)
            const auth = new google.auth.GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            const authClient = await auth.getClient();
            const sheets = google.sheets({ version: 'v4', auth: authClient });

            let outputReport = '📊 *HASIL UJI KONEKSI GOOGLE SHEETS API (SEL A78):*\n\n';

            // 2. Test for both TP and PMS spreadsheets
            for (const [key, spreadsheetId] of Object.entries(SPREADSHEETS)) {
                outputReport += `🔹 *Spreadsheet ${key}:*\n`;
                try {
                    // Get spreadsheet metadata to find the first sheet name dynamically
                    const meta = await sheets.spreadsheets.get({ spreadsheetId });
                    const firstSheetTitle = meta.data.sheets?.[0]?.properties?.title || 'Sheet1';
                    outputReport += `   - Nama Tab Utama: \`${firstSheetTitle}\`\n`;

                    // Generate test row values
                    const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
                    const values = [[timestamp, 'Koneksi Sukses A78', 'Dites oleh WA Bot via Cloud Run']];

                    // Update exact cell A78:C78
                    const updateRes = await sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `'${firstSheetTitle}'!A78:C78`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values }
                    });

                    outputReport += `   - Status Tulis: ✅ *Sukses Menulis ke Sel A78!*\n`;
                    outputReport += `   - Range Terupdate: \`${updateRes.data.updatedRange}\`\n\n`;

                } catch (sheetErr) {
                    console.error(`Error testing sheets for ${key}:`, sheetErr);
                    outputReport += `   - Status: ❌ *Gagal!* (Penyebab: ${sheetErr.message})\n`;
                    outputReport += `   - _Catatan: Pastikan kamu sudah membagikan akses Editor ke email service account: \`22953182550-compute@developer.gserviceaccount.com\`_\n\n`;
                }
            }

            await sock.sendMessage(jid, { text: outputReport });

        } catch (err) {
            console.error('[TEST_SHEETS] Fatal Connection Error:', err);
            await sock.sendMessage(jid, { text: `❌ Gagal menginisialisasi autentikasi Google Sheets: ${err.message}` });
        }
    }
};
