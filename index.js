require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { Firestore } = require('@google-cloud/firestore');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { useFirestoreAuthState } = require('./firestoreAuth');

const PORT = process.env.PORT || 8080;
const COLLECTION = process.env.FIRESTORE_COLLECTION || 'whatsapp_sessions';
const SESSION_ID = process.env.SESSION_ID || 'default_session';
const PREFIX = process.env.COMMAND_PREFIX || '/';

const app = express();
app.use(express.json());

// Override console logs to auto-stream to WebSocket control panel
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
    originalLog(...args);
    try {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
        if (typeof broadcastLog === 'function') {
            const type = msg.includes('[EXEC_ERR]') || msg.includes('[CRITICAL]') ? 'ERROR' : 
                         msg.includes('[WARN]') ? 'WARN' : 
                         msg.includes('[SUCCESS]') || msg.includes('[CONNECTED]') ? 'SUCCESS' : 'INFO';
            broadcastLog(type, msg);
        }
    } catch (e) {}
};

console.error = (...args) => {
    originalError(...args);
    try {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
        if (typeof broadcastLog === 'function') broadcastLog('ERROR', msg);
    } catch (e) {}
};

// Prevent container crash on Baileys Noise decipher / crypto errors
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection:', reason);
});

let sockInstance = null;
let rawQr = null;
let currentPairingCode = null;
let botStatus = { status: 'INITIALIZING', user: null };
const { startScheduler } = require('./scheduler');
let schedulerStarted = false;

