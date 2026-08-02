const { GoogleGenAI } = require('@google/genai');

// Primary ultra-fast model and powerful fallback model
const CANDIDATE_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
];

module.exports = {
    name: 'ai',
    description: 'Tanya Gemini AI (Fast & Intelligent via Vertex AI)',
    execute: async (sock, message, args) => {
        const jid = message.key.remoteJid;
        const prompt = args.join(' ');

        if (!prompt) {
            return await sock.sendMessage(
                jid, 
                { text: 'Format salah!\nContoh: `/ai Siapa presiden Indonesia pertama?`' }, 
                { quoted: message }
            );
        }

        const project = 'project-a2bb3a13-c8e1-4097-92d';
        process.env.GOOGLE_CLOUD_PROJECT = project;
        process.env.GCP_PROJECT_ID = project;
        const location = process.env.GCP_LOCATION || 'us-central1';

        const ai = new GoogleGenAI({
            vertexai: true,
            project,
            location
        });

        let replyText = null;
        let lastError = null;
        let modelUsed = '';

        // Smart routing: Use gemini-3.5-flash for coding/complex prompts, otherwise default to ultra-fast gemini-3.5-flash-lite
        const isComplexTask = /code|koding|buatkan|script|algoritma|refactor|analisis|modul/i.test(prompt) || prompt.length > 500;
        const modelOrder = isComplexTask 
            ? ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.0-flash']
            : CANDIDATE_MODELS;

        for (const modelName of modelOrder) {
            try {
                const response = await ai.models.generateContent({
                    model: modelName,
                    contents: prompt,
                });
                replyText = response.text;
                if (replyText) {
                    modelUsed = modelName;
                    console.log(`[AI] Generated response using model: ${modelName} (isComplex: ${isComplexTask})`);
                    break;
                }
            } catch (err) {
                lastError = err;
                console.warn(`[AI] Model ${modelName} failed/unavailable:`, err.message);
            }
        }

        if (replyText) {
            await sock.sendMessage(jid, { text: replyText }, { quoted: message });
        } else {
            const errMessage = lastError ? lastError.message : 'Tidak ada respon dari AI.';
            await sock.sendMessage(jid, { text: `Error Gemini AI: ${errMessage}` }, { quoted: message });
        }
    }
};
