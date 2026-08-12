require('dotenv').config();

// --- IN-MEMORY LOG BUFFER FOR REALTIME TELEGRAM VIEW (SEPARATED BY BRANCH) ---
const logBuffers = {
    TP: [],
    PM: []
};
const MAX_LOG_LINES = 100;

function appendLog(branchCode, line) {
    if (!logBuffers[branchCode]) {
        logBuffers[branchCode] = [];
    }
    logBuffers[branchCode].push(line);
    if (logBuffers[branchCode].length > MAX_LOG_LINES) {
        logBuffers[branchCode].shift();
    }
}

function addLogToBuffer(type, args) {
    const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch (e) { return String(arg); }
        }
        return String(arg);
    }).join(' ');
    
    const logLine = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
    
    // Categorize logs: check if it belongs specifically to TP or PM
    const isTP = logLine.includes('BOT_TP') || logLine.includes('for TP') || logLine.includes('Bot TP') || logLine.includes('TP6');
    const isPM = logLine.includes('BOT_PM') || logLine.includes('for PM') || logLine.includes('Bot PM') || logLine.includes('PMS') || logLine.includes('PM:');
    
    if (isTP && !isPM) {
        appendLog('TP', logLine);
    } else if (isPM && !isTP) {
        appendLog('PM', logLine);
    } else {
        // Global/common logs are recorded in both bot buffers
        appendLog('TP', logLine);
        appendLog('PM', logLine);
    }
}

const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;

console.log = function (...args) {
    addLogToBuffer('log', args);
    originalLog.apply(console, args);
};
console.info = function (...args) {
    addLogToBuffer('info', args);
    originalInfo.apply(console, args);
};
console.warn = function (...args) {
    addLogToBuffer('warn', args);
    originalWarn.apply(console, args);
};
console.error = function (...args) {
    addLogToBuffer('error', args);
    originalError.apply(console, args);
};

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

// Robust Gemini Call with Timeout
async function generateContentWithTimeout(modelName, prompt, timeoutMs = 30000) {
    const apiCall = ai.models.generateContent({ model: modelName, contents: prompt });
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini API call timed out')), timeoutMs)
    );
    return Promise.race([apiCall, timeoutPromise]);
}

const db = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || undefined
});

// Candidate models for Gemini AI on Vertex AI Model Garden (Filtered for supported Vertex AI models)
const CANDIDATE_MODELS = [
    'gemini-2.5-flash',
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
        token: process.env.TELEGRAM_TOKEN_TP || '8797074812:AAFKn_1KdBb0XwH0SzXDM_XcFh3JGnjnpUk',
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
        token: process.env.TELEGRAM_TOKEN_PM || '8999763453:AAELmaxlgaENqwOcCqca_Rziu_oKVLGj334',
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

// Google Sheets Auth helper (High-Performance Cached Singleton)
let globalSheetsClient = null;

async function getSheetsClient() {
    if (globalSheetsClient) return globalSheetsClient;

    // 1. Coba Native GoogleAuth terlebih dahulu (Sangat Cepat & ada internal caching token)
    try {
        const auth = new google.auth.GoogleAuth({
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/cloud-platform'
            ]
        });
        const authClient = await auth.getClient();
        globalSheetsClient = google.sheets({ version: 'v4', auth: authClient, timeout: 10000 });
        console.log('[SHEETS_AUTH] Sukses menggunakan Native GoogleAuth (Sangat Cepat!).');
        return globalSheetsClient;
    } catch (e) {
        console.log('[SHEETS_AUTH] Native GoogleAuth belum terkonfigurasi, menggunakan fallback gcloud CLI...');
    }

    // 2. Fallback gcloud CLI (Hanya jika native GoogleAuth gagal / untuk local development)
    try {
        const { execSync } = require('child_process');
        const token = execSync('gcloud auth application-default print-access-token 2>/dev/null || gcloud auth print-access-token 2>/dev/null').toString().trim();
        if (token) {
            const oauth2Client = new google.auth.OAuth2();
            oauth2Client.setCredentials({ access_token: token });
            globalSheetsClient = google.sheets({ version: 'v4', auth: oauth2Client, timeout: 10000 });
            console.log('[SHEETS_AUTH] Sukses menggunakan fallback gcloud CLI token.');
            return globalSheetsClient;
        }
    } catch (e) {
        console.error('[SHEETS_AUTH] Fallback gcloud token fetch failed:', e.message);
    }

    throw new Error('Gagal mengautentikasi Google Sheets API.');
}

async function findTabName(sheets, spreadsheetId, day, year) {
    const standardTabName = `${day} - ${year}`;
    try {
        const metaRes = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties.title'
        });
        const sheetTitles = (metaRes.data.sheets || []).map(s => s.properties.title);
        
        if (sheetTitles.includes(standardTabName)) {
            return standardTabName;
        }

        const targetClean = `${day}-${year}`.replace(/\s+/g, '');
        const matchedTitle = sheetTitles.find(title => {
            return title.replace(/\s+/g, '') === targetClean;
        });

        if (matchedTitle) {
            console.log(`[TAB_RESOLVER] Fuzzy matched tab name "${standardTabName}" to actual sheet title "${matchedTitle}"`);
            return matchedTitle;
        }
    } catch (err) {
        console.warn(`[TAB_RESOLVER] Failed to fetch spreadsheet metadata: ${err.message}. Falling back to standard tab name.`);
    }
    return standardTabName;
}

function handleSheetsError(err) {
    if (!err) return;
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('auth') || msg.includes('token') || msg.includes('credential') || msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) {
        console.warn('[SHEETS_AUTH] Authentication/credential error detected. Clearing cached sheets client.', err.message);
        globalSheetsClient = null;
    }
}

const cleanString = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

function isSameProduct(name1, name2) {
    return cleanString(name1) === cleanString(name2);
}

