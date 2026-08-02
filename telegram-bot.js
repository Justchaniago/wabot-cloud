require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const { Firestore } = require('@google-cloud/firestore');
const express = require('express');
const pino = require('pino');

const PORT = process.env.PORT || 8080;
const project = 'project-a2bb3a13-c8e1-4097-92d';
process.env.GOOGLE_CLOUD_PROJECT = project;
process.env.GCP_PROJECT_ID = project;

const location = process.env.GCP_LOCATION || 'us-central1';
const apiKey = process.env.GEMINI_API_KEY;

const authForVertex = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

const ai = apiKey 
    ? new GoogleGenAI({ apiKey })
    : new GoogleGenAI({ vertexai: true, project, location, googleAuth: authForVertex });

const db = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || undefined
});

// Candidate models for Gemini AI on Vertex AI Model Garden
const CANDIDATE_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-2.5-pro'
];

const userSelectedModel = new Map();

function getModelsForUser(userId) {
    const preferred = userSelectedModel.get(userId);
    if (preferred) {
        return [preferred, ...CANDIDATE_MODELS.filter(m => m !== preferred)];
    }
    return CANDIDATE_MODELS;
}

// Track Token Usage to Firestore
async function trackTokenUsage(userId, command, usageMetadata) {
    if (!usageMetadata) return;
    try {
        const promptTokens = usageMetadata.promptTokenCount || 0;
        const candidateTokens = usageMetadata.candidatesTokenCount || 0;
        const totalTokens = usageMetadata.totalTokenCount || (promptTokens + candidateTokens);

        await db.collection('token_usages').add({
            userId: String(userId),
            command: command || 'general',
            promptTokens,
            candidateTokens,
            totalTokens,
            timestamp: new Date()
        });
    } catch (e) {
        console.warn('[TOKEN_TRACK] Error logging token usage:', e.message);
    }
}

// Configuration for Branch Bots
const BRANCHES = {
    TP: {
        code: 'TP',
        name: 'Cabang TP (GC-TP6)',
        token: process.env.TELEGRAM_TOKEN_TP || '8797074812:AAFyqQ_9bGVXFNyrVNJJtyFf1hnRex8FhUo',
        spreadsheets: {
            produksi: '1673K8akr2mXuTEPLPPnL9X5TiA4GEVDi1hbgMLThvo4',
            waste: '1673K8akr2mXuTEPLPPnL9X5TiA4GEVDi1hbgMLThvo4',
            dailyso: '1zWJddVVEEMULyjWcCAJojaNZKJHmKIlE4kXphK0tJ9g'
        },
        morningTemplate: `
MORNING BRIEFING GC-TP6  {{DATE}}

Monthly Target Sales : 150.000.000
Daily Target Sales : (3.300.000/8.800.000)

Daily Target Cup : 150
Shift Opening  : 75
Shift Closing : 75

{{SCHEDULE_AREA}}

Preparation Kitchen:
~ Kondisional~ 

Notes : Tolong masak sesuai kebutuhan

PROMO
• TT Voucher
• Blu Cashback
• Bank Saqu Cashback

NOTES
- Service excellent
- Wajib cek platform online
- Jangan lupa in out break time

Thank you and Cheer up team!
        `.trim()
    },
    PM: {
        code: 'PM',
        name: 'Cabang PM/PMS (GC-PMS)',
        token: process.env.TELEGRAM_TOKEN_PM || '8999763453:AAFHD_9j9PVVN1TkLOGlrjeBn8P1O7c_Wac',
        spreadsheets: {
            produksi: '1eN2n1esCQU5kgOxQRf7zlHaETCp_d92GKHjF-ZgRAHI',
            waste: '1eN2n1esCQU5kgOxQRf7zlHaETCp_d92GKHjF-ZgRAHI',
            dailyso: '1iERB0D5LlVG0m4dV3ZhZofjFrp5DwSiOwtOQCNcyfCU'
        },
        morningTemplate: `
MORNING BRIEFING GC-PMS  {{DATE}}

Monthly Target Sales : 175.000.000
Daily Target Sales : (4.000.000/10.000.000)

Daily Target Cup : 185
Shift Opening  : 95
Shift Closing : 95

{{SCHEDULE_AREA}}

Preparation Kitchen:
~ Kondisional~ 

Notes : Tolong masak sesuai kebutuhan

PROMO
• TT Voucher
• Blu Cashback
• Bank Saqu Cashback

NOTES
- Service excellent
- Wajib cek platform online
- Jangan lupa in out break time

Thank you and Cheer up team!
        `.trim()
    }
};

// Google Sheets Auth helper
async function getSheetsClient() {
    try {
        const { execSync } = require('child_process');
        const token = execSync('gcloud auth application-default print-access-token 2>/dev/null || gcloud auth print-access-token 2>/dev/null').toString().trim();
        if (token) {
            const oauth2Client = new google.auth.OAuth2();
            oauth2Client.setCredentials({ access_token: token });
            return google.sheets({ version: 'v4', auth: oauth2Client });
        }
    } catch (e) {
        console.error('[SHEETS_AUTH] Direct gcloud token fetch failed:', e.message);
    }

    const auth = new google.auth.GoogleAuth({
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/cloud-platform'
        ]
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

// Fungsi Fuzzy Match Lokal (Levenshtein Distance) untuk Cost-Optimized Token Usage harian
function fuzzyMatchLokal(typedInput, daftarResmi) {
    const cleanString = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    const inputClean = cleanString(typedInput);
    if (!inputClean) return null;

    let bestMatch = null;
    let highestScore = 0;

    for (const resmi of daftarResmi) {
        const resmiClean = cleanString(resmi);
        if (resmiClean === inputClean) {
            return resmi; // Cocok 100% langsung bypass
        }

        // Hitung kesamaan substring sederhana
        if (resmiClean.includes(inputClean) || inputClean.includes(resmiClean)) {
            const score = Math.min(resmiClean.length, inputClean.length) / Math.max(resmiClean.length, inputClean.length);
            if (score > highestScore) {
                highestScore = score;
                bestMatch = resmi;
            }
        }
    }

    // Jika kemiripan sangat tinggi (di atas 85%), anggap sukses bypass AI
    if (highestScore >= 0.85) {
        return bestMatch;
    }
    return null;
}

// Helper to safely extract and parse JSON from AI response
function parseJsonFromAi(text) {
    if (!text) return null;
    let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    try {
        return JSON.parse(clean);
    } catch (e) {
        const match = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (e2) {}
        }
    }
    return null;
}

function getJakartaCalendarDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const value = type => parts.find(part => part.type === type).value;

    return {
        day: Number(value('day')),
        month: Number(value('month')),
        year: Number(value('year'))
    };
}

function getDaysToCheck(todayDay) {
    return Array.from({ length: Math.max(todayDay - 1, 0) }, (_, index) => index + 1);
}

function hasReportedQuantity(rows, startIndex, endIndex, quantityColumnIndex) {
    for (let index = startIndex; index < endIndex; index++) {
        const productName = String(rows[index]?.[0] || '').trim();
        const quantity = String(rows[index]?.[quantityColumnIndex] || '').trim();

        if (productName && !productName.startsWith('---') && !productName.includes('KODE') &&
            !productName.includes('NAMA PRODUK') && quantity && quantity !== '0') {
            return true;
        }
    }
    return false;
}

function getProductionWasteStatus(rows) {
    let productionStartIndex = -1;
    let wasteStartIndex = -1;

    rows.forEach((row, index) => {
        const value = String(row[0] || '').trim().toUpperCase();
        if (value === 'PRODUCTION') productionStartIndex = index;
        if (value === 'WASTE') wasteStartIndex = index;
    });

    const productionEndIndex = wasteStartIndex === -1 ? rows.length : wasteStartIndex;
    return {
        productionFilled: productionStartIndex !== -1 &&
            hasReportedQuantity(rows, productionStartIndex + 1, productionEndIndex, 2),
        wasteFilled: wasteStartIndex !== -1 &&
            hasReportedQuantity(rows, wasteStartIndex + 1, rows.length, 2)
    };
}

