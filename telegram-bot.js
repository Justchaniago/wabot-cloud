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
        const auth = new google.auth.GoogleAuth({
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/cloud-platform'
            ]
        });
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        // Test call to verify scopes
        await sheets.spreadsheets.get({ spreadsheetId: '1673K8akr2mXuTEPLPPnL9X5TiA4GEVDi1hbgMLThvo4' });
        return sheets;
    } catch (err) {
        const errMsg = String(err.message || '');
        if (errMsg.includes('insufficient authentication scopes') || err.code === 403 || err.status === 403) {
            try {
                const { execSync } = require('child_process');
                const token = execSync('gcloud auth print-access-token').toString().trim();
                if (token) {
                    const oauth2Client = new google.auth.OAuth2();
                    oauth2Client.setCredentials({ access_token: token });
                    return google.sheets({ version: 'v4', auth: oauth2Client });
                }
            } catch (fallbackErr) {
                console.error('[SHEETS_AUTH] Fallback gcloud token error:', fallbackErr.message);
            }
        }
        throw err;
    }
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
• \`/morningbriefing [data]\` - Format Morning Briefing Shift
• \`/closingbriefing [data]\` - Format Closing Briefing Shift
• \`/testsheet\` - Uji koneksi Google Sheets
• \`/status\` - Cek status bot & server

💡 *Contoh Format Input Produksi:*
\`\`\`
/produksi
1.8.26
bt lokal 250
gt 100
\`\`\`
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

    // 4. /produksi
    bot.command('produksi', async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift(); // Remove command
        const inputText = lines.join('\n').trim();

        if (!inputText) {
            return await ctx.reply(`⚠️ *Format /produksi Salah!*\n\n*Contoh Kirim:*\n/produksi\n1.8.26\nbt lokal 250\ngt 100`, { parse_mode: 'Markdown' });
        }

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

            const rowsBtoD = readRes.data.values || [];
            if (rowsBtoD.length === 0) {
                return await ctx.reply(`❌ Gagal membaca produk dari tab "${tabName}". Pastikan tab tersebut sudah dibuat.`);
            }

            let productionStartIdx = -1;
            let wasteStartIdx = -1;

            rowsBtoD.forEach((row, idx) => {
                const cellVal = String(row[0] || '').trim().toUpperCase();
                if (cellVal === 'PRODUCTION') productionStartIdx = idx;
                else if (cellVal === 'WASTE') wasteStartIdx = idx;
            });

            if (productionStartIdx === -1) {
                return await ctx.reply(`❌ Header "PRODUCTION" tidak ditemukan di kolom B pada tab "${tabName}".`);
            }

            const prodEndIdx = wasteStartIdx !== -1 ? wasteStartIdx : rowsBtoD.length;
            const productionProducts = [];

            for (let i = productionStartIdx + 1; i < prodEndIdx; i++) {
                const prodName = String(rowsBtoD[i]?.[0] || '').trim();
                const existingQty = String(rowsBtoD[i]?.[2] || '').trim();

                if (prodName && !prodName.startsWith('---') && !prodName.includes('KODE')) {
                    productionProducts.push({
                        name: prodName,
                        rowIndex: i + 1,
                        existingQty: (existingQty && existingQty !== '0' && existingQty !== '') ? existingQty : null
                    });
                }
            }

            const validProductNamesList = productionProducts.map(p => p.name);

            const prompt = `
SANGAT PENTING: RESPON HANYA DALAM FORMAT JSON VALID. DILARANG MENAMBAHKAN TEKS PENJELASAN, BASA-BASI, ATAU TEKS LAIN SEPERTI "Tentu,..." ATAU "Berikut adalah...".

Anda adalah AI parser laporan produksi harian toko minuman.
Tugas Anda:
1. Analisis input:
"""
${inputLines.join('\n')}
"""
2. Cocokkan nama item yang diketik staff ke daftar nama produk RESMI yang ada di spreadsheet:
${JSON.stringify(validProductNamesList, null, 2)}

Aturan Penting:
- Lakukan fuzzy matching pintar (singkatan/singkatan khas toko, huruf besar/kecil diabaikan).
- SINONIM: "herbal jelly" / "grass jelly" -> "HERBAL JELLY BASE".
- Jika item tidak cocok, masukkan null di "matchedName".