// Fungsi Fuzzy Match Lokal (Levenshtein Distance) untuk Cost-Optimized Token Usage harian
function fuzzyMatchLokal(typedInput, daftarResmi) {
    const inputClean = cleanString(typedInput);
    if (!inputClean) return null;

    // Alias khusus untuk Fresh Milk / Plain Diamond / Susu / FM
    const freshMilkKeywords = ['freshmilk', 'fm', 'susu', 'diamond', 'freshmilkdiamond', 'susuplain', 'plaindiamond', 'freshmilkplain', 'susuplaindiamond'];
    if (freshMilkKeywords.includes(inputClean) || inputClean === 'freshmilk' || inputClean === 'fm' || inputClean === 'susu' || inputClean === 'diamond') {
        const fmMatch = daftarResmi.find(resmi => {
            const rLower = resmi.toLowerCase();
            return (rLower.includes('fresh milk') && rLower.includes('diamond')) ||
                   rLower.includes('fresh milk') ||
                   (rLower.includes('plain') && rLower.includes('diamond')) ||
                   rLower.includes('diamond');
        });
        if (fmMatch) return fmMatch;
    }

    let bestMatch = null;
    let highestScore = 0;

    for (const resmi of daftarResmi) {
        const resmiClean = cleanString(resmi);
        if (resmiClean === inputClean) {
            return resmi;
        }

        if (resmiClean.includes(inputClean) || inputClean.includes(resmiClean)) {
            const score = Math.min(resmiClean.length, inputClean.length) / Math.max(resmiClean.length, inputClean.length);
            if (score > highestScore) {
                highestScore = score;
                bestMatch = resmi;
            }
        }
    }

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

function getJakartaDateOffset(offsetDays = 0) {
    const now = new Date();
    now.setDate(now.getDate() - offsetDays);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: '2-digit',
        month: 'numeric',
        day: 'numeric'
    }).formatToParts(now);
    const day = parts.find(p => p.type === 'day').value;
    const month = parts.find(p => p.type === 'month').value;
    const year = parts.find(p => p.type === 'year').value;
    return `${parseInt(day, 10)}.${parseInt(month, 10)}.${year}`;
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

    // Track last update timestamp and started status
    branch.startedAt = Date.now();
    branch.lastUpdateTimestamp = null;
    bot.use(async (ctx, next) => {
        branch.lastUpdateTimestamp = Date.now();
        if (ctx.message && ctx.message.text) {
            console.log(`[BOT_${branch.code}] Recv: "${ctx.message.text}" from user: @${ctx.from?.username || 'none'} (${ctx.from?.id}), chat: ${ctx.chat?.title || 'private'} (${ctx.chat?.id})`);
        }
        return next();
    });

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

    // Automatically capture and store Group Chat ID
    bot.use(async (ctx, next) => {
        if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
            const branchCode = branch.code;
            try {
                await db.collection('telegram_chats').doc(branchCode).set({
                    chatId: ctx.chat.id,
                    title: ctx.chat.title || '',
                    updatedAt: new Date()
                }, { merge: true });
            } catch (err) {
                console.error(`[CHAT_ID_SAVE_ERR] Failed to save chat ID for ${branchCode}:`, err.message);
            }
        }
        return next();
    });

    // 1. /start & /help
    bot.command(['start', 'help'], async (ctx) => {
        const welcomeText = `Laporan Operasional ${branch.name.toUpperCase()}
----------------------------------------
Gunakan bot ini untuk menginput data operasional ke Google Sheets ${branch.code}.

Daftar Perintah Aktif:
- /produksi - Input Laporan Produksi Harian
- /waste - Input Laporan Waste
- /dailyso - Input Daily Stock Opname
- /checkprodwaste - Cek Laporan Produksi & Waste
- /checkdailyso - Cek Daily Stock Opname
- /morningbriefing - Format Morning Briefing
- /closingbriefing - Format Closing Briefing
- /testsheet - Uji Koneksi Spreadsheet
- /status - Cek Status Server

Contoh Pengisian Laporan:
/produksi
1.8.26
bt lokal 250
gt 100`.trim();
        await ctx.reply(welcomeText);
    });

    // 2. /status
    bot.command('status', async (ctx) => {
        const uptime = formatUptime(process.uptime());
        const mem = process.memoryUsage();
        const ramUsedMB = (mem.rss / (1024 * 1024)).toFixed(2);

        const statusText = `Status Telegram Bot (${branch.code})
----------------------------------------
Status: Online
Cabang: ${branch.name}
Lingkungan: GCP Compute Engine
Waktu Aktif: ${uptime}
Penggunaan Memory: ${ramUsedMB} MB
Waktu Server: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`.trim();
        await ctx.reply(statusText);
    });

    // 3. /testsheet
    bot.command('testsheet', async (ctx) => {
        await ctx.reply(`Testing Google Sheets API connection for ${branch.name}...`);
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

            await ctx.reply(`Koneksi Google Sheets ${branch.code} Berhasil\nTab: ${firstSheetTitle}\nRentang: ${updateRes.data.updatedRange}`);
        } catch (err) {
            console.error(`[TEST_SHEETS_${branch.code}] Error:`, err);
            handleSheetsError(err);
            await ctx.reply(`Gagal Koneksi Google Sheets: ${err.message}`);
        }
    });

    // 4. /checkprodwaste
    bot.command('checkprodwaste', async (ctx) => {
        const calendarDate = getJakartaCalendarDate();
        const days = getDaysToCheck(calendarDate.day);

        if (days.length === 0) {
            return await ctx.reply('Belum ada tanggal sebelum hari ini untuk diperiksa pada bulan ini.');
        }

        await ctx.reply(`Memeriksa data Produksi dan Waste ${branch.name}...`);

        try {
            const sheets = await getSheetsClient();
            const spreadsheetId = branch.spreadsheets.produksi;
            const metaRes = await sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets.properties.title'
            });
            const availableTabs = (metaRes.data.sheets || []).map(sheet => sheet.properties.title);
            const findActualTabName = (day, year) => {
                const standard = `${day} - ${year}`;
                if (availableTabs.includes(standard)) return standard;
                const cleanTarget = `${day}-${year}`.replace(/\s+/g, '');
                return availableTabs.find(t => t.replace(/\s+/g, '') === cleanTarget) || null;
            };

            const existingDaysInfo = [];
            const missingTabs = [];
            days.forEach(day => {
                const resolved = findActualTabName(day, calendarDate.year);
                if (resolved) {
                    existingDaysInfo.push({ day, tabName: resolved });
                } else {
                    missingTabs.push(day);
                }
            });

            const missingProduction = [...missingTabs];
            const missingWaste = [...missingTabs];

            if (existingDaysInfo.length > 0) {
                const ranges = existingDaysInfo.map(info => `'${info.tabName}'!B1:D120`);
                const result = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });

                (result.data.valueRanges || []).forEach((valueRange, index) => {
                    const info = existingDaysInfo[index];
                    const status = getProductionWasteStatus(valueRange.values || []);
                    if (!status.productionFilled) {
                        missingProduction.push(info.day);
                        if (!status.wasteFilled) {
                            missingWaste.push(info.day);
                        }
                    }
                });
            }

            const period = formatCheckPeriod(days, calendarDate);
            let replyText = `Cek Produksi & Waste (${branch.code})\n`;
            replyText += `Periode: ${period}\n`;
            replyText += `----------------------------------------\n`;

            if (missingProduction.length === 0 && missingWaste.length === 0) {
                replyText += 'Semua tanggal pada periode ini telah terisi.';
            } else {
                replyText += 'Tanggal belum terisi:\n';
                replyText += `- Produksi: ${formatDayList(missingProduction)}\n`;
                replyText += `- Waste: ${formatDayList(missingWaste)}`;
                if (missingTabs.length > 0) {
                    replyText += `\n- Tab belum tersedia: ${formatDayList(missingTabs)}`;
                }
            }

            await ctx.reply(replyText);
        } catch (err) {
            console.error(`[CHECK_PROD_WASTE_${branch.code}] Error:`, err);
            handleSheetsError(err);
            await ctx.reply(`Gagal mengecek Produksi/Waste: ${err.message}`);
        }
    });

    // 5. /checkdailyso
    bot.command('checkdailyso', async (ctx) => {
        const calendarDate = getJakartaCalendarDate();
        const days = getDaysToCheck(calendarDate.day);

        if (days.length === 0) {
            return await ctx.reply('Belum ada tanggal sebelum hari ini untuk diperiksa pada bulan ini.');
        }

        await ctx.reply(`Memeriksa Daily SO ${branch.name}...`);

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
                return await ctx.reply(`Tidak menemukan tab pada spreadsheet Daily SO ${branch.name}.`);
            }

            const monthStr = String(calendarDate.month);
            const monthPad = monthStr.padStart(2, '0');
            const yrShort = calendarDate.year.toString().slice(-2);
            const candidates = [
                `${monthStr} - ${calendarDate.year}`,
                `${monthPad} - ${calendarDate.year}`,
                `${monthStr} - ${yrShort}`,
                `${monthPad} - ${yrShort}`
            ];
            const targetTab = sheetTitles.find(t => candidates.includes(t)) || defaultTab;

            const targets = days.map(day => {
                const columnLetter = colIndexToLetter(3 + day);
                return { day, tabName: targetTab, columnLetter };
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
            let replyText = `Cek Daily SO (${branch.code})\n`;
            replyText += `Periode: ${period}\n`;
            replyText += `----------------------------------------\n`;
            replyText += missingDays.length === 0
                ? 'Semua tanggal pada periode ini telah terisi.'
                : `Tanggal belum terisi: ${formatDayList(missingDays)}`;

            await ctx.reply(replyText);
        } catch (err) {
            console.error(`[CHECK_DAILYSO_${branch.code}] Error:`, err);
            handleSheetsError(err);
            await ctx.reply(`Gagal mengecek Daily SO: ${err.message}`);
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

        try {
            const sheets = await getSheetsClient();
            const spreadsheetId = branch.spreadsheets.produksi;
            const tabName = await findTabName(sheets, spreadsheetId, day, year);

            await ctx.reply(`⏳ Menghubungkan ke Spreadsheet *${branch.name}*, Tab: *"${tabName}"*...`, { parse_mode: 'Markdown' });

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
SANGAT PENTING: RESPON HANYA DALAM FORMAT JSON VALID. DILARANG MENAMBAHKAN TEKS PENJELASAN.

Anda adalah AI parser laporan produksi toko minuman.
Tugas Anda:
1. Analisis input:
"""
${inputLines.join('\n')}
"""
2. Cocokkan nama item yang diketik staff ke daftar nama produk RESMI yang ada di spreadsheet:
${JSON.stringify(validProductNamesList, null, 2)}

Aturan Penting Alias Shorthand:
- "freshmilk", "fresh milk", "fm", "susu", "diamond", "plain diamond" WAJIB dicocokkan ke nama produk resmi "FRESH MILK -  PLAIN DIAMOND 946ML" (atau produk resmi yang mengandung FRESH MILK / DIAMOND).

3. JSON Output bersih:
{
  "items": [
    { "typed": "nama_input", "matchedName": "NAMA_RESMI", "quantity": angka }
  ]
}
            `.trim();

                for (const modelName of CANDIDATE_MODELS) {
                    try {
                        const response = await generateContentWithTimeout(modelName, prompt);
                        const rawText = response.text || '';
                        aiResult = parseJsonFromAi(rawText);
                        if (aiResult && Array.isArray(aiResult.items)) break;
                    } catch (err) {
                        console.warn(`[GEMINI_${modelName}] Failed:`, err.message);
                    }
                }
            }

            if (!aiResult || !Array.isArray(aiResult.items)) {
                return await ctx.reply(`❌ Gagal memparsing input produksi dengan AI.`);
            }

            const matchedOfficialItems = aiResult.items.filter(item => item.matchedName);
            const itemsWithConflict = [];

            for (const item of matchedOfficialItems) {
                const targetProd = productionProducts.find(p => isSameProduct(p.name, item.matchedName));
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
            handleSheetsError(err);
            await ctx.reply(`❌ Terjadi kesalahan fatal: ${err.message}`);
        }
    }

    const pendingDrafts = new Map();

    async function prepareDraftAndConfirm(ctx, commandType, inputText) {
        if (!ai) {
            return await ctx.reply('Gemini API key belum dikonfigurasi.');
        }

        const senderName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'User');
        const inputLines = inputText.split('\n').map(l => l.trim()).filter(Boolean);

        if (inputLines.length === 0) {
            let cmdTitle = 'Produksi';
            let exampleStr = `/${commandType}\n3.8.26\npearl 2\nbt lokal 3`;
            if (commandType === 'waste') {
                cmdTitle = 'Waste';
                exampleStr = `/waste\n3.8.26\nbt lokal 10\ngt 5`;
            } else if (commandType === 'dailyso') {
                cmdTitle = 'Daily Stock Opname';
                exampleStr = `/dailyso\n3.8.26\ngong cha y16 cups 10\nfresh milk diamond 5`;
            }

            return await ctx.reply(
                `Panduan Pengisian Laporan ${cmdTitle}\n\n` +
                `Kirimkan laporan Anda dalam satu pesan dengan format berikut:\n\n` +
                `${exampleStr}\n\n` +
                `Format:\n` +
                `Baris 1: Perintah (/${commandType})\n` +
                `Baris 2: Tanggal\n` +
                `Baris 3 dan seterusnya: Nama item dan jumlah\n\n` +
                `Ringkasan data akan ditampilkan terlebih dahulu untuk dikonfirmasi.`
            );
        }

        const dateRaw = inputLines.shift();
        const dateParts = dateRaw.split(/[./-]/);
        if (dateParts.length < 3) {
            return await ctx.reply('Format tanggal tidak valid pada baris pertama. Gunakan format seperti 3.8.26');
        }

        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10);
        const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];

        let spreadsheetId = '';
        if (commandType === 'produksi') spreadsheetId = branch.spreadsheets.produksi;
        else if (commandType === 'waste') spreadsheetId = branch.spreadsheets.waste;
        else if (commandType === 'dailyso') spreadsheetId = branch.spreadsheets.dailyso;

        await ctx.sendChatAction('typing');

        try {
            const sheets = await getSheetsClient();
            let tabName = '';
            if (commandType !== 'dailyso') {
                tabName = await findTabName(sheets, spreadsheetId, day, year);
            }
            let validProductNamesList = [];

            if (commandType === 'dailyso') {
                const metaRes = await sheets.spreadsheets.get({
                    spreadsheetId,
                    fields: 'sheets.properties.title'
                });
                const sheetTitles = (metaRes.data.sheets || []).map(s => s.properties.title);
                const defaultTab = sheetTitles[0];

                const monthStr = String(month);
                const monthPad = monthStr.padStart(2, '0');
                const yrShort = year.toString().slice(-2);
                const candidates = [
                    `${monthStr} - ${year}`,
                    `${monthPad} - ${year}`,
                    `${monthStr} - ${yrShort}`,
                    `${monthPad} - ${yrShort}`
                ];
                const targetTab = sheetTitles.find(t => candidates.includes(t)) || defaultTab;

                const readRes = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `'${targetTab}'!B1:C150`
                });
                const rows = readRes.data.values || [];
                validProductNamesList = rows.map(r => String(r[0] || '').trim()).filter(n => n && !n.startsWith('---') && !n.includes('NAMA ITEM'));
            } else {
                const readRes = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `'${tabName}'!B1:D120`
                });
                const rows = readRes.data.values || [];
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const prodName = String(row[0] || '').trim();
                    if (prodName && !prodName.startsWith('---') && !prodName.includes('NAMA PRODUK') && !prodName.includes('KODE')) {
                        validProductNamesList.push(prodName);
                    }
                }
            }

            // Run Hybrid Pre-Parser / Gemini AI
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
                        preParsedItems.push({ typed: typedName, matchedName, quantity });
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
                aiResult = { items: preParsedItems };
            } else {
                const prompt = `
SANGAT PENTING: RESPON HANYA DALAM FORMAT JSON VALID. DILARANG MENAMBAHKAN TEKS PENJELASAN.
Anda adalah AI parser laporan operasional toko minuman.
Tugas Anda:
1. Analisis input:
"""
${inputLines.join('\n')}
"""
2. Cocokkan nama item yang diketik staff ke daftar nama produk RESMI:
${JSON.stringify(validProductNamesList, null, 2)}

Aturan Penting Alias Shorthand:
- "freshmilk", "fresh milk", "fm", "susu", "diamond", "plain diamond" WAJIB dicocokkan ke produk resmi "FRESH MILK -  PLAIN DIAMOND 946ML" (atau produk resmi yang mengandung FRESH MILK / DIAMOND).

3. JSON Output bersih:
{
  "items": [
    { "typed": "nama_input", "matchedName": "NAMA_RESMI", "quantity": angka }
  ]
}
                `.trim();

                for (const modelName of CANDIDATE_MODELS) {
                    try {
                        const response = await generateContentWithTimeout(modelName, prompt);
                        aiResult = parseJsonFromAi(response.text || '');
                        if (aiResult && Array.isArray(aiResult.items)) break;
                    } catch (e) {
                        console.warn(`[GEMINI_${modelName}] Failed:`, e.message);
                    }
                }
            }

            if (!aiResult || !Array.isArray(aiResult.items) || aiResult.items.length === 0) {
                return await ctx.reply('Data item tidak dapat dibaca. Pastikan memasukkan nama item dan jumlah dengan jelas.');
            }

            // Save draft ID
            const draftId = `draft_${Date.now()}_${ctx.from.id}`;
            pendingDrafts.set(draftId, {
                commandType,
                dateRaw,
                inputLines,
                rawInput: inputText,
                senderName,
                userId: ctx.from.id,
                items: aiResult.items,
                createdAt: Date.now()
            });

            // Format summary items
            let itemsSummary = '';
            aiResult.items.forEach(item => {
                if (item.matchedName) {
                    itemsSummary += `- ${item.matchedName}: ${item.quantity}\n`;
                } else {
                    itemsSummary += `- ${item.typed} (Tidak Dikenal): ${item.quantity}\n`;
                }
            });

            let titleStr = commandType === 'produksi' ? 'Produksi' : (commandType === 'waste' ? 'Waste' : 'Daily Stock Opname');

            const previewText = `Konfirmasi Laporan ${titleStr}

Tanggal: ${dateRaw}
Pengirim: ${senderName}

Rincian Item:
${itemsSummary.trim()}

Periksa kembali rincian data di atas sebelum disimpan.`;

            await ctx.reply(previewText, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'Simpan', callback_data: `confirm_save:${draftId}` },
                            { text: 'Batal', callback_data: `confirm_cancel:${draftId}` }
                        ],
                        [
                            { text: 'Edit Data', callback_data: `confirm_edit:${draftId}` }
                        ]
                    ]
                }
            });

        } catch (err) {
            console.error('[PREPARE_DRAFT_ERR]', err);
            return await ctx.reply(`Terjadi kesalahan saat memeriksa data: ${err.message}`);
        }
    }

    // 6. /produksi
    bot.command('produksi', async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift();
        const inputText = lines.join('\n').trim();

        return await prepareDraftAndConfirm(ctx, 'produksi', inputText);
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

        try {
            const sheets = await getSheetsClient();
            const spreadsheetId = branch.spreadsheets.waste;
            const tabName = await findTabName(sheets, spreadsheetId, day, year);

            await ctx.reply(`⏳ Menghubungkan ke Spreadsheet *${branch.name}* (Waste), Tab: *"${tabName}"*...`, { parse_mode: 'Markdown' });

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
Anda adalah AI parser laporan waste toko minuman.
Tugas Anda:
1. Analisis input:
"""
${inputLines.join('\n')}
"""
2. Cocokkan nama item yang diketik staff ke daftar nama produk RESMI yang ada di spreadsheet:
${JSON.stringify(validProductNamesList, null, 2)}

Aturan Penting Alias Shorthand:
- "freshmilk", "fresh milk", "fm", "susu", "diamond", "plain diamond" WAJIB dicocokkan ke nama produk resmi "FRESH MILK -  PLAIN DIAMOND 946ML" (atau produk resmi yang mengandung FRESH MILK / DIAMOND).

3. JSON Output bersih:
{
  "items": [
    { "typed": "nama_input", "matchedName": "NAMA_RESMI", "quantity": angka }
  ]
}
                `.trim();

                for (const modelName of CANDIDATE_MODELS) {
                    try {
                        const response = await generateContentWithTimeout(modelName, prompt);
                        const rawText = response.text || '';
                        aiResult = parseJsonFromAi(rawText);
                        if (aiResult && Array.isArray(aiResult.items)) break;
                    } catch (err) {
                        console.warn(`[GEMINI_${modelName}] Failed:`, err.message);
                    }
                }
            }

            if (!aiResult || !Array.isArray(aiResult.items)) {
                return await ctx.reply(`❌ Gagal memparsing input waste dengan AI.`);
            }

            // Direct Write Waste
            let successWrites = 0;
            const unrecognizedItems = [];
            const successReports = [];
            const updateData = [];

            for (const item of aiResult.items) {
                if (!item.matchedName) {
                    unrecognizedItems.push(item);
                    continue;
                }
                const matchedProd = wasteProducts.find(p => isSameProduct(p.name, item.matchedName));
                if (!matchedProd) {
                    unrecognizedItems.push(item);
                    continue;
                }

                updateData.push({
                    range: `'${tabName}'!D${matchedProd.rowIndex}`,
                    values: [[item.quantity]]
                });

                successWrites++;
                successReports.push(`• *${item.matchedName}*: \`${item.quantity}\``);
            }

            if (updateData.length > 0) {
                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        valueInputOption: 'USER_ENTERED',
                        data: updateData
                    }
                });
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
            handleSheetsError(err);
            await ctx.reply(`❌ Error: ${err.message}`);
        }
    }

    // 5. /waste
    bot.command('waste', async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift();
        const inputText = lines.join('\n').trim();

        return await prepareDraftAndConfirm(ctx, 'waste', inputText);
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
        const month = parseInt(dateParts[1], 10);
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

            const monthStr = String(month);
            const monthPad = monthStr.padStart(2, '0');
            const yrShort = year.toString().slice(-2);
            const candidates = [
                `${monthStr} - ${year}`,
                `${monthPad} - ${year}`,
                `${monthStr} - ${yrShort}`,
                `${monthPad} - ${yrShort}`
            ];

            let targetTab = allSheets[0].properties.title;
            const matchedSheet = allSheets.find(s => candidates.includes(s.properties.title));
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
SANGAT PENTING: RESPON HANYA DALAM FORMAT JSON VALID. DILARANG MENAMBAHKAN TEKS PENJELASAN.

Anda adalah AI parser laporan Stock Opname (SO) harian toko minuman.
Tugas Anda:
1. Analisis data input:
"""
${inputLines.join('\n')}
"""

2. Cocokkan nama item yang diketik staff ke daftar nama produk RESMI yang ada di spreadsheet:
${JSON.stringify(validProductNamesList, null, 2)}

Aturan Penting Pencocokan Alias Shorthand:
- "freshmilk", "fresh milk", "fm", "susu", "diamond", "plain diamond" WAJIB dicocokkan ke nama produk resmi "FRESH MILK -  PLAIN DIAMOND 946ML" (atau produk resmi yang mengandung FRESH MILK / DIAMOND).
- Lakukan fuzzy matching pintar untuk singkatan lainnya.

3. Keluarkan hasil analisis dalam format JSON bersih:
{
  "items": [
    { "typed": "nama_input_staff", "matchedName": "NAMA_RESMI_DI_SPREADSHEET", "quantity": angka_jumlah }
  ]
}
                `.trim();

                for (const modelName of CANDIDATE_MODELS) {
                    try {
                        const response = await generateContentWithTimeout(modelName, prompt);
                        const rawText = response.text || '';
                        aiResult = parseJsonFromAi(rawText);
                        if (aiResult && Array.isArray(aiResult.items)) break;
                    } catch (err) {
                        console.warn(`[GEMINI_${modelName}] Failed:`, err.message);
                    }
                }
            }

            if (!aiResult || !Array.isArray(aiResult.items)) {
                return await ctx.reply(`❌ Gagal memparsing input Daily SO dengan AI.`);
            }

            // Direct Write
            let successWrites = 0;
            const unrecognizedItems = [];
            const successReports = [];
            const updateData = [];

            for (const item of aiResult.items) {
                if (!item.matchedName) {
                    unrecognizedItems.push(item);
                    continue;
                }
                const matchedProd = validProducts.find(p => isSameProduct(p.name, item.matchedName));
                if (!matchedProd) {
                    unrecognizedItems.push(item);
                    continue;
                }

                updateData.push({
                    range: `'${targetTab}'!${colLetter}${matchedProd.rowIndex}`,
                    values: [[item.quantity]]
                });

                successWrites++;
                successReports.push(`• *${item.matchedName}*: \`${item.quantity}\``);
            }

            if (updateData.length > 0) {
                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        valueInputOption: 'USER_ENTERED',
                        data: updateData
                    }
                });
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
            handleSheetsError(err);
            await ctx.reply(`❌ Error: ${err.message}`);
        }
    }

    // 5.5. /dailyso
    bot.command('dailyso', async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift();
        const inputText = lines.join('\n').trim();

        return await prepareDraftAndConfirm(ctx, 'dailyso', inputText);
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

    // 8. /ai
    bot.command('ai', async (ctx) => {
        const fullText = ctx.message.text || '';
        const prompt = fullText.replace(/^\/ai(@\w+)?\s*/i, '').trim();
        const userId = ctx.from.id;

        aiSessions.set(userId, { active: true });

        if (!prompt) {
            return await ctx.reply('Mode Diskusi AI Aktif.\n\nSemua pesan teks selanjutnya akan dijawab oleh Gemini AI.\n\nKetik /esc atau /exit untuk keluar dari AI mode.');
        }

        if (!ai) return await ctx.reply('Gemini API key belum dikonfigurasi.');

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
            await ctx.reply(`${replyText}\n\nMode Diskusi AI Aktif. Ketik /esc untuk keluar.`);
        } else {
            const errMessage = lastError ? lastError.message : 'Tidak ada respon dari AI.';
            await ctx.reply(`Error Gemini AI: ${errMessage}`);
        }
    });

    // 9. /model
    bot.command('model', async (ctx) => {
        const currentModel = userSelectedModel.get(ctx.from.id) || 'gemini-2.5-flash';
        const text = `Pilih Model Gemini AI\n----------------------------------------\nModel aktif saat ini: ${currentModel}\n\nPilih model yang ingin digunakan:`;

        await ctx.reply(text, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback('Gemini 3.6 Flash', 'set_model:gemini-3.6-flash')],
                [Markup.button.callback('Gemini 3.5 Flash', 'set_model:gemini-3.5-flash')],
                [Markup.button.callback('Gemini 3.5 Flash-Lite', 'set_model:gemini-3.5-flash-lite')],
                [Markup.button.callback('Gemini 3.1 Pro Preview', 'set_model:gemini-3.1-pro-preview')],
                [Markup.button.callback('Gemini 3.1 Flash-Lite', 'set_model:gemini-3.1-flash-lite')],
                [Markup.button.callback('Gemini 3 Flash Preview', 'set_model:gemini-3-flash-preview')],
                [Markup.button.callback('Gemini 2.5 Flash', 'set_model:gemini-2.5-flash')],
                [Markup.button.callback('Gemini 2.5 Pro', 'set_model:gemini-2.5-pro')],
                [Markup.button.callback('Gemini 2.5 Flash-Lite', 'set_model:gemini-2.5-flash-lite')]
            ])
        });
    });

    bot.action(/set_model:(.+)/, async (ctx) => {
        const selectedModel = ctx.match[1];
        userSelectedModel.set(ctx.from.id, selectedModel);
        await ctx.answerCbQuery(`Model diubah ke ${selectedModel}`);
        await ctx.editMessageText(`Model Gemini AI berhasil diubah ke: ${selectedModel}`);
    });

    // 10. /esc & /exit
    bot.command(['esc', 'exit', 'stop'], async (ctx) => {
        const userId = ctx.from.id;
        if (aiSessions.has(userId)) {
            aiSessions.delete(userId);
            await ctx.reply('Keluar dari mode Diskusi AI.');
        } else {
            await ctx.reply('Anda sedang tidak dalam mode Diskusi AI.');
        }
    });

    // 11. /usage
    bot.command('usage', async (ctx) => {
        try {
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

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

            const replyText = `Laporan Pemakaian Token AI
----------------------------------------
Hari Ini:
- Input Tokens: ${todayPrompt.toLocaleString('id-ID')}
- Output Tokens: ${todayCandidate.toLocaleString('id-ID')}
- Total Tokens: ${todayTotal.toLocaleString('id-ID')}
- Estimasi Biaya: ~$${estCostTodayUSD} (Rp ${estCostTodayIDR.toLocaleString('id-ID')})

7 Hari Terakhir:
- Input Tokens: ${weekPrompt.toLocaleString('id-ID')}
- Output Tokens: ${weekCandidate.toLocaleString('id-ID')}
- Total Tokens: ${weekTotal.toLocaleString('id-ID')}`;

            await ctx.reply(replyText);
        } catch (err) {
            console.error('[USAGE_CMD_ERR]', err);
            await ctx.reply(`Gagal mengambil data pemakaian: ${err.message}`);
        }
    });

    // 12. /credit
    bot.command('credit', async (ctx) => {
        const text = `Status Kredit GCP & Vertex AI
----------------------------------------
Provider: Google Cloud Platform (GCP)
Layanan: Vertex AI

Estimasi Biaya Model Gemini Flash:
- Input: ~$0.075 per 1.000.000 tokens
- Output: ~$0.30 per 1.000.000 tokens

Konsol Billing GCP: https://console.cloud.google.com/billing`;

        await ctx.reply(text);
    });

    // Helper function to check if the sender is a configured admin username or user ID (regardless of chat type)
    async function checkIfAdmin(ctx) {
        try {
            const allowedUsernames = (process.env.ADMIN_USERNAMES || 'justchaniago,ferryruslychaniago,justchngo').split(',').map(u => u.trim().toLowerCase().replace('@', ''));
            const allowedUserIds = (process.env.ADMIN_USER_IDS || '6480500972').split(',').map(id => id.trim());
            
            const username = String(ctx.from?.username || '').toLowerCase();
            const userId = String(ctx.from?.id || '');
            
            return allowedUsernames.includes(username) || allowedUserIds.includes(userId);
        } catch (e) {
            console.error('[ADMIN_CHECK_ERR]', e);
            return false;
        }
    }

    // Helper to translate logs to friendly human language
    function formatLogToHuman(line) {
        try {
            const tsMatch = line.match(/^\[([^\]]+)\]\s+\[([A-Z]+)\]\s+(.+)$/i);
            if (!tsMatch) return line;
            
            const timestamp = tsMatch[1];
            const message = tsMatch[3];
            
            // 1. Recv command log
            const recvMatch = message.match(/^\[BOT_([^\]]+)\]\s+Recv:\s+"([^"]+)"\s+from\s+user:\s+@?([^\s(]+)\s+\(([^)]+)\),\s+chat:\s+([^(]+)\s+\(([^)]+)\)/i);
            if (recvMatch) {
                const branch = recvMatch[1];
                const cmd = recvMatch[2];
                const user = recvMatch[3];
                const chat = recvMatch[5].trim();
                const chatType = chat === 'private' ? 'Personal Chat' : `Grup ${chat}`;
                return `🕒 [${timestamp}] Bot ${branch}: Menerima perintah "${cmd}" dari @${user} di ${chatType}`;
            }
            
            // 2. Startup log
            const startMatch = message.match(/^\[TELEGRAM\]\s+Bot\s+([^\s]+)\s+\(([^)]+)\)\s+started\s+successfully/i);
            if (startMatch) {
                return `🕒 [${timestamp}] Bot ${startMatch[1]}: Berhasil dinyalakan & siap digunakan.`;
            }
            
            // 3. Permission denied log
            if (message.includes('PERMISSION_DENIED') || message.includes('insufficient permissions')) {
                return `🕒 [${timestamp}] Sistem: Gagal menyimpan data (Izin Firestore ditolak).`;
            }
            
            const cleanMessage = message.replace(/^\[([^\]]+)\]\s*/, '');
            return `🕒 [${timestamp}] Info: ${cleanMessage}`;
        } catch (e) {
            return line;
        }
    }

    // Admin Command: View Real-Time System Logs
    bot.command(['syslogs', 'syslog'], async (ctx) => {
        if (!(await checkIfAdmin(ctx))) {
            return await ctx.reply('⚠️ Perintah ini hanya dapat dijalankan oleh Administrator.');
        }

        const linesCount = 3;
        const branchLogBuffer = logBuffers[branch.code] || [];
        const recentLogs = branchLogBuffer.slice(-linesCount);
        
        if (recentLogs.length === 0) {
            return await ctx.reply('📝 Log saat ini masih kosong.');
        }

        const formattedLogs = recentLogs.map(formatLogToHuman).join('\n\n');
        await ctx.reply(`📋 STATUS LOG SYSTEM TERBARU:\n\n${formattedLogs}`);
    });

    // Admin Command: Force System Restart
    bot.command(['sysrestart', 'sysrst'], async (ctx) => {
        if (!(await checkIfAdmin(ctx))) {
            return await ctx.reply('⚠️ Perintah ini hanya dapat dijalankan oleh Administrator.');
        }

        await ctx.reply('🔄 Melakukan restart system bot. Layanan akan aktif kembali secara otomatis...');
        console.log(`[SYSTEM] Force restart initiated by Admin: @${ctx.from.username || ctx.from.id}`);
        
        setTimeout(() => {
            process.exit(0);
        }, 1500);
    });

    // Callback Action Handlers for Draft Confirmation Stage
    bot.action(/^confirm_save:(.+)$/, async (ctx) => {
        try {
            await ctx.answerCbQuery('Memproses simpan...');
        } catch (e) {}

        const draftId = ctx.match[1];
        const draft = pendingDrafts.get(draftId);

        if (!draft) {
            return await ctx.editMessageText('Sesi konfirmasi telah berakhir. Silakan kirim ulang laporan.');
        }

        if (ctx.from.id !== draft.userId) {
            try {
                return await ctx.answerCbQuery('Hanya pengirim yang dapat menyimpan data ini.', { show_alert: true });
            } catch (e) { return; }
        }

        await ctx.editMessageText('Sedang menyimpan data laporan ke spreadsheet...');

        try {
            const fullPayload = `${draft.dateRaw}\n${draft.inputLines.join('\n')}`;

            if (draft.commandType === 'produksi') {
                await processProduksiLogic(ctx, fullPayload);
            } else if (draft.commandType === 'waste') {
                await processWasteLogic(ctx, fullPayload);
            } else if (draft.commandType === 'dailyso') {
                await processDailysoLogic(ctx, fullPayload);
            }

            pendingDrafts.delete(draftId);

        } catch (err) {
            console.error('[CONFIRM_SAVE_ERR]', err);
            await ctx.reply(`Gagal menyimpan data: ${err.message}`);
        }
    });

    bot.action(/^confirm_cancel:(.+)$/, async (ctx) => {
        try {
            await ctx.answerCbQuery('Dibatalkan');
        } catch (e) {}

        const draftId = ctx.match[1];
        const draft = pendingDrafts.get(draftId);

        if (draft) {
            if (ctx.from.id !== draft.userId) {
                try {
                    return await ctx.answerCbQuery('Hanya pengirim yang dapat membatalkan ini.', { show_alert: true });
                } catch (e) { return; }
            }
            pendingDrafts.delete(draftId);
        }

        await ctx.editMessageText('Proses pengisian laporan telah dibatalkan. Data tidak disimpan ke spreadsheet.');
    });

    bot.action(/^confirm_edit:(.+)$/, async (ctx) => {
        try {
            await ctx.answerCbQuery('Format edit disiapkan');
        } catch (e) {}

        const draftId = ctx.match[1];
        const draft = pendingDrafts.get(draftId);

        if (!draft) {
            return await ctx.editMessageText('Sesi konfirmasi telah berakhir. Silakan kirim ulang laporan.');
        }

        if (ctx.from.id !== draft.userId) {
            try {
                return await ctx.answerCbQuery('Hanya pengirim yang dapat mengedit data ini.', { show_alert: true });
            } catch (e) { return; }
        }

        const cmdName = draft.commandType;
        const copyText = `/${cmdName}\n${draft.rawInput}`;

        // Prompt 1: Instruction
        await ctx.editMessageText('Silakan salin data berikut untuk diedit:');

        // Prompt 2: Raw data without any extra text or markdown formatting
        await ctx.reply(copyText);
    });

    // 11. Handle continuous text for Pending Commands or AI Chat Mode
    bot.on('text', async (ctx, next) => {
        const text = (ctx.message.text || '').trim();
        if (text.startsWith('/')) return next();

        const userId = ctx.from.id;
        const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
        const chatType = ctx.chat.type;

        console.log(`[TEXT_RECEIVE] From: @${userName} (${userId}) in ${chatType}. Text: "${text}". HasPending: ${userPendingCommand.has(userId)}`);

        const replyTo = ctx.message.reply_to_message;
        const repliedMsgText = replyTo ? (replyTo.text || replyTo.caption || '') : '';

        // --- STATELESS PARSER VIA REPLY_TO_MESSAGE ---
        if (repliedMsgText.includes('LANGKAH 1 DARI 2')) {
            let command = null;
            let title = '';
            let exampleText = '';

            if (repliedMsgText.includes('PRODUKSI')) {
                command = 'produksi';
                title = 'PRODUKSI';
                exampleText = 'bt lokal 250\ngt 100\nherbal jelly 5';
            } else if (repliedMsgText.includes('WASTE')) {
                command = 'waste';
                title = 'WASTE (DIBUANG)';
                exampleText = 'bt lokal 10\ngt 5\nherbal jelly 2';
            } else if (repliedMsgText.includes('DAILY STOCK OPNAME') || repliedMsgText.includes('DAILYSO')) {
                command = 'dailyso';
                title = 'DAILY STOCK OPNAME';
                exampleText = 'gong cha y16 cups 10\nfresh milk diamond 5';
            }

            if (command) {
                if (text.includes('\n')) {
                    if (command === 'produksi') return await processProduksiLogic(ctx, text);
                    if (command === 'waste') return await processWasteLogic(ctx, text);
                    if (command === 'dailyso') return await processDailysoLogic(ctx, text);
                }

                userPendingCommand.set(userId, { command, step: 'items', date: text, timestamp: Date.now() });

                return await ctx.reply(
                    `📝 *LANGKAH 2 DARI 2: INPUT DATA ${title}*\n` +
                    `----------------------------------------\n` +
                    `📅 *Tanggal:* \`${text}\`\n\n` +
                    `Silakan **balas (REPLY) pesan ini** dengan memasukkan **Daftar Nama Item & Jumlah**.\n\n` +
                    `💡 *Contoh Format Kirim:*\n${exampleText}`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: { force_reply: true, selective: true }
                    }
                );
            }
        }

        if (repliedMsgText.includes('LANGKAH 2 DARI 2')) {
            let command = null;
            if (repliedMsgText.includes('PRODUKSI')) command = 'produksi';
            else if (repliedMsgText.includes('WASTE')) command = 'waste';
            else if (repliedMsgText.includes('DAILY STOCK OPNAME') || repliedMsgText.includes('DAILYSO')) command = 'dailyso';

            if (command) {
                userPendingCommand.delete(userId);
                const dateMatch = repliedMsgText.match(/📅\s*\*Tanggal:\*\s*`?([^`\n]+)`?/);
                const extractedDate = dateMatch ? dateMatch[1].trim() : getJakartaDateOffset(0);
                const fullPayload = `${extractedDate}\n${text}`;

                if (command === 'produksi') return await processProduksiLogic(ctx, fullPayload);
                if (command === 'waste') return await processWasteLogic(ctx, fullPayload);
                if (command === 'dailyso') return await processDailysoLogic(ctx, fullPayload);
            }
        }

        // --- IN-MEMORY SESSION FALLBACK ---
        if (userPendingCommand.has(userId)) {
            const pending = userPendingCommand.get(userId);

            if (pending.step === 'date') {
                userPendingCommand.set(userId, { command: pending.command, step: 'items', date: text, timestamp: Date.now() });

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

                return await ctx.reply(
                    `📝 *LANGKAH 2 DARI 2: INPUT DATA ${title}*\n` +
                    `----------------------------------------\n` +
                    `📅 *Tanggal:* \`${text}\`\n\n` +
                    `Silakan **balas (REPLY) pesan ini** dengan memasukkan **Daftar Nama Item & Jumlah**.\n\n` +
                    `💡 *Contoh Format Kirim:*\n${exampleText}`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: { force_reply: true, selective: true }
                    }
                );
            } else {
                userPendingCommand.delete(userId);
                const fullPayload = `${pending.date}\n${text}`;

                if (pending.command === 'produksi') return await processProduksiLogic(ctx, fullPayload);
                if (pending.command === 'waste') return await processWasteLogic(ctx, fullPayload);
                if (pending.command === 'dailyso') return await processDailysoLogic(ctx, fullPayload);
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
            handleSheetsError(err);
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
    const updateData = [];

    for (const item of items) {
        if (!item.matchedName) {
            unrecognizedItems.push(item);
            continue;
        }

        const matchedProd = productionProducts.find(p => isSameProduct(p.name, item.matchedName));
        if (!matchedProd) {
            unrecognizedItems.push(item);
            continue;
        }

        updateData.push({
            range: `'${tabName}'!D${matchedProd.rowIndex}`,
            values: [[item.quantity]]
        });

        successWrites++;
        successReports.push(`• *${item.matchedName}*: \`${item.quantity}\``);
    }

    if (updateData.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updateData
            }
        });
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