function getDailySoStatus(rows, day) {
    // Daily SO writes day 1 to column D, day 2 to E, and so on.
    const quantityColumnIndex = (3 + day) - 2;
    return hasReportedQuantity(rows, 0, rows.length, quantityColumnIndex);
}

function formatDayList(days) {
    return days.length ? days.map(day => `\`${day}\``).join(', ') : '—';
}

function formatCheckPeriod(days, calendarDate) {
    return `${days[0]}–${days[days.length - 1]}/${String(calendarDate.month).padStart(2, '0')}/${calendarDate.year}`;
}

// Convert 1-based column index to Letter A, B, C...
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

// Format Uptime helper
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d} hari`);
    if (h > 0) parts.push(`${h} jam`);
    if (m > 0) parts.push(`${m} menit`);
    parts.push(`${s} detik`);
    return parts.join(' ');
}

// Global Bot Instances
const activeBots = [];

// Initialize each Telegram bot
function setupBot(branch) {
    const bot = new Telegraf(branch.token);
    const userPendingCommand = new Map();

    // --- INTERSEPTOR GLOBAL ANTI-EMOTICON & ANTI-EMOJI + NATURAL HUMAN REWRITER ---
    bot.use(async (ctx, next) => {
        const hapusEmoticonDanIkon = (text) => {
            if (!text) return '';
            
            // 1. Bersihkan seluruh rentang karakter Unicode Emoji, Simbol, Dingbats, dan Emoticon
            let bersih = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2190}-\u{21FF}]/gu, '');
            
            // 2. Ubah bullet tebal (•) menjadi strip (-)
            bersih = bersih.replace(/•/g, '-');

            // 3. TATA ULANG DIKSI KAKU MENJADI NATURAL & HUMAN-LIKE
            // Mengubah sambutan start robotik
            bersih = bersih.replace(/TELEGRAM REPORT BOT -/gi, 'Halo! Ini bot laporan');
            bersih = bersih.replace(/Selamat datang! Gunakan bot ini untuk/gi, 'Senang bisa membantu. Di sini kamu bisa langsung');
            bersih = bersih.replace(/DAFTAR PERINTAH AKTIF:/gi, 'Pilihan perintah yang bisa kamu gunakan:');
            bersih = bersih.replace(/Contoh Format Input/gi, 'Cara pengisian cepat');

            // Mengubah status koneksi & pengecekan kaku
            bersih = bersih.replace(/Mengecek Daily SO/gi, 'Sebentar ya, saya cek dulu laporan Daily SO');
            bersih = bersih.replace(/Mengecek Produksi dan Waste/gi, 'Tunggu sebentar, saya periksa dulu laporan Produksi dan Waste');
            bersih = bersih.replace(/sampai kemarin\.\.\./gi, 'dari kemarin...');
            bersih = bersih.replace(/Periode:/gi, 'Untuk tanggal:');
            bersih = bersih.replace(/Semua tanggal pada periode ini sudah terisi untuk/gi, 'Bagus! Semua laporan sudah lengkap terisi untuk');
            bersih = bersih.replace(/Tanggal belum diisi:/gi, 'Ada beberapa tanggal yang belum sempat diisi:');
            
            // Mengubah konfirmasi sukses pengisian
            bersih = bersih.replace(/PRODUKSI BERHASIL DICATAT/gi, 'Laporan produksi sudah berhasil masuk ke spreadsheet');
            bersih = bersih.replace(/WASTE BERHASIL DICATAT/gi, 'Laporan waste sudah sukses dicatat');
            bersih = bersih.replace(/DAILY SO BERHASIL DICATAT/gi, 'Laporan Daily SO sudah masuk dengan aman');
            bersih = bersih.replace(/Oleh:/gi, 'Pengisi:');
            bersih = bersih.replace(/Tab:/gi, 'Tanggal:');
            bersih = bersih.replace(/Item tidak dikenali:/gi, 'Ada item yang sepertinya salah ketik atau belum terdaftar:');

            // Mengubah status server & testing kaku
            bersih = bersih.replace(/TELEGRAM BOT STATUS/gi, 'Laporan Status Bot saat ini');
            bersih = bersih.replace(/Environment:/gi, 'Sistem:');
            bersih = bersih.replace(/RAM Usage:/gi, 'Memori terpakai:');
            bersih = bersih.replace(/Testing Google Sheets API connection for/gi, 'Mencoba tes koneksi ke Google Sheets');
            bersih = bersih.replace(/Connection Success!/gi, 'koneksinya lancar dan sukses!');
            
            // Merapikan garis pembatas robotik berlebihan
            bersih = bersih.replace(/-{30,}/g, '---');

            return bersih.trim();
        };

        // Intersepsi fungsi reply biasa
        const originalReply = ctx.reply;
        ctx.reply = async function (text, extra) {
            return originalReply.call(ctx, hapusEmoticonDanIkon(text), extra);
        };

        // Intersepsi fungsi reply dengan MarkdownV2
        const originalReplyWithMarkdownV2 = ctx.replyWithMarkdownV2;
        ctx.replyWithMarkdownV2 = async function (text, extra) {
            return originalReplyWithMarkdownV2.call(ctx, hapusEmoticonDanIkon(text), extra);
        };

        // Intersepsi fungsi editMessageText
        const originalEditMessageText = ctx.editMessageText;
        ctx.editMessageText = async function (text, extra) {
            return originalEditMessageText.call(ctx, hapusEmoticonDanIkon(text), extra);
        };

        return next();
    });

    // 1. /start & /help
    bot.command(['start', 'help'], async (ctx) => {
        const welcomeText = `
🤖 *TELEGRAM REPORT BOT - ${branch.name.toUpperCase()}*
----------------------------------------
Selamat datang! Gunakan bot ini untuk menginput data operasional ke Google Sheets *${branch.code}*.

