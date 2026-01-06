const axios = require('axios');
const CONFIG = require('../config');

// Fungsi Utama Fetch Gemini (Support Text & Multimodal)
const fetchGemini = async (payload, customKey = null) => {
    const modelName = "gemini-2.5-flash";
    const keys = CONFIG.GEMINI_API_KEYS;

    // Jika ada custom key (misal utk Audit), pakai itu. Jika tidak, pakai rotasi.
    const keyList = customKey ? [customKey] : keys;

    for (let k = 0; k < keyList.length; k++) {
        const currentKey = keyList[k].trim();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${currentKey}`;

        try {
            const response = await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.data && response.data.candidates && response.data.candidates.length > 0) {
                return response.data.candidates[0].content.parts[0].text;
            }
        } catch (error) {
            if (error.response && error.response.status === 429) {
                console.warn(`⚠️ Key ke-${k + 1} limit. Ganti key...`);
                continue; // Coba key berikutnya
            }
            console.error(`❌ Gemini Error (${currentKey.slice(0, 5)}...):`, error.message);
        }
    }
    return "Error: Semua API Key gagal.";
};

// Wrapper Text Only
const generateText = async (prompt) => {
    return await fetchGemini({
        contents: [{ parts: [{ text: prompt }] }]
    });
};

// Wrapper Multimodal (Gambar/PDF)
const generateMultimodal = async (prompt, base64Data, mimeType) => {
    return await fetchGemini({
        contents: [{
            parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64Data } }
            ]
        }]
    });
};

module.exports = { fetchGemini, generateText, generateMultimodal };