// Express Health Check Endpoint with Auto-Restart Capabilities
app.get('/health', async (req, res) => {
    const healthStatus = {
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptime: formatUptime(process.uptime()),
        bots: {}
    };

    let overallHealthy = true;

    for (const key in BRANCHES) {
        const branch = BRANCHES[key];
        const botStatus = {
            code: branch.code,
            name: branch.name,
            pollingActive: branch.bot && branch.bot.polling ? branch.bot.polling.active : false,
            lastUpdate: branch.lastUpdateTimestamp ? new Date(branch.lastUpdateTimestamp).toISOString() : 'never',
            pendingUpdates: 0,
            healthy: true
        };

        try {
            if (branch.bot) {
                const me = await branch.bot.telegram.getMe();
                botStatus.username = me.username;
                
                const webhookInfo = await branch.bot.telegram.getWebhookInfo();
                botStatus.pendingUpdates = webhookInfo.pending_update_count;

                // Check if stuck: pending updates exist but no update was processed recently
                if (webhookInfo.pending_update_count > 0) {
                    const now = Date.now();
                    const idleTime = now - (branch.lastUpdateTimestamp || branch.startedAt);
                    if (idleTime > 60000) { // More than 1 minute idle with pending updates
                        botStatus.healthy = false;
                        botStatus.error = 'Bot is stuck: pending updates exist but no updates processed in > 1 minute';
                        overallHealthy = false;
                    }
                }
            } else {
                botStatus.healthy = false;
                botStatus.error = 'Bot not initialized';
                overallHealthy = false;
            }
        } catch (err) {
            botStatus.healthy = false;
            botStatus.error = err.message;
            overallHealthy = false;
        }

        healthStatus.bots[key] = botStatus;
    }

    if (!overallHealthy) {
        healthStatus.status = 'DOWN';
        res.status(500).json(healthStatus);
        
        // If forceRestart query is passed or we want automatic trigger
        if (req.query.forceRestart === 'true') {
            console.error('[HEALTH_CHECK] Unhealthy state detected. Triggering force restart...');
            setTimeout(() => process.exit(1), 1000);
        }
    } else {
        res.json(healthStatus);
    }
});

