const { google } = require('googleapis');

// Group JID to Spreadsheet ID mapping
const SPREADSHEET_MAPPING = {
    'TP': { jid: '120363413671609227@g.us', id: '1673K8akr2mXuTEPLPPnL9X5TiA4GEVDi1hbgMLThvo4' },
    'PMS': { jid: '120363428551466980@g.us', id: '1eN2n1esCQU5kgOxQRf7zlHaETCp_d92GKHjF-ZgRAHI' }
};

// Track already sent reminders per day to avoid duplication
const sentReminders = {
    first: null,  // Format: 'YYYY-MM-DD'
    second: null  // Format: 'YYYY-MM-DD'
};

// Check if a spreadsheet has non-empty values in Column D for the tab
async function checkDataFilled(spreadsheetId, tabName) {
    try {
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const readRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${tabName}'!D1:D120`
        });

        const values = readRes.data.values || [];
        // Check if there's any non-empty, non-zero numeric value in Column D
        for (const row of values) {
            const val = String(row[0] || '').trim();
            if (val && val !== '0' && val !== '' && !isNaN(val)) {
                return true; // Found filled data
            }
        }
    } catch (err) {
        console.warn(`[SCHEDULER] Spreadsheet check fallback (treated as not filled): ${err.message}`);
        // Handle gracefully: if the tab doesn't exist, it means they haven't filled it!
        return false;
    }
    return false;
}

// Main scheduler logic running every 30 seconds
function startScheduler(getSocket) {
    console.log('[SCHEDULER] Background scheduler started successfully for operational hours (22:00 & 22:30 WIB).');

    setInterval(async () => {
        try {
            const sock = getSocket();
            if (!sock) {
                console.warn('[SCHEDULER] Socket is not ready yet. Skipping this tick.');
                return;
            }

            const now = new Date();
            const timeOptions = { timeZone: 'Asia/Jakarta', hour: 'numeric', minute: 'numeric', hour12: false };
            const dateOptions = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' };

            const timeParts = new Intl.DateTimeFormat('en-US', timeOptions).formatToParts(now);
            const hour = parseInt(timeParts.find(p => p.type === 'hour').value, 10);
            const minute = parseInt(timeParts.find(p => p.type === 'minute').value, 10);

            // Construct date string: 'YYYY-MM-DD'
            const dateParts = new Intl.DateTimeFormat('en-US', dateOptions).formatToParts(now);
            const yearStr = dateParts.find(p => p.type === 'year').value;
            const monthStr = dateParts.find(p => p.type === 'month').value;
            const dayStr = dateParts.find(p => p.type === 'day').value;
            const dateKey = `${yearStr}-${monthStr}-${dayStr}`;

            // Tab Name for today (e.g. '30 - 2026' or '29 - 2026')
            const currentDayInt = parseInt(dayStr, 10);
            const tabName = `${currentDayInt} - ${yearStr}`;

            // 1. Soft Reminder: 22:00 WIB (Triggers if not filled between 21:30 - 21:59)
            if (hour === 22 && minute === 0) {
                if (sentReminders.first !== dateKey) {
                    sentReminders.first = dateKey;
                    console.log(`[SCHEDULER] Triggering 22:00 Soft Reminder check for date: ${dateKey}`);

                    for (const key in SPREADSHEET_MAPPING) {
                        const { jid, id } = SPREADSHEET_MAPPING[key];
                        const isFilled = await checkDataFilled(id, tabName);

                        if (!isFilled) {
                            const reminderText = `
⏰ *REMINDER: PENGISIAN DATA HARIAN*

Halo rekan-rekan! Mohon kerja samanya untuk mengisi data *Produksi* dan *Waste* hari ini yaa.

📝 *Format Input:*

*/produksi*
[tanggal]
[nama bahan] [kuantitas]
...

*/waste*
[tanggal]
[nama bahan] [kuantitas]
...

*Contoh:*
/produksi
${currentDayInt}.${parseInt(monthStr, 10)}.26
bt lokal 250
gt 100

----------------------------------------
_Sistem Otomasi WhatsApp Bot Cloud_ 🚀
                            `.trim();

                            await sock.sendMessage(jid, { text: reminderText });
                            console.log(`[SCHEDULER] Sent 22:00 soft reminder to ${key} (${jid})`);
                        } else {
                            console.log(`[SCHEDULER] Group ${key} already filled data before 22:00. Skipping soft reminder.`);
                        }
                    }
                }
            }

            // 2. Hard Reminder: 22:30 WIB (Triggers if still not filled after 22:00)
            if (hour === 22 && minute === 30) {
                if (sentReminders.second !== dateKey) {
                    sentReminders.second = dateKey;
                    console.log(`[SCHEDULER] Triggering 22:30 Hard Reminder check for date: ${dateKey}`);

                    for (const key in SPREADSHEET_MAPPING) {
                        const { jid, id } = SPREADSHEET_MAPPING[key];
                        const isFilled = await checkDataFilled(id, tabName);

                        if (!isFilled) {
                            const warningText = `
⚠️ *REMINDER KERAS: DATA BELUM DIINPUT!*

Rekan-rekan, sistem mendeteksi data *Produksi* atau *Waste* hari ini belum diisi di Spreadsheet.

Mohon segera lakukan pengisian menggunakan perintah:
- */produksi* [data]
- */waste* [data]

----------------------------------------
_Sistem Otomasi WhatsApp Bot Cloud_ 🚀
                            `.trim();

                            await sock.sendMessage(jid, { text: warningText });
                            console.log(`[SCHEDULER] Sent 22:30 hard reminder to ${key} (${jid})`);
                        } else {
                            console.log(`[SCHEDULER] Group ${key} already filled data before 22:30. Skipping hard reminder.`);
                        }
                    }
                }
            }

        } catch (err) {
            console.error('[SCHEDULER] Loop Error:', err.message);
        }
    }, 30000); // Check every 30 seconds
}

module.exports = { startScheduler };
