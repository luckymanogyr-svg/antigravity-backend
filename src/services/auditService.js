const axios = require('axios');
const CONFIG = require('../config');
const sheetService = require('./sheetService');

const runSmartAudit = async (jobId, chatHistory, userId) => {
    const API_KEY = CONFIG.SPECIAL_AUDIT_KEY;
    // Menggunakan model 2.5-flash sesuai config awal Anda
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

    try {
        // 1. Ambil Data Konteks
        const allJobs = await sheetService.getAllJobs();
        const jobRow = allJobs.find(r => r[0] === jobId);
        const userProfile = await sheetService.getUserProfileFromDB(userId);

        if (!jobRow) return { error: true, teks: "❌ Loker tidak ditemukan." };
        if (!userProfile) return { error: true, teks: "⚠️ Pilih Profil CV dulu." };

        const isInitial = (!chatHistory || chatHistory.length === 0);

        // --- NORMALISASI HISTORY ---
        let cleanedHistory = (chatHistory || []).map(msg => ({
            role: msg.role === "model" ? "model" : "user",
            parts: Array.isArray(msg.parts) ? msg.parts : [{ text: String(msg.parts) }]
        }));

        let systemPrompt = "";
        if (isInitial) {
            systemPrompt = `ROLE: Senior Recruiter. PELAMAR: ${userProfile.nama}, Skill: ${userProfile.skills}, Exp: ${userProfile.experience}. LOKER: ${jobRow[4]} di ${jobRow[5]}.
            TUGAS: Berikan output JSON MURNI: { "score": 0-100,  "leftPanel": "Analisis 3 paragraf pendek tentang Kecocokan, Kekurangan, dan Saran.", "chatText": "Sapaan ramah pembuka chat untuk menawarkan bantuan interview. }`;
        } else {
            systemPrompt = `ROLE: Career Coach & Interview Mentor: ${userProfile.nama}, Skill: ${userProfile.skills}. LOKER: ${jobRow[4]}. TUGAS: Jawab pertanyaan user. Jika user meminta contoh jawaban interview, GUNAKAN data pengalaman/skill di atas agar jawabannya personal. JANGAN PERNAH bilang "Saya tidak punya data Anda". Gaya bahasa: Seperti chat WhatsApp (santai, profesional, tanpa simbol markdown)`;
        }

        // --- FIX 2: Gabungkan System Prompt ke Pesan User Pertama ---
        // Ini mencegah error "dua user berurutan" di Gemini API
        let finalContents = [];
        if (isInitial) {
            finalContents.push({ role: "user", parts: [{ text: systemPrompt }] });
        } else {
            // Jika ada history, sisipkan systemPrompt di bagian paling atas pesan user pertama
            finalContents = [...cleanedHistory];
            if (finalContents[0].role === "user") {
                finalContents[0].parts[0].text = systemPrompt + "\n\nUser Question: " + finalContents[0].parts[0].text;
            }
        }

        const payload = { contents: finalContents };

        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 80000
        });

        // Validasi Respon API
        if (!response.data.candidates || response.data.candidates.length === 0) {
            throw new Error("AI tidak memberikan respon (Candidate Empty).");
        }

        let aiText = response.data.candidates[0].content.parts[0].text;

        // 5. Handling Output (Sesuai Logika GAS Anda)
        if (isInitial) {
            try {
                // Peningkatan isolasi JSON agar lebih akurat dibanding replace biasa
                const firstBracket = aiText.indexOf('{');
                const lastBracket = aiText.lastIndexOf('}');

                if (firstBracket !== -1 && lastBracket !== -1) {
                    const jsonString = aiText.substring(firstBracket, lastBracket + 1);
                    const parsedData = JSON.parse(jsonString);

                    // Mengembalikan format yang diharapkan frontend
                    return {
                        isJson: true,
                        score: parsedData.score,
                        leftPanel: parsedData.leftPanel,
                        chatText: parsedData.chatText
                    };
                }
                throw new Error("Format JSON tidak ditemukan dalam teks AI");
            } catch (e) {
                // Fallback jika parsing gagal (Mirip catch di GAS Anda)
                return {
                    isJson: false,
                    teks: aiText,
                    score: 50,
                    leftPanel: "Analisis gagal diproses ke format UI.",
                    chatText: aiText
                };
            }
        } else {
            // Mode Chat Lanjutan (Sesuai else di GAS Anda)
            return { isJson: false, teks: aiText };
        }

    } catch (e) {
        // Handling Error Axios yang lebih detail dibanding UrlFetchApp
        console.error("❌ Audit Error:", e.response ? JSON.stringify(e.response.data) : e.message);

        // Mengembalikan pesan error yang ramah ke frontend
        const errorMsg = e.response?.data?.error?.message || e.message;
        return {
            error: true,
            teks: "Server Error: " + errorMsg
        };
    }
};

module.exports = { runSmartAudit };