function startBackgroundHealthChecker() {
    console.log('[HEALTH_CHECKER] Background health checker started.');
    setInterval(async () => {
        let needsRestart = false;
        for (const key in BRANCHES) {
            const branch = BRANCHES[key];
            if (!branch.bot) continue;

            try {
                const webhookInfo = await branch.bot.telegram.getWebhookInfo();
                const pendingUpdates = webhookInfo.pending_update_count;
                
                if (pendingUpdates > 0) {
                    const now = Date.now();
                    const idleTime = now - (branch.lastUpdateTimestamp || branch.startedAt);
                    // If stuck for more than 45 seconds with pending updates
                    if (idleTime > 45000) {
                        console.error(`[HEALTH_CHECKER] Bot ${branch.code} detected stuck! Idle for ${Math.round(idleTime/1000)}s with ${pendingUpdates} pending updates.`);
                        
                        // Try to restart polling for this bot
                        console.log(`[HEALTH_CHECKER] Attempting to restart polling for Bot ${branch.code}...`);
                        try {
                            await branch.bot.stop();
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            await branch.bot.launch();
                            console.log(`[HEALTH_CHECKER] Bot ${branch.code} polling restarted successfully.`);
                            branch.startedAt = Date.now(); // reset timer
                        } catch (restartErr) {
                            console.error(`[HEALTH_CHECKER] Failed to restart polling for Bot ${branch.code}:`, restartErr.message);
                            needsRestart = true;
                        }
                    }
                }
            } catch (err) {
                console.error(`[HEALTH_CHECKER] Error checking health for Bot ${branch.code}:`, err.message);
                if (err.message.includes('401') || err.message.includes('Unauthorized')) {
                    console.error('[HEALTH_CHECKER] Unauthorized token detected. Exiting process...');
                    needsRestart = true;
                }
            }
        }

        if (needsRestart) {
            console.error('[HEALTH_CHECKER] Critical health issues. Exiting process to let PM2 restart it.');
            process.exit(1);
        }
    }, 30000);
}