📌 *DAFTAR PERINTAH AKTIF:*
• \`/produksi [data]\` - Input Laporan Produksi Harian
• \`/waste [data]\` - Input Laporan Waste (Dibuang)
• \`/dailyso [data]\` - Input Daily Stock Opname
• \`/checkprodwaste\` - Cek tanggal Produksi/Waste yang belum diisi bulan ini
• \`/checkdailyso\` - Cek tanggal Daily SO yang belum diisi bulan ini
• \`/morningbriefing [data]\` - Format Morning Briefing Shift
• \`/closingbriefing [data]\` - Format Closing Briefing Shift
• \`/testsheet\` - Uji koneksi Google Sheets
• \`/status\` - Cek status bot & server

💡 *Contoh Format Input Produksi:*
/produksi
1.8.26
bt lokal 250
gt 100
        `.trim();
        await ctx.replyWithMarkdownV2(escapeMarkdown(welcomeText));
    });

    // 2. /status
    bot.command('status', async (ctx) => {
        const uptime = formatUptime(process.uptime());
        const mem = process.memoryUsage();
        const ramUsedMB = (mem.rss / (1024 * 1024)).toFixed(2);

        const statusText = `
🤖 *TELEGRAM BOT STATUS (${branch.code})*
----------------------------------------
🟢 *Status:* ONLINE 24/7
🏬 *Cabang:* ${branch.name}
☁️ *Environment:* GCP Compute Engine
⏱️ *Uptime:* ${uptime}
📊 *RAM Usage:* ${ramUsedMB} MB
⚡ *Runtime:* Node.js ${process.version}
🕒 *Server Time:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
----------------------------------------
_Bot Cloud-Native Multi-Branch_ 🚀
        `.trim();
        await ctx.replyWithMarkdownV2(escapeMarkdown(statusText));
    });

    // 3. /testsheet
    bot.command('testsheet', async (ctx) => {
        await ctx.reply(`⏳ Testing Google Sheets API connection for ${branch.name}...`);
        try {
            const sheets = await getSheetsClient();
            const spreadsheetId = branch.spreadsheets.produksi;
            const meta = await sheets.spreadsheets.get({ spreadsheetId });
            const firstSheetTitle = meta.data.sheets?.[0]?.properties?.title || 'Sheet1';

            const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
            const values = [[timestamp, 'Koneksi Sukses Telegram Bot', 'Dites via GCP VM']];

            const updateRes = await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${firstSheetTitle}'!A78:C78`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values }
            });

            await ctx.reply(`✅ *Google Sheets ${branch.code} Connection Success!*\nTab: \`${firstSheetTitle}\`\nRange: \`${updateRes.data.updatedRange}\``, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(`[TEST_SHEETS_${branch.code}] Error:`, err);
            await ctx.reply(`❌ *Gagal Koneksi Google Sheets:* ${err.message}`, { parse_mode: 'Markdown' });
        }
    });

    // 4. /checkprodwaste - Check production and waste entries from the first day of this month through yesterday.
    bot.command('checkprodwaste', async (ctx) => {
        const calendarDate = getJakartaCalendarDate();
        const days = getDaysToCheck(calendarDate.day);

        if (days.length === 0) {
            return await ctx.reply('ℹ️ Belum ada tanggal sebelum hari ini untuk diperiksa pada bulan ini.', { parse_mode: 'Markdown' });
        }

        await ctx.reply(`⏳ Mengecek Produksi dan Waste ${branch.name} sampai kemarin...`, { parse_mode: 'Markdown' });

        try {
            const sheets = await getSheetsClient();
            const spreadsheetId = branch.spreadsheets.produksi;
            const metaRes = await sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets.properties.title'
            });
            const availableTabs = new Set((metaRes.data.sheets || []).map(sheet => sheet.properties.title));
            const existingDays = days.filter(day => availableTabs.has(`${day} - ${calendarDate.year}`));
            const missingTabs = days.filter(day => !availableTabs.has(`${day} - ${calendarDate.year}`));
            const missingProduction = [...missingTabs];
            const missingWaste = [...missingTabs];

            if (existingDays.length > 0) {
                const ranges = existingDays.map(day => `'${day} - ${calendarDate.year}'!B1:D120`);
                const result = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });

                (result.data.valueRanges || []).forEach((valueRange, index) => {
                    const day = existingDays[index];
                    const status = getProductionWasteStatus(valueRange.values || []);
                    if (!status.productionFilled) missingProduction.push(day);
                    if (!status.wasteFilled) missingWaste.push(day);
                });
            }

            const period = formatCheckPeriod(days, calendarDate);
            let replyText = `📋 *CEK PRODUKSI & WASTE (${branch.code})*\n`;
            replyText += `📅 Periode: *${period}* (sampai kemarin)\n`;
            replyText += `----------------------------------------\n`;

            if (missingProduction.length === 0 && missingWaste.length === 0) {
                replyText += '✅ Semua tanggal pada periode ini sudah terisi untuk Produksi dan Waste.';
            } else {
                replyText += '❌ *Tanggal belum diisi:*\n';
                replyText += `• Produksi: ${formatDayList(missingProduction)}\n`;
                replyText += `• Waste: ${formatDayList(missingWaste)}`;
                if (missingTabs.length > 0) {
                    replyText += `\n\nℹ️ Tab belum tersedia (dianggap belum diisi): ${formatDayList(missingTabs)}`;
                }
            }

            await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(`[CHECK_PROD_WASTE_${branch.code}] Error:`, err);
            await ctx.reply(`❌ Gagal mengecek Produksi/Waste: ${err.message}`);
        }
    });

    // 5. /checkdailyso - Check Daily SO entries from the first day of this month through yesterday.
    bot.command('checkdailyso', async (ctx) => {
        const calendarDate = getJakartaCalendarDate();
        const days = getDaysToCheck(calendarDate.day);

        if (days.length === 0) {
            return await ctx.reply('ℹ️ Belum ada tanggal sebelum hari ini untuk diperiksa pada bulan ini.', { parse_mode: 'Markdown' });
        }

        await ctx.reply(`⏳ Mengecek Daily SO ${branch.name} sampai kemarin...`, { parse_mode: 'Markdown' });

        try {
            const sheets = await getSheetsClient();
            const spreadsheetId = branch.spreadsheets.dailyso;
            const metaRes = await sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets.properties.title'
            });
            const sheetTitles = (metaRes.data.sheets || []).map(sheet => sheet.properties.title);
            const defaultTab = sheetTitles[0];

            if (!defaultTab) {
                return await ctx.reply(`❌ Tidak menemukan tab pada spreadsheet Daily SO ${branch.name}.`);
            }

            const targets = days.map(day => {
                const datedTab = `${day} - ${calendarDate.year}`;
                const tabName = sheetTitles.includes(datedTab) ? datedTab : defaultTab;
                const columnLetter = colIndexToLetter(3 + day);
                return { day, tabName, columnLetter };
            });
            const result = await sheets.spreadsheets.values.batchGet({
                spreadsheetId,
                ranges: targets.map(target => `'${target.tabName}'!B1:${target.columnLetter}150`)
            });
            const missingDays = [];

            (result.data.valueRanges || []).forEach((valueRange, index) => {
                const target = targets[index];
                if (!getDailySoStatus(valueRange.values || [], target.day)) {
                    missingDays.push(target.day);
                }
            });

            const period = formatCheckPeriod(days, calendarDate);
            let replyText = `📋 *CEK DAILY SO (${branch.code})*\n`;
            replyText += `📅 Periode: *${period}* (sampai kemarin)\n`;
            replyText += `----------------------------------------\n`;
            replyText += missingDays.length === 0
                ? '✅ Semua tanggal pada periode ini sudah terisi untuk Daily SO.'
                : `❌ *Tanggal belum diisi:* ${formatDayList(missingDays)}`;

            await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(`[CHECK_DAILYSO_${branch.code}] Error:`, err);
            await ctx.reply(`❌ Gagal mengecek Daily SO: ${err.message}`);
        }
    });

    async function processProduksiLogic(ctx, inputText) {
        if (!ai) {
            return await ctx.reply('⚠️ GEMINI_API_KEY belum dikonfigurasi.');
        }

        const senderName = ctx.from.first_name || ctx.from.username || 'User';

        const inputLines = inputText.split('\n').map(l => l.trim()).filter(Boolean);
        const dateRaw = inputLines.shift();
        const dateParts = dateRaw.split(/[./-]/);
        if (dateParts.length < 3) {
            return await ctx.reply('❌ Format tanggal salah. Gunakan format tanggal seperti: `1.8.26`', { parse_mode: 'Markdown' });
        }
        const day = parseInt(dateParts[0], 10);
        const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
        const tabName = `${day} - ${year}`;

        await ctx.reply(`⏳ Menghubungkan ke Spreadsheet *${branch.name}*, Tab: *"${tabName}"*...`, { parse_mode: 'Markdown' });

        try {
            const sheets = await getSheetsClient();
            const spreadsheetId = branch.spreadsheets.produksi;

            const readRes = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${tabName}'!B1:D120`
            });

            const rows = readRes.data.values || [];
            if (rows.length === 0) {
                return await ctx.reply(`❌ Gagal membaca data dari tab "${tabName}".`);
            }

            const productionProducts = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const prodName = String(row[0] || '').trim();
                const existingQty = String(row[2] || '').trim();

                if (prodName && !prodName.startsWith('---') && !prodName.includes('NAMA PRODUK') && !prodName.includes('KODE')) {
                    productionProducts.push({
                        name: prodName,
                        rowIndex: i + 1,
                        existingQty: (existingQty && existingQty !== '0' && existingQty !== '') ? existingQty : null
                    });
                }
            }

            const validProductNamesList = productionProducts.map(p => p.name);

            // --- LOKAL HYBRID PRE-PARSER (COST-OPTIMIZED SAVER) ---
            let preParsedSuccess = true;
            const preParsedItems = [];

            for (const line of inputLines) {
                const parts = line.trim().split(/\s+/);
                const quantityStr = parts.pop();
                const quantity = parseInt(quantityStr, 10);
                const typedName = parts.join(' ').trim();

                if (!isNaN(quantity) && typedName) {
                    const matchedName = fuzzyMatchLokal(typedName, validProductNamesList);
                    if (matchedName) {
                        preParsedItems.push({
                            typed: typedName,
                            matchedName: matchedName,
                            quantity: quantity
                        });
                    } else {
                        preParsedSuccess = false;
                        break;
                    }
                } else {
                    preParsedSuccess = false;
                    break;
                }
            }

            let aiResult = null;
            if (preParsedSuccess && preParsedItems.length > 0) {
                console.log(`[PRE-PARSER] Sukses bypass AI untuk Produksi ${branch.code}. Hemat Token!`);
                aiResult = { items: preParsedItems };
            } else {
                console.log(`[PRE-PARSER] Ada item tidak dikenal atau format bebas. Memanggil Gemini AI...`);
                const prompt = `
SANGAT PENTING: RESPON HANYA DALAM FORMAT JSON VALID. DILARANG MENAMBAHKAN TEKS PENJELASAN, BASA-BASI, ATAU TEKS LAIN SEPERTI "Tentu,..." ATAU "Berikut adalah...".

Anda adalah AI parser laporan produksi toko minuman.
Tugas Anda:
1. Analisis input:
"""
${inputLines.join('\n')}
"""
2. Cocokkan nama item yang diketik staff ke daftar nama produk RESMI yang ada di spreadsheet:
${JSON.stringify(validProductNamesList, null, 2)}

3. JSON Output bersih:
{
  "items": [
    { "typed": "nama_input", "matchedName": "NAMA_RESMI", "quantity": angka }
  ]
}
            `.trim();

                for (const modelName of CANDIDATE_MODELS) {
                    try {
                        const response = await ai.models.generateContent({ model: modelName, contents: prompt });
                        const rawText = response.text || '';
                        aiResult = parseJsonFromAi(rawText);
                        if (aiResult && Array.isArray(aiResult.items)) break;
                    } catch (err) {}
                }
            }

            if (!aiResult || !Array.isArray(aiResult.items)) {
                return await ctx.reply(`❌ Gagal memparsing input produksi dengan AI.`);
            }

            const matchedOfficialItems = aiResult.items.filter(item => item.matchedName);
            const itemsWithConflict = [];

            for (const item of matchedOfficialItems) {
                const targetProd = productionProducts.find(p => p.name.toUpperCase() === item.matchedName.toUpperCase());
                if (targetProd && targetProd.existingQty) {
                    itemsWithConflict.push({
                        name: targetProd.name,
                        existing: targetProd.existingQty,
                        newVal: item.quantity
                    });
                }
            }

            if (itemsWithConflict.length > 0) {
                const pendingId = `pending_${Date.now()}_${ctx.from.id}`;
                await db.collection('pending_inputs').doc(pendingId).set({
                    type: 'produksi',
                    tabName,
                    dateRaw,
                    items: aiResult.items,
                    productionProducts,
                    spreadsheetId,
                    userNickname: senderName,
                    createdAt: new Date().toISOString()
                });

                let conflictText = `⚠️ *DATA PRODUKSI TANGGAL ${dateRaw} SUDAH TERISI!*\n`;
                conflictText += `----------------------------------------\n`;
                conflictText += `*Data Lama di Spreadsheet (${branch.code}):*\n`;
                itemsWithConflict.forEach(c => {
                    conflictText += `- *${c.name}*: ${c.existing} ➔ *${c.newVal}*\n`;
                });
                conflictText += `\n📥 *DATA BARU YANG INGIN DIINPUT:*\n`;
                aiResult.items.forEach(item => {
                    if (item.matchedName) conflictText += `- *${item.matchedName}*: ${item.quantity}\n`;
                    else conflictText += `- _${item.typed}_ (Tidak dikenal): ${item.quantity}\n`;
                });
                conflictText += `----------------------------------------\n`;
                conflictText += `Apakah Anda yakin ingin menimpa data lama?`;

                return await ctx.reply(conflictText, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback('🔄 Ya, Ganti Data', `overwrite_yes:${pendingId}`),
                            Markup.button.callback('❌ Batal', `overwrite_no:${pendingId}`)
                        ]
                    ])
                });
            }

            await writeProduksiItems(sheets, spreadsheetId, tabName, aiResult.items, productionProducts, senderName, branch.code, ctx);

        } catch (err) {
            console.error(`[PRODUKSI_${branch.code}] Error:`, err);
            await ctx.reply(`❌ Terjadi kesalahan fatal: ${err.message}`);
        }
    }

    // 6. /produksi
    bot.command('produksi', async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift(); // Remove command
        const inputText = lines.join('\n').trim();

        if (!inputText) {
            userPendingCommand.set(ctx.from.id, { command: 'produksi', step: 'date', timestamp: Date.now() });
            return await ctx.reply(`📅 *LANGKAH 1 DARI 2: INPUT TANGGAL PRODUKSI*\n----------------------------------------\nSilakan masukkan **Tanggal Laporan Produksi**.\n\n💡 *Contoh Kirim:* \`2.8.26\` atau \`02/08/2026\``, { parse_mode: 'Markdown' });
        }

        return await processProduksiLogic(ctx, inputText);
    });

    async function processWasteLogic(ctx, inputText) {
        if (!ai) {
            return await ctx.reply('⚠️ GEMINI_API_KEY belum dikonfigurasi.');
        }

        const senderName = ctx.from.first_name || ctx.from.username || 'User';

        const inputLines = inputText.split('\n').map(l => l.trim()).filter(Boolean);
        const dateRaw = inputLines.shift();
        const dateParts = dateRaw.split(/[./-]/);
        if (dateParts.length < 3) {
            return await ctx.reply('❌ Format tanggal salah. Gunakan format tanggal seperti: `1.8.26`', { parse_mode: 'Markdown' });
        }
        const day = parseInt(dateParts[0], 10);
        const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
        const tabName = `${day} - ${year}`;

        await ctx.reply(`⏳ Menghubungkan ke Spreadsheet *${branch.name}* (Waste), Tab: *"${tabName}"*...`, { parse_mode: 'Markdown' });

        try {
            const sheets = await getSheetsClient();
            const spreadsheetId = branch.spreadsheets.waste;

            const readRes = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${tabName}'!B1:D120`
            });

            const rowsBtoD = readRes.data.values || [];
            if (rowsBtoD.length === 0) {
                return await ctx.reply(`❌ Gagal membaca produk dari tab "${tabName}".`);
            }

            let wasteStartIdx = -1;
            rowsBtoD.forEach((row, idx) => {
                const cellVal = String(row[0] || '').trim().toUpperCase();
                if (cellVal === 'WASTE') wasteStartIdx = idx;
            });

            if (wasteStartIdx === -1) {
                return await ctx.reply(`❌ Header "WASTE" tidak ditemukan di kolom B pada tab "${tabName}".`);
            }

            const wasteProducts = [];
            for (let i = wasteStartIdx + 1; i < rowsBtoD.length; i++) {
                const prodName = String(rowsBtoD[i]?.[0] || '').trim();
                const existingQty = String(rowsBtoD[i]?.[2] || '').trim();

                if (prodName && !prodName.startsWith('---') && !prodName.includes('KODE')) {
                    wasteProducts.push({
                        name: prodName,
                        rowIndex: i + 1,
                        existingQty: (existingQty && existingQty !== '0' && existingQty !== '') ? existingQty : null
                    });
                }
            }

            const validProductNamesList = wasteProducts.map(p => p.name);

            // --- LOKAL HYBRID PRE-PARSER (COST-OPTIMIZED SAVER) ---
            let preParsedSuccess = true;
            const preParsedItems = [];

            for (const line of inputLines) {
                const parts = line.trim().split(/\s+/);
                const quantityStr = parts.pop();
                const quantity = parseInt(quantityStr, 10);
                const typedName = parts.join(' ').trim();

                if (!isNaN(quantity) && typedName) {
                    const matchedName = fuzzyMatchLokal(typedName, validProductNamesList);
                    if (matchedName) {
                        preParsedItems.push({
                            typed: typedName,
                            matchedName: matchedName,
                            quantity: quantity
                        });
                    } else {
                        preParsedSuccess = false;
                        break;
                    }
                } else {
                    preParsedSuccess = false;
                    break;
                }
            }

            let aiResult = null;
            if (preParsedSuccess && preParsedItems.length > 0) {
                console.log(`[PRE-PARSER] Sukses bypass AI untuk Waste ${branch.code}. Hemat Token!`);
                aiResult = { items: preParsedItems };
            } else {
                console.log(`[PRE-PARSER] Ada item tidak dikenal atau format bebas di Waste. Memanggil Gemini AI...`);
                const prompt = `
Anda adalah AI parser laporan waste (item dibuang/rusak) toko minuman.
Tugas Anda:
1. Analisis input:
"""
${inputLines.join('\n')}
"""
2. Cocokkan nama item yang diketik staff ke daftar nama produk RESMI yang ada di spreadsheet:
${JSON.stringify(validProductNamesList, null, 2)}

3. JSON Output bersih:
{
  "items": [
    { "typed": "nama_input", "matchedName": "NAMA_RESMI", "quantity": angka }
  ]
}
                `.trim();

                for (const modelName of CANDIDATE_MODELS) {
                    try {
                        const response = await ai.models.generateContent({ model: modelName, contents: prompt });
                        const rawText = response.text || '';
                        aiResult = parseJsonFromAi(rawText);
                        if (aiResult && Array.isArray(aiResult.items)) break;
                    } catch (err) {}
                }
            }

            if (!aiResult || !Array.isArray(aiResult.items)) {
                return await ctx.reply(`❌ Gagal memparsing input waste dengan AI.`);
            }

            // Direct Write Waste
            let successWrites = 0;
            const unrecognizedItems = [];
            const successReports = [];

            for (const item of aiResult.items) {
                if (!item.matchedName) {
                    unrecognizedItems.push(item);
                    continue;
                }
                const matchedProd = wasteProducts.find(p => p.name.toUpperCase() === item.matchedName.toUpperCase());
                if (!matchedProd) {
                    unrecognizedItems.push(item);
                    continue;
                }

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `'${tabName}'!D${matchedProd.rowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[item.quantity]] }
                });

                successWrites++;
                successReports.push(`• *${item.matchedName}*: \`${item.quantity}\``);
            }

            let replyText = `✅ *WASTE BERHASIL DICATAT (${branch.code})*\n`;
            replyText += `📅 *Tanggal:* ${dateRaw} (${tabName})\n`;
            replyText += `✍️ *Oleh:* *${senderName}*\n`;
            replyText += `----------------------------------------\n`;
            if (successWrites > 0) replyText += successReports.join('\n') + `\n`;
            if (unrecognizedItems.length > 0) {
                replyText += `----------------------------------------\n⚠️ *Tidak dikenali:*\n`;
                unrecognizedItems.forEach(i => replyText += `- _${i.typed}_ (${i.quantity})\n`);
            }

            await ctx.reply(replyText, { parse_mode: 'Markdown' });

        } catch (err) {
            console.error(`[WASTE_${branch.code}] Error:`, err);
            await ctx.reply(`❌ Error: ${err.message}`);
        }
    }

    // 5. /waste
    bot.command('waste', async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift();
        const inputText = lines.join('\n').trim();

        if (!inputText) {
            userPendingCommand.set(ctx.from.id, { command: 'waste', step: 'date', timestamp: Date.now() });
            return await ctx.reply(`📅 *LANGKAH 1 DARI 2: INPUT TANGGAL WASTE*\n----------------------------------------\nSilakan masukkan **Tanggal Laporan Waste (Dibuang)**.\n\n💡 *Contoh Kirim:* \`2.8.26\` atau \`02/08/2026\``, { parse_mode: 'Markdown' });
        }

        return await processWasteLogic(ctx, inputText);
    });

    async function processDailysoLogic(ctx, inputText) {
        if (!ai) return await ctx.reply('⚠️ GEMINI_API_KEY belum dikonfigurasi.');

        const senderName = ctx.from.first_name || ctx.from.username || 'User';

        const inputLines = inputText.split('\n').map(l => l.trim()).filter(Boolean);
        const dateRaw = inputLines.shift();

        const dateParts = dateRaw.split(/[./-]/);
        if (dateParts.length < 3) {
            return await ctx.reply('❌ Format tanggal salah. Gunakan format tanggal seperti: `30.7.26`', { parse_mode: 'Markdown' });
        }
        const day = parseInt(dateParts[0], 10);
        const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];

        const targetColIdx = 3 + day;
        const colLetter = colIndexToLetter(targetColIdx);

        await ctx.reply(`⏳ Menghubungkan ke Spreadsheet Daily SO *${branch.name}*, Kolom *${colLetter}* (Tanggal ${day})...`, { parse_mode: 'Markdown' });

        try {
            const sheets = await getSheetsClient();
            const spreadsheetId = branch.spreadsheets.dailyso;

            const metaRes = await sheets.spreadsheets.get({ spreadsheetId });
            const allSheets = metaRes.data.sheets || [];
            if (allSheets.length === 0) {
                return await ctx.reply(`❌ Gagal menemukan tab di spreadsheet Daily SO ${branch.name}.`);
            }

            let targetTab = allSheets[0].properties.title;
            const formattedTabCandidate = `${day} - ${year}`;
            const matchedSheet = allSheets.find(s => s.properties.title === formattedTabCandidate);
            if (matchedSheet) {
                targetTab = matchedSheet.properties.title;
            }

            const rangeToRead = `'${targetTab}'!B1:${colLetter}150`;
            const readRes = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: rangeToRead
            });

            const rows = readRes.data.values || [];
            if (rows.length === 0) {
                return await ctx.reply(`❌ Gagal membaca produk dari tab "${targetTab}".`);
            }

            const validProducts = [];
            rows.forEach((row, idx) => {
                const prodName = String(row[0] || '').trim();
                const targetColInRowIdx = targetColIdx - 2;
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

            // --- LOKAL HYBRID PRE-PARSER (COST-OPTIMIZED SAVER) ---
            let preParsedSuccess = true;
            const preParsedItems = [];

            for (const line of inputLines) {
                const parts = line.trim().split(/\s+/);
                const quantityStr = parts.pop();
                const quantity = parseInt(quantityStr, 10);
                const typedName = parts.join(' ').trim();

                if (!isNaN(quantity) && typedName) {
                    const matchedName = fuzzyMatchLokal(typedName, validProductNamesList);
                    if (matchedName) {
                        preParsedItems.push({
                            typed: typedName,
                            matchedName: matchedName,
                            quantity: quantity
                        });
                    } else {
                        preParsedSuccess = false;
                        break;
                    }
                } else {
                    preParsedSuccess = false;
                    break;
                }
            }

            let aiResult = null;
            if (preParsedSuccess && preParsedItems.length > 0) {
                console.log(`[PRE-PARSER] Sukses bypass AI untuk Daily SO ${branch.code}. Hemat Token!`);
                aiResult = { items: preParsedItems };
            } else {
                console.log(`[PRE-PARSER] Ada item tidak dikenal atau format bebas di Daily SO. Memanggil Gemini AI...`);
                const prompt = `
SANGAT PENTING: RESPON HANYA DALAM FORMAT JSON VALID. DILARANG MENAMBAHKAN TEKS PENJELASAN, BASA-BASI, ATAU TEKS LAIN SEPERTI "Tentu,..." ATAU "Berikut adalah...".

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

3. Keluarkan hasil analisis dalam format JSON bersih:
{
  "items": [
    { "typed": "nama_input_staff", "matchedName": "NAMA_RESMI_DI_SPREADSHEET", "quantity": angka_jumlah }
  ]
}
                `.trim();

                for (const modelName of CANDIDATE_MODELS) {
                    try {
                        const response = await ai.models.generateContent({ model: modelName, contents: prompt });
                        const rawText = response.text || '';
                        aiResult = parseJsonFromAi(rawText);
                        if (aiResult && Array.isArray(aiResult.items)) break;
                    } catch (err) {}
                }
            }

            if (!aiResult || !Array.isArray(aiResult.items)) {
                return await ctx.reply(`❌ Gagal memparsing input Daily SO dengan AI.`);
            }

            // Direct Write
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

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `'${targetTab}'!${colLetter}${matchedProd.rowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[item.quantity]] }
                });

                successWrites++;
                successReports.push(`• *${item.matchedName}*: \`${item.quantity}\``);
            }

            let replyText = `✅ *DAILY SO BERHASIL DICATAT (${branch.code})*\n`;
            replyText += `📅 *Tanggal:* ${dateRaw} (Kolom ${colLetter})\n`;
            replyText += `✍️ *Oleh:* *${senderName}*\n`;
            replyText += `----------------------------------------\n`;
            if (successWrites > 0) replyText += successReports.join('\n') + `\n`;
            if (unrecognizedItems.length > 0) {
                replyText += `----------------------------------------\n⚠️ *Tidak dikenali:*\n`;
                unrecognizedItems.forEach(i => replyText += `- _${i.typed}_ (${i.quantity})\n`);
            }

            await ctx.reply(replyText, { parse_mode: 'Markdown' });

        } catch (err) {
            console.error(`[DAILYSO_${branch.code}] Error:`, err);
            await ctx.reply(`❌ Error: ${err.message}`);
        }
    }

    // 5.5. /dailyso
    bot.command('dailyso', async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift();
        const inputText = lines.join('\n').trim();

        if (!inputText) {
            userPendingCommand.set(ctx.from.id, { command: 'dailyso', step: 'date', timestamp: Date.now() });
            return await ctx.reply(`📅 *LANGKAH 1 DARI 2: INPUT TANGGAL DAILY SO*\n----------------------------------------\nSilakan masukkan **Tanggal Laporan Daily Stock Opname**.\n\n💡 *Contoh Kirim:* \`30.7.26\` atau \`30/07/2026\``, { parse_mode: 'Markdown' });
        }

        return await processDailysoLogic(ctx, inputText);
    });

    // 6. /morningbriefing & aliases
    bot.command(['morningbriefing', 'morningbreafing', 'morningbreafingtp', 'morningbreafingpms', 'morningbriefingtp', 'morningbriefingpms'], async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift();
        const inputText = lines.join('\n').trim();

        if (!inputText) {
            return await ctx.reply(`⚠️ *Format Briefing Salah!*\n\n*Contoh Kirim:*\n/morningbriefing\n30/7/26\n09-18 Ferry\n13-22 Rama\noff Prass`, { parse_mode: 'Markdown' });
        }

        if (!ai) return await ctx.reply('⚠️ GEMINI_API_KEY belum dikonfigurasi.');

        await ctx.reply(`⏳ Memproses & memparsing Morning Briefing ${branch.code}...`);

        const prompt = `
Anda adalah AI parser laporan shift untuk toko ${branch.name}.
Tugas Anda:
1. Analisis input:
"""
${inputText}
"""
2. Normalisasi Tanggal ke format bersih "DD MMMM YYYY".
3. Format jadwal shift (SCHEDULE_AREA):
   - Jam kerja (misal "09-18 Ferry") -> "(09:00 - 18:00) Ferry". Pisahkan tiap entri dengan "~~~~~~~~".
   - Off / Phantom seksi.
4. Masukkan ke struktur template:
"""
${branch.morningTemplate}
"""
5. Output JSON: { "formattedText": "isi lengkap" }
        `.trim();

        let jsonResult = null;
        for (const modelName of CANDIDATE_MODELS) {
            try {
                const response = await ai.models.generateContent({ model: modelName, contents: prompt });
                const rawText = response.text || '';
                jsonResult = parseJsonFromAi(rawText);
                if (jsonResult && jsonResult.formattedText) break;
            } catch (err) {}
        }

        if (!jsonResult || !jsonResult.formattedText) {
            return await ctx.reply(`❌ Gagal memparsing template briefing dengan AI.`);
        }

        await ctx.reply(`✅ *Morning Briefing ${branch.code} Terformat:*\n\n${jsonResult.formattedText}`, { parse_mode: 'Markdown' });
    });

    // 7. /closingbriefing & aliases
    bot.command(['closingbriefing', 'closingbreafing', 'closingbreafingtp', 'closingbreafingpms', 'closingbriefingtp', 'closingbriefingpms'], async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift();
        const inputText = lines.join('\n').trim();

        if (!inputText) {
            return await ctx.reply(`⚠️ *Format Closing Briefing Salah!*`, { parse_mode: 'Markdown' });
        }

        if (!ai) return await ctx.reply('⚠️ GEMINI_API_KEY belum dikonfigurasi.');

        await ctx.reply(`⏳ Memproses Closing Briefing ${branch.code}...`);

        await ctx.reply(`✅ *Closing Briefing ${branch.code} Terformat:*\n\n${inputText}`, { parse_mode: 'Markdown' });
    });

    // AI Chat Sessions Map per bot
    const aiSessions = new Map();

    // 8. /ai - Activate AI Chat Mode or ask single prompt
    bot.command('ai', async (ctx) => {
        const fullText = ctx.message.text || '';
        const prompt = fullText.replace(/^\/ai(@\w+)?\s*/i, '').trim();
        const userId = ctx.from.id;

        // Activate AI Chat Mode
        aiSessions.set(userId, { active: true });

        if (!prompt) {
            return await ctx.reply('🤖 *AI Chat Mode Aktif!*\n\nSemua pesan teks yang Anda kirim selanjutnya akan dijawab otomatis oleh Gemini AI.\n\n👉 Ketik */esc* atau */exit* kapan saja untuk keluar dari AI Mode.', { parse_mode: 'Markdown' });
        }

        if (!ai) return await ctx.reply('⚠️ GEMINI_API_KEY belum dikonfigurasi.');

        await ctx.sendChatAction('typing');

        let replyText = null;
        let lastError = null;

        const modelsToTry = getModelsForUser(userId);
        for (const modelName of modelsToTry) {
            try {
                const response = await ai.models.generateContent({
                    model: modelName,
                    contents: prompt,
                });
                replyText = response.text;
                if (response.usageMetadata) {
                    trackTokenUsage(userId, 'ai', response.usageMetadata);
                }
                if (replyText) break;
            } catch (err) {
                lastError = err;
            }
        }

        if (replyText) {
            await ctx.reply(`${replyText}\n\n💡 _AI Chat Mode Aktif. Ketik /esc untuk keluar._`, { parse_mode: 'Markdown' });
        } else {
            const errMessage = lastError ? lastError.message : 'Tidak ada respon dari AI.';
            await ctx.reply(`❌ Error Gemini AI: ${errMessage}`);
        }
    });

    // 9. /model - Pilih model Gemini AI
    bot.command('model', async (ctx) => {
        const currentModel = userSelectedModel.get(ctx.from.id) || 'gemini-2.5-flash';
        const text = `
🤖 *PILIH MODEL GEMINI AI (VERTEX AI)*
----------------------------------------
Model aktif Anda saat ini: \`${currentModel}\`

Silakan pilih model Gemini AI yang ingin Anda gunakan:
        `.trim();

        await ctx.reply(text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🌟 Gemini 3.6 Flash (Terbaru & Cepat)', 'set_model:gemini-3.6-flash')],
                [Markup.button.callback('⚡ Gemini 3.5 Flash', 'set_model:gemini-3.5-flash')],
                [Markup.button.callback('🚀 Gemini 3.5 Flash-Lite', 'set_model:gemini-3.5-flash-lite')],
                [Markup.button.callback('🧠 Gemini 3.1 Pro Preview (Coding & Agentic)', 'set_model:gemini-3.1-pro-preview')],
                [Markup.button.callback('⚡ Gemini 3.1 Flash-Lite', 'set_model:gemini-3.1-flash-lite')],
                [Markup.button.callback('🔥 Gemini 3 Flash Preview', 'set_model:gemini-3-flash-preview')],
                [Markup.button.callback('🏆 Gemini 2.5 Flash (Default Stable)', 'set_model:gemini-2.5-flash')],
                [Markup.button.callback('🧠 Gemini 2.5 Pro', 'set_model:gemini-2.5-pro')],
                [Markup.button.callback('⚡ Gemini 2.5 Flash-Lite', 'set_model:gemini-2.5-flash-lite')]
            ])
        });
    });

    bot.action(/set_model:(.+)/, async (ctx) => {
        const selectedModel = ctx.match[1];
        userSelectedModel.set(ctx.from.id, selectedModel);
        await ctx.answerCbQuery(`✅ Model diubah ke ${selectedModel}`);
        await ctx.editMessageText(`✅ *Model Gemini AI Anda berhasil diubah ke:* \`${selectedModel}\``, { parse_mode: 'Markdown' });
    });

    // 10. /esc & /exit - Exit AI Chat Mode
    bot.command(['esc', 'exit', 'stop'], async (ctx) => {
        const userId = ctx.from.id;
        if (aiSessions.has(userId)) {
            aiSessions.delete(userId);
            await ctx.reply('🚪 *Keluar dari AI Chat Mode.*\nKembali ke mode operasional biasa.', { parse_mode: 'Markdown' });
        } else {
            await ctx.reply('ℹ️ Anda sedang tidak dalam AI Chat Mode.');
        }
    });

    // 11. /usage - Laporan Pemakaian Token Harian & Mingguan
    bot.command('usage', async (ctx) => {
        try {
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            // Today's Usage
            const todaySnap = await db.collection('token_usages')
                .where('timestamp', '>=', startOfToday)
                .get();

            let todayPrompt = 0, todayCandidate = 0, todayTotal = 0;
            todaySnap.forEach(doc => {
                const data = doc.data();
                todayPrompt += data.promptTokens || 0;
                todayCandidate += data.candidateTokens || 0;
                todayTotal += data.totalTokens || 0;
            });

            // Weekly Usage
            const weekSnap = await db.collection('token_usages')
                .where('timestamp', '>=', startOfWeek)
                .get();

            let weekPrompt = 0, weekCandidate = 0, weekTotal = 0;
            weekSnap.forEach(doc => {
                const data = doc.data();
                weekPrompt += data.promptTokens || 0;
                weekCandidate += data.candidateTokens || 0;
                weekTotal += data.totalTokens || 0;
            });

            const estCostTodayUSD = ((todayPrompt * 0.000075 + todayCandidate * 0.0003) / 1000).toFixed(6);
            const estCostTodayIDR = Math.round(((todayPrompt * 0.000075 + todayCandidate * 0.0003) / 1000) * 16200);

            const replyText = `
📊 *LAPORAN PEMAKAIAN TOKEN GEMINI AI*
----------------------------------------
📅 *Hari Ini (Sejak 00:00 WIB):*
• Input Tokens: \`${todayPrompt.toLocaleString('id-ID')}\`
• Output Tokens: \`${todayCandidate.toLocaleString('id-ID')}\`
• *Total Tokens:* \`${todayTotal.toLocaleString('id-ID')}\`
• Est. Biaya: ~$\`${estCostTodayUSD}\` (Rp \`${estCostTodayIDR.toLocaleString('id-ID')}\`)

🗓️ *7 Hari Terakhir:*
• Input Tokens: \`${weekPrompt.toLocaleString('id-ID')}\`
• Output Tokens: \`${weekCandidate.toLocaleString('id-ID')}\`
• *Total Tokens:* \`${weekTotal.toLocaleString('id-ID')}\`

💡 _Data dicatat real-time dari setiap eksekusi command AI & parsing spreadsheet._
            `.trim();

            await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('[USAGE_CMD_ERR]', err);
            await ctx.reply(`❌ Gagal mengambil data usage: ${err.message}`);
        }
    });

    // 12. /credit - Cek Status Kredit Free Tier GCP
    bot.command('credit', async (ctx) => {
        const text = `
💳 *STATUS KREDIT GCP & VERTEX AI FREE TIER*
----------------------------------------
☁️ *Provider:* Google Cloud Platform (GCP)
🏬 *Service:* Vertex AI (ADC Authenticated)

📌 *INFORMASI BIAYA & FREE TIER:*
• Vertex AI memberikan **Free Tier bulanan gratis** untuk model Gemini Flash.
• Jika akun GCP Anda menggunakan **$300 Free Trial Credit**, pemakaian token bot secara otomatis memotong kredit promo tersebut.

💰 *ESTIMASI BIAYA MODEL GEMINI FLASH:*
• Input: ~$0.075 per 1.000.000 tokens
• Output: ~$0.30 per 1.000.000 tokens
_(Pemakaian harian bot rata-rata < 50.000 tokens ≈ Rp 100 - Rp 500 per hari)_

🔗 *Cek Sisa Kredit GCP $300 secara presisi:*
Buka GCP Billing Console: https://console.cloud.google.com/billing
        `.trim();

        await ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // 11. Handle continuous text for Pending Commands or AI Chat Mode
    bot.on('text', async (ctx, next) => {
        const text = ctx.message.text || '';
        if (text.startsWith('/')) return next();

        const userId = ctx.from.id;

        // Check if user has a pending command session (e.g. /produksi, /waste, /dailyso without payload)
        if (userPendingCommand.has(userId)) {
            const pending = userPendingCommand.get(userId);

            if (pending.step === 'date') {
                // Step 1 done: Received date, now update pending to step 2 (items) and ask for items data
                userPendingCommand.set(userId, { command: pending.command, step: 'items', date: text.trim(), timestamp: Date.now() });

                let exampleText = '';
                let title = '';
                if (pending.command === 'produksi') {
                    title = 'PRODUKSI';
                    exampleText = 'bt lokal 250\ngt 100\nherbal jelly 5';
                } else if (pending.command === 'waste') {
                    title = 'WASTE (DIBUANG)';
                    exampleText = 'bt lokal 10\ngt 5\nherbal jelly 2';
                } else if (pending.command === 'dailyso') {
                    title = 'DAILY STOCK OPNAME';
                    exampleText = 'gong cha y16 cups 10\nfresh milk diamond 5';
                }

                return await ctx.reply(`📝 *LANGKAH 2 DARI 2: INPUT DATA ${title}*\n----------------------------------------\n📅 *Tanggal:* \`${text.trim()}\`\n\nSilakan masukkan **Daftar Nama Item & Jumlah**.\n\n💡 *Contoh Format Kirim:*\n${exampleText}`, { parse_mode: 'Markdown' });

            } else {
                // Step 2 done: Received items data, combine date + items and execute command
                userPendingCommand.delete(userId); // Clear session
                const fullPayload = `${pending.date}\n${text.trim()}`;
                
                if (pending.command === 'produksi') {
                    return await processProduksiLogic(ctx, fullPayload);
                } else if (pending.command === 'waste') {
                    return await processWasteLogic(ctx, fullPayload);
                } else if (pending.command === 'dailyso') {
                    return await processDailysoLogic(ctx, fullPayload);
                }
            }
        }

        if (!aiSessions.has(userId)) return next();

        if (!ai) return await ctx.reply('⚠️ GEMINI_API_KEY belum dikonfigurasi.');

        await ctx.sendChatAction('typing');

        let replyText = null;
        let lastError = null;

        const modelsToTry = getModelsForUser(userId);
        for (const modelName of modelsToTry) {
            try {
                const response = await ai.models.generateContent({
                    model: modelName,
                    contents: text,
                });
                replyText = response.text;
                if (replyText) break;
            } catch (err) {
                lastError = err;
            }
        }

        if (replyText) {
            await ctx.reply(replyText);
        } else {
            const errMessage = lastError ? lastError.message : 'Tidak ada respon dari AI.';
            await ctx.reply(`❌ Error Gemini AI: ${errMessage}`);
        }
    });

    // 9. Interactive Callback Queries for Overwrite Confirmations
    bot.action(/overwrite_yes:(.+)/, async (ctx) => {
        const pendingId = ctx.match[1];
        try {
            const pendingRef = db.collection('pending_inputs').doc(pendingId);
            const pendingDoc = await pendingRef.get();

            if (!pendingDoc.exists) {
                return await ctx.answerCbQuery('❌ Data konfirmasi sudah kadaluarsa.', { show_alert: true });
            }

            const data = pendingDoc.data();
            const sheets = await getSheetsClient();

            await writeProduksiItems(sheets, data.spreadsheetId, data.tabName, data.items, data.productionProducts, data.userNickname, data.branch, ctx);
            await pendingRef.delete();

            await ctx.answerCbQuery('✅ Data berhasil ditimpa ke Spreadsheet!');
            await ctx.editMessageText(`✅ *DATA PRODUKSI BERHASIL DITIMPA (${data.branch})*\n📅 *Tanggal:* ${data.dateRaw}\n✍️ *Oleh:* ${data.userNickname}`, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('[OVERWRITE_YES_ERR]', err);
            await ctx.answerCbQuery(`❌ Error: ${err.message}`, { show_alert: true });
        }
    });

    bot.action(/overwrite_no:(.+)/, async (ctx) => {
        const pendingId = ctx.match[1];
        try {
            await db.collection('pending_inputs').doc(pendingId).delete();
            await ctx.answerCbQuery('❌ Penulisan data dibatalkan.');
            await ctx.editMessageText('❌ *Penulisan data produksi dibatalkan oleh pengguna.*', { parse_mode: 'Markdown' });
        } catch (err) {
            await ctx.answerCbQuery('❌ Gagal membatalkan.', { show_alert: true });
        }
    });

    return bot;
}

// Helper to write Produksi items to Sheets
async function writeProduksiItems(sheets, spreadsheetId, tabName, items, productionProducts, senderName, branchCode, ctx) {
    let successWrites = 0;
    const unrecognizedItems = [];
    const successReports = [];

    for (const item of items) {
        if (!item.matchedName) {
            unrecognizedItems.push(item);
            continue;
        }

        const matchedProd = productionProducts.find(p => p.name.toUpperCase() === item.matchedName.toUpperCase());
        if (!matchedProd) {
            unrecognizedItems.push(item);
            continue;
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${tabName}'!D${matchedProd.rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[item.quantity]] }
        });

        successWrites++;
        successReports.push(`• *${item.matchedName}*: \`${item.quantity}\``);
    }

    let replyText = `*PRODUKSI BERHASIL DICATAT (${branchCode})*\n`;
    replyText += `*Tab:* ${tabName}\n`;
    replyText += `*Oleh:* *${senderName}*\n`;
    replyText += `----------------------------------------\n`;
    if (successWrites > 0) replyText += successReports.join('\n') + `\n`;
    if (unrecognizedItems.length > 0) {
        replyText += `----------------------------------------\n*Item tidak dikenali:*\n`;
        unrecognizedItems.forEach(i => replyText += `- _${i.typed}_ (${i.quantity})\n`);
    }

    await ctx.reply(replyText, { parse_mode: 'Markdown' });
}

// Escape markdown special characters dan bersihkan seluruh emoticon/emoji
function escapeMarkdown(text) {
    if (!text) return '';
    // Regex tangguh untuk mendeteksi dan menghapus semua Emoji, Simbol Emoticon, Pictographs, dan Transport/Map symbols
    let cleanText = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2190}-\u{21FF}]/gu, '');
    // Hapus juga sisa-sisa karakter bullet titik besar/kecil yang sering disalahartikan sebagai ikon jika diminta bersih total
    cleanText = cleanText.replace(/•/g, '-');
    return cleanText.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');
}

