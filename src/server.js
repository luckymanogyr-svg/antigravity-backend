const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer'); // Untuk upload file
const CONFIG = require('./config');

// Import Services
const telegramService = require('./services/telegramService');
const scraperService = require('./services/scraperService');
const sheetService = require('./services/sheetService');
const geminiService = require('./services/geminiService');
const auditService = require('./services/auditService');

const app = express();
const upload = multer({ storage: multer.memoryStorage() }); // Simpan file di RAM sementara

app.use(bodyParser.json());

// ✅ SAJIKAN FOLDER PUBLIC (Agar index.html bisa dibuka)
app.use(express.static(path.join(__dirname, '../public'), { index: false }));

// ==========================================
// 1. API ROUTES (Untuk Frontend Dashboard)
// ==========================================

// A. DASHBOARD DATA (Status + Jobs + Logs)
app.get('/api/dashboard', async (req, res) => {
    try {
        const status = scraperService.getStatus();
        const logs = scraperService.getLiveLogs();

        // 1. Ambil data mentah (Pastikan nama variabel adalah 'jobs')
        const jobs = await sheetService.getAllJobs();

        // 2. Proses data (Sekarang variabel 'jobs' sudah didefinisikan di atas)
        const formattedJobs = jobs
            .filter(j => j[0] && j[4] && !String(j[4]).includes("Not specified"))
            .reverse()
            .map(j => ({
                id: j[0],
                tgl_post: j[1],
                posisi: j[4],
                perusahaan: j[5],
                lokasi: j[6],
                link: (j[12] && String(j[12]).includes("http")) ? j[12] : "#"
            }));

        res.json({
            status: status,
            logs: logs,
            jobs: formattedJobs
        });
    } catch (e) {
        // Jika terjadi error lagi, akan muncul di console terminal Anda
        console.error("Dashboard Error:", e.message);
        res.json({ status: "ERROR", logs: [e.message], jobs: [] });
    }
});

// B. CONTROL SYSTEM (Start/Stop/Reset)
app.post('/api/start', (req, res) => {
    const { pin } = req.body;
    if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ message: "⛔ PIN SALAH!" });

    const status = scraperService.jalankanAutoHunting();
    if (status === "BUSY") {
        res.json({ message: "⚠️ Mesin sedang berjalan!" });
    } else {
        res.json({ message: "🚀 Mesin Dinyalakan!" });
    }
});

app.post('/api/stop', async (req, res) => {
    const { pin } = req.body;
    if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ message: "⛔ PIN SALAH!" });

    await scraperService.stopHunting();
    res.json({ message: "🛑 Sinyal STOP Diterima." });
});

app.post('/api/reset', async (req, res) => {
    const { pin } = req.body;
    if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ message: "⛔ PIN SALAH!" });

    await scraperService.resetSystem();
    res.json({ message: "🔄 Sistem Berhasil Direset." });
});

// C. CV & PROFILING
// 1. Parse PDF
app.post('/api/cv/parse', upload.single('file_cv'), async (req, res) => {
    if (!req.file) return res.json({ success: false, msg: "File tidak ditemukan" });

    try {
        const base64 = req.file.buffer.toString('base64');
        const prompt = "Extract CV to JSON: {nama, summary, skills, experience (paragraph)} in Indonesian.";

        const resAI = await geminiService.generateMultimodal(prompt, base64, "application/pdf");
        const json = JSON.parse(resAI.replace(/```json/g, "").replace(/```/g, "").trim());

        res.json({ success: true, data: json });
    } catch (e) {
        res.json({ success: false, msg: "Gagal Parse AI: " + e.message });
    }
});

// 2. Simpan Profil ke Sheet
app.post('/api/cv/save', async (req, res) => {
    try {
        const data = req.body;
        const id = "WEB-" + Date.now();
        // Urutan: ID, Nama, Summary, Skills, Tgl, Source, Experience
        await sheetService.saveUserProfile([
            id, data.nama, data.summary, data.skills, new Date(), data.label, data.experience
        ]);
        res.json({ success: true, userID: id, label: data.label, nama: data.nama });
    } catch (e) {
        res.json({ success: false, msg: e.message });
    }
});

// 3. Hapus Profil (Perlu implementasi di sheetService, tapi kita bypass dulu jika belum ada)
app.post('/api/cv/delete', async (req, res) => {
    // Note: Pastikan Anda menambahkan fungsi deleteWebProfile di sheetService.js jika ingin fitur ini jalan sempurna
    // Untuk sekarang kita return success simulasi
    res.json("✅ Profil dihapus dari database (Simulasi).");
});

