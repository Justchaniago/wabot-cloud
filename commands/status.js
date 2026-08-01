const os = require('os');

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

module.exports = {
    name: 'status',
    description: 'Menampilkan status & statistik sistem bot beserta ID Ruangan/Grup',
    execute: async (sock, message, args) => {
        const jid = message.key.remoteJid;
        const uptime = formatUptime(process.uptime());
        const mem = process.memoryUsage();
        const ramUsedMB = (mem.rss / (1024 * 1024)).toFixed(2);

        const textResponse = `
*🤖 WHATSAPP CLOUD BOT STATUS*
----------------------------------------
🟢 *Status:* ONLINE
☁️ *Environment:* Google Cloud Run
🔥 *Database:* Google Cloud Firestore
⏱️ *Uptime:* ${uptime}
📊 *RAM Usage:* ${ramUsedMB} MB
⚡ *Runtime:* Node.js ${process.version}
🕒 *Server Time:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB

📍 *ROOM INFO:*
- *Current Room JID:* \`${jid}\`
----------------------------------------
_Bot Cloud-Native Serverless 24/7_ 🚀
        `.trim();

        // Send as pure text (no quoted option to ensure robust E2EE instant delivery)
        console.log(`[STATUS_CMD] Attempting sendMessage to JID: ${jid}`);
        const res = await sock.sendMessage(jid, { text: textResponse });
        console.log(`[STATUS_CMD] sendMessage succeeded for ${jid}: messageId=${res?.key?.id}`);
    }
};
