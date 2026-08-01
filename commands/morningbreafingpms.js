const { GoogleGenAI } = require('@google/genai');

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey, vertexai: false }) : null;

// Target Group JID for PMS
const TARGET_GROUP_JID = '120363428551466980@g.us';

// Model candidates
const CANDIDATE_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
];

const PMS_TEMPLATE_STRUCTURE = `
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
`.trim();

module.exports = {
    name: 'morningbreafingpms',
    aliases: ['morningbriefingpms'],
    description: 'Format & kirim Morning Briefing PMS dari chat personal ke grup target',
    execute: async (sock, message, args) => {
        const jid = message.key.remoteJid;

        // Get full text after command
        const fullBody = message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            '';

        const lines = fullBody.split('\n');
        lines.shift(); // Remove the command line
        const inputText = lines.join('\n').trim();

        if (!inputText) {
            const helpText = `
⚠️ *Format Morning Briefing PMS Salah!*

*Contoh Cara Kirim:*
/morningbreafingpms
30/7/26
09-18 Ferry
13-22 Rama
off Prass
phantom TP Hizky
            `.trim();
            return await sock.sendMessage(jid, { text: helpText });
        }

        if (!ai) {
            return await sock.sendMessage(jid, { text: '⚠️ GEMINI_API_KEY belum dikonfigurasi.' });
        }

        await sock.sendMessage(jid, { text: '⏳ Memproses & memparsing Morning Briefing PMS...' });

        const prompt = `
Anda adalah AI parser laporan shift WhatsApp untuk toko PMS (GC-PMS).
Tugas Anda:
1. Analisis data input berikut:
"""
${inputText}
"""

2. Aturan Formatting Shift (SCHEDULE_AREA):
- Normalisasi Tanggal ke format bersih seperti "30 Juli 2026" atau "30/07/2026" dan ganti placeholder {{DATE}}.
- Format jadwal shift ("{{SCHEDULE_AREA}}"):
  - Jam kerja (misal "09-18 Ferry") ubah ke "(09:00 - 18:00) Ferry". Pisahkan tiap entri shift jam dengan baris "~~~~~~~~".
  - Jika ada staff OFF (misal "off Prass"), buat seksi "Off : Prass" lalu ikuti baris "~~~~". Jika tidak ada data off, SKIP seksi Off.
  - Jika ada staff Phantom (misal "phantom TP Hizky"), buat seksi "Phantom (TP) : Hizky". Jika tidak ada data phantom, SKIP seksi Phantom.

3. Masukkan hasil ke struktur template baku berikut:
"""
${PMS_TEMPLATE_STRUCTURE}
"""

4. KELUARKAN HASIL HANYA DALAM FORMAT JSON BERSIH TANPA MARKDOWN BACKTICKS:
{
  "formattedText": "Isi lengkap template yang sudah terisi"
}
        `.trim();

        let jsonResult = null;
        let lastError = null;

        for (const modelName of CANDIDATE_MODELS) {
            try {
                const response = await ai.models.generateContent({
                    model: modelName,
                    contents: prompt,
                });

                const rawText = response.text || '';
                const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                jsonResult = JSON.parse(cleanJson);
                if (jsonResult && jsonResult.formattedText) break;
            } catch (err) {
                lastError = err;
                console.warn(`[PMS_BRIEFING] Model ${modelName} failed:`, err.message);
            }
        }

        if (!jsonResult || !jsonResult.formattedText) {
            const errReply = lastError ? lastError.message : 'Gagal memparsing template dengan AI.';
            return await sock.sendMessage(jid, { text: `❌ Error: ${errReply}` });
        }

        let { formattedText } = jsonResult;
        const mentionedJids = [];

        // Test mention for Ferry (085190070393)
        if (/Ferry/i.test(formattedText)) {
            formattedText = formattedText.replace(/Ferry/gi, '@6285190070393');
            mentionedJids.push('6285190070393@s.whatsapp.net');
        }

        try {
            // Send pure text with mentions directly to the hardcoded Target Group JID (PMS group)
            await sock.sendMessage(TARGET_GROUP_JID, { 
                text: formattedText,
                mentions: mentionedJids
            });

            // If triggered from personal chat, also send confirmation to user's personal chat
            if (jid !== TARGET_GROUP_JID) {
                try {
                    await sock.sendMessage(jid, {
                        text: `✅ *Morning Briefing PMS Berhasil Dikirim ke Grup PMS!*\n\n*Preview Terkirim:*\n\n${formattedText}`,
                        mentions: mentionedJids
                    });
                } catch (e) {
                    console.warn('[PMS_BRIEFING] Personal chat confirmation skipped:', e.message);
                }
            }
        } catch (err) {
            console.error('[PMS_BRIEFING] Error sending message to group:', err);
            try {
                await sock.sendMessage(jid, { text: `❌ Gagal mengirim ke grup target: ${err.message}` });
            } catch (e) {}
        }
    }
};