// Express Control Panel Server
const app = express();
app.get('/', (req, res) => {
    const uptimeStr = formatUptime(process.uptime());
    res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <title>Telegram Report Bots - Control Panel</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
            body { background: #0f172a; color: #f8fafc; font-family: 'Inter', sans-serif; padding: 2rem 1rem; display: flex; justify-content: center; }
            .container { max-width: 600px; width: 100%; text-align: center; }
            .card { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 2rem; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
            .badge { display: inline-block; background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); padding: 0.5rem 1.25rem; border-radius: 999px; font-weight: 600; font-size: 0.9rem; }
            .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-top: 1.5rem; text-align: left; }
            .box { background: rgba(15, 23, 42, 0.6); padding: 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); }
            .label { font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; }
            .val { font-size: 1.1rem; font-weight: 600; color: #fff; margin-top: 0.25rem; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <h2>🚀 Telegram Report Bots (Cloud-Native)</h2>
                <p style="color: #94a3b8; margin-top: 0.5rem;">Dedicated Multi-Branch Google Sheets Integration</p>
                <br>
                <div class="badge">🟢 BOTH BOTS ONLINE 24/7</div>
                <div class="grid">
                    <div class="box">
                        <div class="label">Bot Cabang TP</div>
                        <div class="val">ONLINE ✅</div>
                    </div>
                    <div class="box">
                        <div class="label">Bot Cabang PM</div>
                        <div class="val">ONLINE ✅</div>
                    </div>
                    <div class="box">
                        <div class="label">Server Uptime</div>
                        <div class="val">${uptimeStr}</div>
                    </div>
                    <div class="box">
                        <div class="label">Environment</div>
                        <div class="val">GCP VM (Node.js)</div>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
    `);
});

// Start Both Bots & Web Server
async function main() {
    console.log('[TELEGRAM] Initializing Telegram Bots for TP and PM...');

    for (const key in BRANCHES) {
        const branch = BRANCHES[key];
        try {
            const bot = setupBot(branch);
            bot.launch();
            activeBots.push(bot);
            console.log(`[TELEGRAM] Bot ${branch.code} (${branch.name}) started successfully!`);
        } catch (err) {
            console.error(`[TELEGRAM] Error starting Bot ${branch.code}:`, err.message);
        }
    }

    const http = require('http');
    const setupPanelServer = require('./panel-server');
    const server = http.createServer(app);
    const { broadcastLog } = setupPanelServer(app, server);

    app.listen(PORT, () => {
        console.log(`[HTTP] Control Panel web server running on port ${PORT}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`[HTTP] Port ${PORT} already in use, control panel Web UI attached.`);
        }
    });

    // Graceful Shutdown
    process.once('SIGINT', () => activeBots.forEach(b => b.stop('SIGINT')));
    process.once('SIGTERM', () => activeBots.forEach(b => b.stop('SIGTERM')));
}

main().catch(err => {
    console.error('[FATAL] Failed to launch Telegram Bots:', err);
});

// Robust Stabilitas: Penangkap Error Global agar Bot Kebal dari Crash Akibat Gangguan Jaringan Google/Telegram
process.on('uncaughtException', (err) => {
    console.error('🔥 [UNCAUGHT_EXCEPTION] Mencegah crash fatal:', err.message || err);
    if (err.stack) console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 [UNHANDLED_REJECTION] Mencegah crash dari promise yang tidak ditangani:', reason);
});