const telegramSentReminders = {
    soft: null, // Format: 'YYYY-MM-DD'
    hard: null  // Format: 'YYYY-MM-DD'
};

async function loadSentReminders() {
    try {
        const doc = await db.collection('scheduler_state').doc('reminders').get();
        if (doc.exists) {
            const data = doc.data();
            telegramSentReminders.soft = data.soft || null;
            telegramSentReminders.hard = data.hard || null;
            console.log('[TELEGRAM_SCHEDULER] Loaded sent reminders state from Firestore:', telegramSentReminders);
        }
    } catch (err) {
        console.warn('[TELEGRAM_SCHEDULER] Failed to load reminders state from Firestore:', err.message);
    }
}

async function saveSentReminders() {
    try {
        await db.collection('scheduler_state').doc('reminders').set({
            soft: telegramSentReminders.soft,
            hard: telegramSentReminders.hard,
            updatedAt: new Date()
        });
    } catch (err) {
        console.warn('[TELEGRAM_SCHEDULER] Failed to save reminders state to Firestore:', err.message);
    }
}

async function startTelegramScheduler() {
    console.log('[TELEGRAM_SCHEDULER] Background scheduler started successfully for 21:45 & 22:00 WIB.');
    await loadSentReminders();

    setInterval(async () => {
        try {
            const now = new Date();
            const timeOptions = { timeZone: 'Asia/Jakarta', hour: 'numeric', minute: 'numeric', hour12: false };
            const dateOptions = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' };

            const timeParts = new Intl.DateTimeFormat('en-US', timeOptions).formatToParts(now);
            const hour = parseInt(timeParts.find(p => p.type === 'hour').value, 10);
            const minute = parseInt(timeParts.find(p => p.type === 'minute').value, 10);

            const dateParts = new Intl.DateTimeFormat('en-US', dateOptions).formatToParts(now);
            const yearStr = dateParts.find(p => p.type === 'year').value;
            const monthStr = dateParts.find(p => p.type === 'month').value;
            const dayStr = dateParts.find(p => p.type === 'day').value;
            const dateKey = `${yearStr}-${monthStr}-${dayStr}`;
            const currentDayInt = parseInt(dayStr, 10);

            // 1. Soft Reminder: 21:45 WIB
            if (hour === 21 && minute === 45) {
                if (telegramSentReminders.soft !== dateKey) {
                    telegramSentReminders.soft = dateKey;
                    await saveSentReminders();
                    console.log(`[TELEGRAM_SCHEDULER] Triggering 21:45 Soft Reminder check for date: ${dateKey}`);

                    for (const key in BRANCHES) {
                        const branch = BRANCHES[key];
                        let targetChatId = process.env[`TELEGRAM_CHAT_ID_${branch.code}`];
                        
                        if (!targetChatId) {
                            try {
                                const chatDoc = await db.collection('telegram_chats').doc(branch.code).get();
                                if (chatDoc.exists) {
                                    targetChatId = chatDoc.data().chatId;
                                }
                            } catch (err) {
                                console.error(`[TELEGRAM_SCHEDULER] Failed to get chat ID for ${branch.code} from Firestore:`, err.message);
                            }
                        }

                        if (!targetChatId) {
                            console.warn(`[TELEGRAM_SCHEDULER] No chat ID found for branch ${branch.code}. Skipping soft reminder.`);
                            continue;
                        }

                        const sheets = await getSheetsClient();
                        const prodSpreadsheetId = branch.spreadsheets.produksi;
                        const tabName = await findTabName(sheets, prodSpreadsheetId, currentDayInt, yearStr);

                        let productionFilled = false;
                        let wasteFilled = false;
                        try {
                            const prodRes = await sheets.spreadsheets.values.get({
                                spreadsheetId: prodSpreadsheetId,
                                range: `'${tabName}'!B1:D120`
                            });
                            const prodStatus = getProductionWasteStatus(prodRes.data.values || []);
                            productionFilled = prodStatus.productionFilled;
                            wasteFilled = prodStatus.wasteFilled;
                        } catch (err) {
                            console.warn(`[TELEGRAM_SCHEDULER] Error checking prod/waste for ${branch.code}:`, err.message);
                        }

                        let dailySoFilled = false;
                        try {
                            const soSpreadsheetId = branch.spreadsheets.dailyso;
                            const metaRes = await sheets.spreadsheets.get({
                                spreadsheetId: soSpreadsheetId,
                                fields: 'sheets.properties.title'
                            });
                            const sheetTitles = (metaRes.data.sheets || []).map(sheet => sheet.properties.title);
                            const defaultTab = sheetTitles[0];
                            const currentMonthInt = parseInt(monthStr, 10);
                            const yrShort = yearStr.slice(-2);
                            const candidates = [
                                `${currentMonthInt} - ${yearStr}`,
                                `${monthStr} - ${yearStr}`,
                                `${currentMonthInt} - ${yrShort}`,
                                `${monthStr} - ${yrShort}`
                            ];
                            const targetTab = sheetTitles.find(t => candidates.includes(t)) || defaultTab;
                            const columnLetter = colIndexToLetter(3 + currentDayInt);

                            if (targetTab) {
                                const soRes = await sheets.spreadsheets.values.get({
                                    spreadsheetId: soSpreadsheetId,
                                    range: `'${targetTab}'!B1:${columnLetter}150`
                                });
                                dailySoFilled = getDailySoStatus(soRes.data.values || [], currentDayInt);
                            }
                        } catch (err) {
                            console.warn(`[TELEGRAM_SCHEDULER] Error checking Daily SO for ${branch.code}:`, err.message);
                        }

                        // Production filled makes waste optional. If production is missing, check both.
                        const prodWasteMissing = !productionFilled;

                        if (prodWasteMissing || !dailySoFilled) {
                            const missing = [];
                            if (!productionFilled) {
                                missing.push('Laporan Produksi');
                                if (!wasteFilled) missing.push('Laporan Waste');
                            }
                            if (!dailySoFilled) missing.push('Daily Stock Opname');

                            const reminderText = `Pengingat Laporan Operasional (${branch.name})
----------------------------------------
Mohon melengkapi data operasional hari ini. Sistem mencatat beberapa laporan belum diisi:
${missing.map(m => `- ${m} belum diisi`).join('\n')}

Silakan gunakan perintah:
- /produksi
- /waste
- /dailyso`.trim();

                            try {
                                const botInstance = activeBots.find(b => b.token === branch.token);
                                if (botInstance) {
                                    await botInstance.telegram.sendMessage(targetChatId, reminderText);
                                    console.log(`[TELEGRAM_SCHEDULER] Sent 21:45 Soft Reminder to ${branch.code} (Chat ID: ${targetChatId})`);
                                }
                            } catch (err) {
                                console.error(`[TELEGRAM_SCHEDULER] Failed to send 21:45 Soft Reminder to ${branch.code}:`, err.message);
                            }
                        } else {
                            console.log(`[TELEGRAM_SCHEDULER] ${branch.code} has filled all reports. Skipping soft reminder.`);
                        }
                    }
                }
            }

            // 2. Hard Alert: 22:00 WIB
            if (hour === 22 && minute === 0) {
                if (telegramSentReminders.hard !== dateKey) {
                    telegramSentReminders.hard = dateKey;
                    await saveSentReminders();
                    console.log(`[TELEGRAM_SCHEDULER] Triggering 22:00 Hard Alert check for date: ${dateKey}`);

                    for (const key in BRANCHES) {
                        const branch = BRANCHES[key];
                        let targetChatId = process.env[`TELEGRAM_CHAT_ID_${branch.code}`];
                        
                        if (!targetChatId) {
                            try {
                                const chatDoc = await db.collection('telegram_chats').doc(branch.code).get();
                                if (chatDoc.exists) {
                                    targetChatId = chatDoc.data().chatId;
                                }
                            } catch (err) {
                                console.error(`[TELEGRAM_SCHEDULER] Failed to get chat ID for ${branch.code} from Firestore:`, err.message);
                            }
                        }

                        if (!targetChatId) {
                            console.warn(`[TELEGRAM_SCHEDULER] No chat ID found for branch ${branch.code}. Skipping hard alert.`);
                            continue;
                        }

                        const sheets = await getSheetsClient();
                        const prodSpreadsheetId = branch.spreadsheets.produksi;
                        const tabName = await findTabName(sheets, prodSpreadsheetId, currentDayInt, yearStr);

                        let productionFilled = false;
                        let wasteFilled = false;
                        try {
                            const prodRes = await sheets.spreadsheets.values.get({
                                spreadsheetId: prodSpreadsheetId,
                                range: `'${tabName}'!B1:D120`
                            });
                            const prodStatus = getProductionWasteStatus(prodRes.data.values || []);
                            productionFilled = prodStatus.productionFilled;
                            wasteFilled = prodStatus.wasteFilled;
                        } catch (err) {
                            console.warn(`[TELEGRAM_SCHEDULER] Error checking prod/waste for ${branch.code}:`, err.message);
                            handleSheetsError(err);
                        }

                        let dailySoFilled = false;
                        try {
                            const soSpreadsheetId = branch.spreadsheets.dailyso;
                            const metaRes = await sheets.spreadsheets.get({
                                spreadsheetId: soSpreadsheetId,
                                fields: 'sheets.properties.title'
                            });
                            const sheetTitles = (metaRes.data.sheets || []).map(sheet => sheet.properties.title);
                            const defaultTab = sheetTitles[0];
                            const currentMonthInt = parseInt(monthStr, 10);
                            const yrShort = yearStr.slice(-2);
                            const candidates = [
                                `${currentMonthInt} - ${yearStr}`,
                                `${monthStr} - ${yearStr}`,
                                `${currentMonthInt} - ${yrShort}`,
                                `${monthStr} - ${yrShort}`
                            ];
                            const targetTab = sheetTitles.find(t => candidates.includes(t)) || defaultTab;
                            const columnLetter = colIndexToLetter(3 + currentDayInt);

                            if (targetTab) {
                                const soRes = await sheets.spreadsheets.values.get({
                                    spreadsheetId: soSpreadsheetId,
                                    range: `'${targetTab}'!B1:${columnLetter}150`
                                });
                                dailySoFilled = getDailySoStatus(soRes.data.values || [], currentDayInt);
                            }
                        } catch (err) {
                            console.warn(`[TELEGRAM_SCHEDULER] Error checking Daily SO for ${branch.code}:`, err.message);
                            handleSheetsError(err);
                        }

                        const prodWasteMissing = !productionFilled;

                        if (prodWasteMissing || !dailySoFilled) {
                            const missing = [];
                            if (!productionFilled) {
                                missing.push('Laporan Produksi');
                                if (!wasteFilled) missing.push('Laporan Waste');
                            }
                            if (!dailySoFilled) missing.push('Daily Stock Opname');

                            const alertText = `Pemberitahuan Laporan Belum Lengkap (${branch.name})
----------------------------------------
Sistem mendeteksi bahwa waktu sudah menunjukkan pukul 22.00 WIB dan laporan berikut belum terisi:
${missing.map(m => `- ${m} BELUM DIISI`).join('\n')}

Harap segera melengkapi pengisian laporan harian.`.trim();

                            try {
                                const botInstance = activeBots.find(b => b.token === branch.token);
                                if (botInstance) {
                                    await botInstance.telegram.sendMessage(targetChatId, alertText);
                                    console.log(`[TELEGRAM_SCHEDULER] Sent 22:00 Hard Alert to ${branch.code} (Chat ID: ${targetChatId})`);
                                }
                            } catch (err) {
                                console.error(`[TELEGRAM_SCHEDULER] Failed to send 22:00 Hard Alert to ${branch.code}:`, err.message);
                            }
                        } else {
                            console.log(`[TELEGRAM_SCHEDULER] ${branch.code} completed all reports before 22:00. Skipping hard alert.`);
                        }
                    }
                }
            }

        } catch (err) {
            console.error('[TELEGRAM_SCHEDULER] Error in scheduler loop:', err.message);
        }
    }, 30000);
}

// Start Both Bots & Web Server
async function main() {
    console.log('[TELEGRAM] Initializing Telegram Bots for TP and PM...');

    for (const key in BRANCHES) {
        const branch = BRANCHES[key];
        try {
            const bot = setupBot(branch);
            bot.launch();
            activeBots.push(bot);
            branch.bot = bot; // Save bot instance for health checks
            console.log(`[TELEGRAM] Bot ${branch.code} (${branch.name}) started successfully!`);
        } catch (err) {
            console.error(`[TELEGRAM] Error starting Bot ${branch.code}:`, err.message);
        }
    }

    // Start background scheduler for Telegram bot
    startTelegramScheduler();

    // Start background health checker
    startBackgroundHealthChecker();

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