// Web UI for easy QR Scan & Pairing Code
app.get('/', (req, res) => {
    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <title>WhatsApp Cloud Bot - Control Panel</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: #0f172a;
                --card-bg: rgba(30, 41, 59, 0.7);
                --card-border: rgba(255, 255, 255, 0.1);
                --accent-green: #22c55e;
                --accent-blue: #38bdf8;
                --accent-red: #ef4444;
                --text: #f8fafc;
                --text-muted: #94a3b8;
            }
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
            body { background: var(--bg); color: var(--text); padding: 2rem 1rem; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
            .container { width: 100%; max-width: 640px; }
            .header { text-align: center; margin-bottom: 2rem; }
            .header h1 { font-size: 2rem; font-weight: 700; color: #fff; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
            .header p { color: var(--text-muted); font-size: 0.95rem; margin-top: 0.25rem; }
            
            .card { background: var(--card-bg); backdrop-filter: blur(12px); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.75rem; margin-bottom: 1.5rem; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
            
            .status-badge { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1.25rem; border-radius: 9999px; font-weight: 600; font-size: 0.9rem; margin-bottom: 1rem; text-transform: uppercase; letter-spacing: 0.5px; }
            .status-CONNECTED { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
            .status-DISCONNECTED { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
            .status-WAITING_FOR_QR_SCAN, .status-INITIALIZING { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
            
            .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: pulse 2s infinite; }
            @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.2); } }
            
            .metrics-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-top: 1rem; }
            .metric-box { background: rgba(15, 23, 42, 0.6); padding: 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); text-align: left; }
            .metric-box .label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
            .metric-box .val { font-size: 1.1rem; font-weight: 600; color: #fff; margin-top: 0.25rem; word-break: break-all; }
            
            form { display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem; }
            input[type="text"] { background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 0.85rem 1rem; border-radius: 10px; font-size: 1rem; width: 100%; outline: none; transition: border-color 0.2s; }
            input[type="text"]:focus { border-color: var(--accent-green); }
            button { background: var(--accent-green); color: #fff; font-weight: 600; padding: 0.85rem 1rem; border-radius: 10px; border: none; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
            button:hover { background: #16a34a; }
            
            .code-display { font-size: 2.25rem; font-family: monospace; letter-spacing: 6px; font-weight: 700; color: var(--accent-blue); background: #0b1120; padding: 1rem; border-radius: 12px; margin-top: 1rem; border: 1px dashed rgba(56, 189, 248, 0.4); }
            .qr-container img { background: #fff; padding: 12px; border-radius: 12px; margin-top: 1rem; max-width: 240px; }
            
            .actions { display: flex; justify-content: center; gap: 1rem; margin-top: 1.5rem; }
            .btn-danger { background: transparent; color: var(--accent-red); border: 1px solid rgba(239, 68, 68, 0.4); text-decoration: none; padding: 0.6rem 1.2rem; border-radius: 8px; font-size: 0.875rem; font-weight: 500; transition: all 0.2s; }
            .btn-danger:hover { background: rgba(239, 68, 68, 0.15); border-color: var(--accent-red); }
            
            .commands-list { margin-top: 1.5rem; text-align: left; }
            .commands-list h3 { font-size: 1rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.75rem; }
            .cmd-badge { display: inline-block; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); padding: 0.35rem 0.75rem; border-radius: 8px; font-size: 0.85rem; font-family: monospace; color: var(--accent-blue); margin: 0.25rem; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⚡ WhatsApp Cloud Bot</h1>
                <p>Google Cloud Run Microservice Dashboard</p>
            </div>
            
            <div class="card">
                <div class="status-badge status-${botStatus.status}">
                    <span class="pulse-dot"></span> Status: ${botStatus.status}
                </div>
                
                <div class="metrics-grid">
                    <div class="metric-box">
                        <div class="label">Akun WhatsApp</div>
                        <div class="val">${botStatus.user ? botStatus.user.id.split(':')[0] : 'Belum Login'}</div>
                    </div>
                    <div class="metric-box">
                        <div class="label">Server Uptime</div>
                        <div class="val">${uptimeStr}</div>
                    </div>
                </div>

                ${rawQr ? `
                    <div class="qr-container">
                        <h3 style="margin-top:1.5rem; font-size:1.1rem;">Scan QR Code:</h3>
                        <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(rawQr)}" alt="QR Code" />
                        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:0.5rem;">Auto-refresh setiap 15 detik</p>
                    </div>
                ` : ''}

                ${botStatus.status !== 'CONNECTED' ? `
                    <div style="margin-top: 1.5rem; text-align: left;">
                        <h3 style="font-size:1rem; margin-bottom:0.5rem; color:#fff;">Tautkan via Kode Pairing:</h3>
                        <form action="/pair" method="GET">
                            <input type="text" name="phone" placeholder="Nomor WhatsApp (Contoh: 628123456789)" required />
                            <button type="submit">Dapatkan Kode Pairing</button>
                        </form>
                        ${currentPairingCode ? `
                            <div class="code-display">${currentPairingCode}</div>
                            <p style="font-size:0.85rem; color:var(--text-muted); margin-top:0.5rem; text-align:center;">Masukkan di WA -> Linked Devices -> Link with phone number</p>
                        ` : ''}
                    </div>
                ` : `
                    <p style="color: var(--accent-green); margin-top: 1.5rem; font-weight: 500;">🚀 Bot aktif dan siap melayani perintah di WhatsApp!</p>
                `}

                <div class="actions">
                    <a href="/reset" onclick="return confirm('Yakin ingin mereset sesi WhatsApp?')" class="btn-danger">🔄 Reset Sesi / Clear Auth</a>
                </div>
            </div>

            <div class="card commands-list">
                <h3>📜 Fitur Command Aktif:</h3>
                <span class="cmd-badge">/ai</span>
                <span class="cmd-badge">/produksi</span>
                <span class="cmd-badge">/waste</span>
                <span class="cmd-badge">/morningbriefingtp</span>
                <span class="cmd-badge">/morningbriefingpms</span>
                <span class="cmd-badge">/closingbriefingtp</span>
                <span class="cmd-badge">/closingbriefingpms</span>
                <span class="cmd-badge">/dailyso</span>
                <span class="cmd-badge">/status</span>
            </div>
        </div>

        <script>
            setTimeout(() => { if (!document.querySelector('input:focus')) location.reload(); }, 15000);
        </script>
    </body>
    </html>
    `);
});

app.get('/pair', async (req, res) => {
    const phone = req.query.phone?.replace(/[^0-9]/g, '');
    if (!phone) {
        return res.status(400).send('Nomor telepon wajib diisi. Contoh: /pair?phone=628123456789');
    }
    if (!sockInstance) {
        return res.status(500).send('Socket belum siap.');
    }
    try {
        const code = await sockInstance.requestPairingCode(phone);
        currentPairingCode = code;
        res.redirect('/?paired=true');
    } catch (err) {
        res.status(500).send('Gagal minta kode pairing: ' + err.message + '. Sesi mungkin korup. Coba <a href="/reset">Reset Sesi</a> terlebih dahulu.');
    }
});

app.get('/reset', async (req, res) => {
    try {
        console.log('[BOT] Manual reset triggered via web endpoint.');
        await clearFirestoreSession(COLLECTION, SESSION_ID);
        botStatus.status = 'INITIALIZING';
        rawQr = null;
        currentPairingCode = null;
        if (sockInstance) {
            try { sockInstance.ev.removeAllListeners(); } catch (e) {}
            try { sockInstance.end(); } catch (e) {}
        }
        startBot();
        res.send('<h3>Sesi berhasil direset!</h3><p>Silakan <a href="/">Kembali ke Dashboard Web</a> untuk minta kode pairing baru.</p>');
    } catch (err) {
        res.status(500).send('Gagal reset sesi: ' + err.message);
    }
});

const http = require('http');
const setupPanelServer = require('./panel-server');

const server = http.createServer(app);
const { broadcastLog, broadcastWaBotStatus } = setupPanelServer(app, server);

// Register global handler for panel restart & pairing trigger
global.restartWaBotHandler = () => {
    console.log('[BOT] Panel triggered bot restart sequence...');
    botStatus.status = 'RESTARTING';
    broadcastWaBotStatus({ connected: false, status: 'RESTARTING' });
    if (sockInstance) {
        try { sockInstance.ev.removeAllListeners(); } catch (e) {}
        try { sockInstance.end(); } catch (e) {}
    }
    setTimeout(startBot, 2000);
};

global.requestPairingCodeHandler = async (phone) => {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (!sockInstance) throw new Error('Socket belum siap');
    const code = await sockInstance.requestPairingCode(cleanPhone);
    currentPairingCode = code;
    broadcastWaBotStatus({ pairingCode: code });
    return code;
};

server.listen(PORT, () => {
    console.log(`[HTTP] Web server & Neobrutalism Control Panel running on port ${PORT}`);
});

// Load Dynamic Commands
const commands = new Map();
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        if (command.name && typeof command.execute === 'function') {
            commands.set(command.name.toLowerCase(), command);
            if (Array.isArray(command.aliases)) {
                for (const alias of command.aliases) {
                    commands.set(alias.toLowerCase(), command);
                }
            }
            console.log(`[COMMAND] Loaded command: ${command.name}`);
        }
    }
}

// Initialize Firestore
const db = new Firestore({
    projectId: process.env.GCP_PROJECT_ID || undefined
});

async function clearFirestoreSession(collectionName, sessionId) {
    try {
        const docRef = db.collection(collectionName).doc(sessionId);
        const keysRef = docRef.collection('keys');
        const snapshot = await keysRef.get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(docRef);
        await batch.commit();
        console.log(`[FIRESTORE] Session '${sessionId}' cleared successfully.`);
    } catch (err) {
        console.error(`[FIRESTORE] Error clearing session '${sessionId}':`, err);
    }
}

// In-memory message store for getMessage retry requests
const messageStore = new Map();

// Initialize WhatsApp Socket
async function startBot() {
    console.log('[BOT] Initializing Firestore Auth State...');
    const { state, saveCreds } = await useFirestoreAuthState(db, COLLECTION, SESSION_ID);

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 250,
        getMessage: async (key) => {
            if (messageStore.has(key.id)) {
                return messageStore.get(key.id);
            }
            return undefined;
        }
    });

    sockInstance = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            rawQr = qr;
            botStatus.status = 'WAITING_FOR_QR_SCAN';
            broadcastWaBotStatus({ connected: false, rawQr: qr, status: 'WAITING_FOR_QR_SCAN' });
            console.log('[QR] New QR code generated. Available on web dashboard.');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            botStatus.status = 'DISCONNECTED';
            rawQr = null;
            broadcastWaBotStatus({ connected: false, rawQr: null, status: 'DISCONNECTED' });
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`[BOT] Connection closed. Reason code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            } else {
                console.log('[BOT] Logged out. Session needs reset in Firestore.');
                clearFirestoreSession(COLLECTION, SESSION_ID).then(() => {
                    console.log('[BOT] Session cleared. Restarting bot with clean slate...');
                    setTimeout(startBot, 3000);
                }).catch(err => {
                    console.error('[BOT] Error clearing session:', err);
                    setTimeout(startBot, 5000);
                });
            }
        } else if (connection === 'open') {
            console.log(`[BOT] Connected successfully as ${sock.user?.id || 'WhatsApp User'}`);
            botStatus.status = 'CONNECTED';
            rawQr = null;
            currentPairingCode = null;
            botStatus.user = sock.user;
            broadcastWaBotStatus({ connected: true, rawQr: null, status: 'CONNECTED', user: sock.user?.id });

            // Start background scheduler if not already started
            if (!schedulerStarted) {
                startScheduler(() => sockInstance);
                schedulerStarted = true;
            }
        }
    });

    sock.ev.on('message-receipt.update', (receipts) => {
        for (const r of receipts) {
            console.log(`[RECEIPT] Message ID ${r.key.id} to ${r.key.remoteJid}: receipt=${JSON.stringify(r.receipt)}`);
        }
    });

    sock.ev.on('messages.update', (updates) => {
        for (const u of updates) {
            console.log(`[MSG_UPDATE] Message ID ${u.key.id} to ${u.key.remoteJid}: update=${JSON.stringify(u.update)}`);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            console.log(`[UPSERT] Event type: ${m.type}, messages count: ${m.messages.length}`);
            // Save ALL messages (incoming & outgoing/append) for retry request decryption
            for (const msg of m.messages) {
                if (msg.key && msg.key.id && msg.message) {
                    messageStore.set(msg.key.id, msg.message);
                    // Prevent memory leak by keeping max 2000 recent messages
                    if (messageStore.size > 2000) {
                        const firstKey = messageStore.keys().next().value;
                        messageStore.delete(firstKey);
                    }
                }
            }

            if (m.type !== 'notify') return;

            for (const msg of m.messages) {
                if (!msg.message) continue;

                const sender = msg.key.remoteJid;
                const isFromMe = msg.key.fromMe;

                const body = msg.message.conversation ||
                    msg.message.extendedTextMessage?.text ||
                    msg.message.imageMessage?.caption ||
                    '';

                console.log(`[MSG IN] From: ${sender} (fromMe: ${isFromMe}) | Body: "${body.substring(0, 60)}"`);

                if (!body) continue;

                console.log(`[MSG IN] From: ${sender} (fromMe: ${isFromMe}) | Content: "${body}"`);

                // Check if message contains any command prefix
                if (!body.includes(PREFIX)) continue;

                // Split message into individual command blocks (separated by newlines starting with PREFIX)
                const commandBlocks = body.split(/(?:^|\n)(?=\/[a-zA-Z0-9_-]+)/).map(b => b.trim()).filter(b => b.startsWith(PREFIX));

                if (commandBlocks.length === 0) continue;

                for (const block of commandBlocks) {
                    // Split block by any whitespace or newline to get exact command name
                    const cleanBody = block.slice(PREFIX.length).trim();
                    const args = cleanBody.split(/\s+/);
                    const commandName = args.shift().toLowerCase();

                    const command = commands.get(commandName);
                    if (command) {
                        console.log(`[EXEC] Executing '${commandName}' for target JID: ${sender}`);

                        const mockMsg = {
                            ...msg,
                            message: {
                                ...msg.message,
                                conversation: block,
                                extendedTextMessage: msg.message?.extendedTextMessage ? {
                                    ...msg.message.extendedTextMessage,
                                    text: block
                                } : undefined
                            }
                        };

                        try {
                            await command.execute(sock, mockMsg, args);
                            console.log(`[OUT] Command '${commandName}' executed successfully for ${sender}`);
                        } catch (cmdErr) {
                            console.error(`[EXEC_ERR] Error executing command '${commandName}' for ${sender}:`, cmdErr);
                            try {
                                await sock.sendMessage(sender, { text: `❌ Error command /${commandName}: ${cmdErr.message}` });
                            } catch (e) {}
                        }
                    } else {
                        console.log(`[WARN] Unknown command '${commandName}' with prefix '${PREFIX}'`);
                    }
                }
            }
        } catch (err) {
            console.error('[BOT] Error processing incoming message:', err);
        }
    });
}

startBot().catch(err => {
    console.error('[BOT] Critical start failure:', err);
});
