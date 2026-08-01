module.exports = {
    name: 'mastercommand',
    description: 'Menampilkan semua daftar command, fungsi, dan panduan input',
    execute: async (sock, message, args) => {
        const jid = message.key.remoteJid;
        const text = `
*📖 DAFTAR DOKUMENTASI COMMAND BOT*
----------------------------------------
Berikut daftar seluruh command beserta fungsi dan panduan cara inputnya:

1. */report*
   • *Fungsi:* Menampilkan menu pilihan report harian.
   • *Cara Input:* \`/report\`

2. */produksi*
   • *Fungsi:* Input data produksi ke spreadsheet toko per grup.
   • *Cara Input:* \`/produksi [data]\`

3. */waste*
   • *Fungsi:* Input data waste ke spreadsheet toko per grup.
   • *Cara Input:* \`/waste [data]\`

4. */dailyso*
   • *Fungsi:* Input data stock opname harian ke spreadsheet toko per grup.
   • *Cara Input:* \`/dailyso [data]\`

5. */closingbreafingtp*
   • *Fungsi:* Kirim daily closing report TP via AI parsing template.
   • *Cara Input:* \`/closingbreafingtp [template text]\`

6. */morningbreafingtp*
   • *Fungsi:* Kirim daily opening report TP via AI parsing template.
   • *Cara Input:* \`/morningbreafingtp [template text]\`

7. */closingbreafingpms*
   • *Fungsi:* Kirim daily closing report PMS via AI parsing template.
   • *Cara Input:* \`/closingbreafingpms [template text]\`

8. */morningbreafingpms*
   • *Fungsi:* Kirim daily opening report PMS via AI parsing template.
   • *Cara Input:* \`/morningbreafingpms [template text]\`

9. */salesreport*
   • *Fungsi:* Input data sales report ke tabel spreadsheet ter-mapping.
   • *Cara Input:* \`/salesreport [data text]\`

10. */mastercommand*
    • *Fungsi:* Menampilkan panduan master seluruh command ini.
    • *Cara Input:* \`/mastercommand\`

----------------------------------------
_Sistem Otomasi WhatsApp Bot Cloud_ 🚀
        `.trim();

        await sock.sendMessage(jid, { text }, { quoted: message });
    }
};