// D. AI GENERATOR (Surat Lamaran)
app.post('/api/generate-lamaran', async (req, res) => {
    const { jobId, format, userId } = req.body;

    try {
        // 1. Ambil Data Job & User
        const allJobs = await sheetService.getAllJobs();
        const job = allJobs.find(r => r[0] === jobId);
        const user = await sheetService.getUserProfileFromDB(userId);

        if (!job) return res.json({ teks: "❌ Error: Loker tidak ditemukan." });
        if (!user) return res.json({ teks: "⚠️ Error: Profil User tidak ditemukan." });

        // 2. Buat Prompt
        const prompt = `
        ROLE: Career Coach. BAHASA: Indonesia Formal.
        DATA PELAMAR: Nama: ${user.nama}, Skill: ${user.skills}, Exp: ${user.experience}.
        LOKER: ${job[4]} di ${job[5]}.
        TUGAS: Buatkan ${format === 'WA' ? 'Pesan WhatsApp singkat sopan' : 'Cover Letter Email formal'}.
        Hubungkan skill pelamar dengan loker. Hapus placeholder [ ].
        `;

        // 3. Generate
        const text = await geminiService.generateText(prompt);
        res.json({ teks: text });

    } catch (e) {
        res.json({ teks: "❌ Server Error: " + e.message });
    }
});

// E. SMART AUDIT
app.post('/api/audit', async (req, res) => {
    const { jobId, chatHistory, userId } = req.body;
    // Panggil service audit yang sudah kita buat sebelumnya
    const result = await auditService.runSmartAudit(jobId, chatHistory || [], userId);
    res.json(result);
});

// ==========================================
// 2. TELEGRAM WEBHOOK (Logic Lama)
// ==========================================
app.post('/webhook', async (req, res) => {
    const update = req.body;

    if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text;
        const userNama = msg.from.first_name;

        // Command Handler
        if (text === "/start" || text === "/menu") {
            const keyboard = {
                inline_keyboard: [
                    [{ text: "🚀 Start Hunt", callback_data: "MENU_FORCE_HUNT" }, { text: "⛔ Stop", callback_data: "MENU_STOP_HUNT" }],
                    [{ text: "🔍 Cari Loker", callback_data: "MENU_SEARCH" }, { text: "👮 Cek Karantina", callback_data: "MENU_AUDIT" }]
                ]
            };
            await telegramService.sendMessage(chatId, `Halo ${userNama}! Control Panel Siap.`, JSON.stringify(keyboard));
        }
        // Handle PDF CV via Telegram
        else if (msg.document && msg.document.mime_type === "application/pdf") {
            await telegramService.sendMessage(chatId, "📂 **Menerima CV...**\nSedang membaca...");
            try {
                const buffer = await telegramService.getFile(msg.document.file_id);
                const base64 = buffer.toString('base64');
                const prompt = "Extract CV to JSON: {summary, hard_skills[], soft_skills[], experience_summary}";

                const resAI = await geminiService.generateMultimodal(prompt, base64, "application/pdf");
                const json = JSON.parse(resAI.replace(/```json/g, "").replace(/```/g, "").trim());

                const id = "CV-" + Date.now();
                const skills = [...(json.hard_skills || []), ...(json.soft_skills || [])].join(", ");

                await sheetService.saveUserProfile([id, userNama, json.summary, skills, new Date(), "Telegram", json.experience_summary]);
                await telegramService.sendMessage(chatId, "✅ **CV Berhasil Disimpan!**");
            } catch (e) {
                await telegramService.sendMessage(chatId, "❌ Gagal baca CV: " + e.message);
            }
        }
    }

    // Callback Handler
    if (update.callback_query) {
        const cb = update.callback_query;
        const chatId = cb.message.chat.id;
        const data = cb.data;

        if (data === "MENU_FORCE_HUNT") {
            telegramService.sendMessage(chatId, "🚀 **Command Received.** Engine Starting...");
            scraperService.jalankanAutoHunting();
        } else if (data === "MENU_STOP_HUNT") {
            scraperService.stopHunting();
            telegramService.sendMessage(chatId, "⛔ **Stopping Engine...**");
        }
    }
    res.sendStatus(200);
});


// ==========================================
// 3. START SERVER
// ==========================================

// Halaman Pembuka (Landing Page) saat pertama buka localhost:3000
app.get('/', (req, res) => {
    // Karena server.js di dalam folder 'src', kita keluar satu tingkat ke '../'
    res.sendFile(path.join(__dirname, '../public/welcome.html'));
});

// Jalur alternatif jika ingin akses manual localhost:3000/welcome
app.get('/welcome', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/welcome.html'));
});

// Halaman Dashboard Utama
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});
