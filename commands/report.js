module.exports = {
    name: 'report',
    description: 'Menampilkan daftar menu report (/produksi, /waste, /dailyso)',
    execute: async (sock, message, args) => {
        const jid = message.key.remoteJid;
        const text = `
*📋 MENU REPORT*
----------------------------------------
Berikut daftar command report yang tersedia:

1. */produksi* - Input data produksi
2. */waste* - Input data waste
3. */dailyso* - Input data stock opname harian

_Ketik command di atas untuk menggunakan._
        `.trim();

        await sock.sendMessage(jid, { text }, { quoted: message });
    }
};
