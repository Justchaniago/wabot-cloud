module.exports = {
    name: 'salesreport',
    description: 'Mengisi tabel spreadsheet dari parsing data sales report',
    execute: async (sock, message, args) => {
        const jid = message.key.remoteJid;
        // Skeleton logic - nanti diisi sesuai diskusi
        await sock.sendMessage(jid, { text: '🚧 Command /salesreport dalam pengembangan.' }, { quoted: message });
    }
};