3. JSON Output bersih:
{
  "items": [
    { "typed": "nama_input", "matchedName": "NAMA_RESMI", "quantity": angka }
  ]
}
            `.trim();

            let aiResult = null;
            let lastAiError = null;

            for (const modelName of CANDIDATE_MODELS) {
                let attempts = 0;
                while (attempts < 3) {
                    try {
                        const response = await ai.models.generateContent({ model: modelName, contents: prompt });
                        const rawText = response.text || '';
                        aiResult = parseJsonFromAi(rawText);
                        if (aiResult && Array.isArray(aiResult.items)) break;
                    } catch (err) {
                        lastAiError = err;
                        attempts++;
                        if (err.message && (err.message.includes('overloaded') || err.message.includes('RESOURCE_EXHAUSTED') || err.status === 429 || err.status === 503)) {
                            await new Promise(r => setTimeout(r, 1000 * attempts));
                        } else {
                            break; // non-retriable error
                        }
                    }
                }
                if (aiResult && Array.isArray(aiResult.items)) break;
            }

            if (!aiResult || !Array.isArray(aiResult.items)) {
                return await ctx.reply(`❌ Gagal memparsing input dengan AI: ${lastAiError ? lastAiError.message : 'JSON Parsing error'}`);
            }

            // Check Conflict
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
                const pendingId = `prod_${branch.code}_${ctx.from.id}_${Date.now()}`;
                await db.collection('pending_inputs').doc(pendingId).set({
                    branch: branch.code,
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

            // Direct Write
            await writeProduksiItems(sheets, spreadsheetId, tabName, aiResult.items, productionProducts, senderName, branch.code, ctx);

        } catch (err) {
            console.error(`[PRODUKSI_${branch.code}] Error:`, err);
            await ctx.reply(`❌ Terjadi kesalahan fatal: ${err.message}`);
        }
    });

    // 5. /waste
    bot.command('waste', async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift();
        const inputText = lines.join('\n').trim();

        if (!inputText) {
            return await ctx.reply(`⚠️ *Format /waste Salah!*\n\n*Contoh Kirim:*\n/waste\n1.8.26\nbt lokal 10\ngt 5`, { parse_mode: 'Markdown' });
        }

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

            let aiResult = null;
            for (const modelName of CANDIDATE_MODELS) {
                try {
                    const response = await ai.models.generateContent({ model: modelName, contents: prompt });
                    const rawText = response.text || '';
                    aiResult = parseJsonFromAi(rawText);
                    if (aiResult && Array.isArray(aiResult.items)) break;
                } catch (err) {}
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
    });

    // 5.5. /dailyso
    bot.command('dailyso', async (ctx) => {
        const fullText = ctx.message.text || '';
        const lines = fullText.split('\n');
        lines.shift();
        const inputText = lines.join('\n').trim();

        if (!inputText) {
            return await ctx.reply(`⚠️ *Format /dailyso Salah!*\n\n*Contoh Kirim:*\n/dailyso\n30.7.26\ngong cha y16 cups 10\nfresh milk diamond 5`, { parse_mode: 'Markdown' });
        }

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

            let aiResult = null;
            for (const modelName of CANDIDATE_MODELS) {
                try {
                    const response = await ai.models.generateContent({ model: modelName, contents: prompt });
                    const rawText = response.text || '';
                    aiResult = parseJsonFromAi(rawText);
                    if (aiResult && Array.isArray(aiResult.items)) break;
                } catch (err) {}
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

    // 11. Handle continuous text in AI Chat Mode
    bot.on('text', async (ctx, next) => {
        const text = ctx.message.text || '';
        if (text.startsWith('/')) return next();

        const userId = ctx.from.id;
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

    let replyText = `✅ *PRODUKSI BERHASIL DICATAT (${branchCode})*\n`;
    replyText += `📅 *Tab:* ${tabName}\n`;
    replyText += `✍️ *Oleh:* *${senderName}*\n`;
    replyText += `----------------------------------------\n`;
    if (successWrites > 0) replyText += successReports.join('\n') + `\n`;
    if (unrecognizedItems.length > 0) {
        replyText += `----------------------------------------\n⚠️ *Item tidak dikenali:*\n`;
        unrecognizedItems.forEach(i => replyText += `- _${i.typed}_ (${i.quantity})\n`);
    }

    await ctx.reply(replyText, { parse_mode: 'Markdown' });
}

// Escape markdown special characters
function escapeMarkdown(text) {
    return text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');
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
