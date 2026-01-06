const axios = require('axios');
const cheerio = require('cheerio');
const geminiService = require('./geminiService');
const sheetService = require('./sheetService');
const telegramService = require('./telegramService');
const CONFIG = require('../config');

// --- BAGIAN ATAS: Tambahkan variabel baru ---
let liveLogs = []; // Menampung log untuk Dashboard

// Helper Fungsi untuk menambah log (Cerewet Mode)
const addLiveLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    const formattedLog = `[${time}] ${msg}`;
    liveLogs.push(formattedLog);

    // Jaga agar log tidak kepenuhan (simpan 50 log terakhir saja)
    if (liveLogs.length > 50) liveLogs.shift();

    console.log(formattedLog); // Tetap muncul di terminal
};

// Fungsi untuk diambil oleh Server.js
const getLiveLogs = () => liveLogs;

// --- BAGIAN LOGIKA: Update broadcastLog ---
// Cari setiap baris yang memanggil telegramService.broadcastLog()
// Tambahkan addLiveLog() di bawahnya agar sinkron.
// Contoh di dalam jalankanAutoHunting:

// await telegramService.broadcastLog(`🕵️ ${i + 1}/${allTargets.length} Mengunjungi: ${name}`);
// addLiveLog(`🕵️ Menyisir sumber: ${name}...`); // <-- Tambahkan ini

// Begitu juga saat sukses:
// addLiveLog(`✅ BERHASIL: Menemukan ${results.length} loker di ${name}`); // <-- Tambahkan ini

// Variabel Kontrol
let isRunning = false;
let forceStop = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const smartCooldown = async (seconds) => {
    console.log(`⏳ Cooldown ${seconds}s...`);
    for (let i = 0; i < seconds; i++) {
        if (forceStop) break;
        await sleep(1000);
    }
};

// Fungsi Cek Duplikasi (Memori)
const isLinkExists = async (url) => {
    const jobs = await sheetService.getAllJobs();
    // Kolom 12 (Index 12) = Link
    return jobs.some(r => r[12] === url);
};

// Helper: Fix Link Relatif (misal: "/job/123" -> "https://web.com/job/123")
const resolveUrl = (baseUrl, relativeUrl) => {
    try {
        if (!relativeUrl || relativeUrl === '#' || relativeUrl.length < 5) return baseUrl;
        if (relativeUrl.startsWith('http')) return relativeUrl;

        // Gabungkan Base URL dengan Relative URL
        const u = new URL(relativeUrl, baseUrl);
        return u.href;
    } catch (e) {
        return baseUrl;
    }
};

// --- FUNGSI INTI: SCRAPE WEBSITE ---
const scrapWebsiteBulk = async (namaWeb, currentUrl) => {
    if (forceStop) return [];

    // Setup Headers
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    };

    try {
        const response = await axios.get(currentUrl, { headers, timeout: 30000 });
        let html = response.data;
        let cleanText = "";

        // Deteksi Tipe Web
        const isDisnakerja = currentUrl.toLowerCase().includes("disnakerja.com");
        const isDisnakerjaList = isDisnakerja && (currentUrl.includes("?s=") || currentUrl.includes("/kategori/"));

        // --- 🧹 HTML CLEANING ---
        const $ = cheerio.load(html);

        // Hapus elemen pengganggu agar AI fokus ke konten utama
        $('script, style, svg, noscript, iframe, header, footer, nav, .ads, .popup, #sidebar').remove();

        if (isDisnakerja) {
            if (isDisnakerjaList) {
                // Ambil area konten utama saja
                cleanText = $('main').html() || $('body').html();
            } else {
                // LOGIKA POST DETAIL DISNAKERJA
                const headerTitle = html.match(/<h1 class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i);
                const specsArea = html.match(/<ul class="gmr-list-specs">([\s\S]*?)<\/ul>/i);
                let contentMatch = html.match(/<div class="entry-content entry-content-single"[\s\S]*?>([\s\S]*?)<div class="dlpro-related-post">/i);
                if (!contentMatch) contentMatch = html.match(/<div class="entry-content entry-content-single"[\s\S]*?>([\s\S]*?)<footer/i);

                cleanText = (headerTitle ? `JUDUL: ${headerTitle[1]}\n` : "") +
                    (specsArea ? `SPECS: ${specsArea[1]}\n` : "") +
                    (contentMatch ? `ISI: ${contentMatch[1]}` : "");
            }
        } else {
            // --- GENERAL WEB ---
            // Kita ambil .html() bukan .text() agar link (<a href>) terbaca oleh AI
            // Kita ambil tag <body> tapi sudah dibersihkan dari script/style diatas
            let bodyHtml = $('body').html() || "";

            // Limit karakter agar tidak error token limit, tapi cukup panjang buat baca list
            cleanText = bodyHtml.replace(/\s+/g, " ").substring(0, 60000);
        }

        // --- 🤖 PROMPT ENGINEERING ---
        let prompt = "";
        const todayStr = new Date().toISOString().split('T')[0];

        if (isDisnakerja) {
            prompt = `
            Role: HTML ANALYST.
            TASK: Extract Jobs from Disnakerja HTML.
            INSTRUCTIONS:
            1. Company: Remove "Lowongan Kerja".
            2. Location: Find "Lokasi:" inside specs. Use it for all positions.
            3. Position: Find text inside <p><strong>Number. Position</strong></p>. 
               CRITICAL: If this specific pattern is NOT found, use the Article Headline/Title as the "posisi". 
               NEVER return "Not specified" or "Unknown".
            4. Output: Combine all positions separated by " | ".
            JSON OUTPUT: [{ "posisi": "...", "perusahaan": "...", "lokasi": "...", "snippet_deskripsi": "...", "link_href": "${currentUrl}" }]
            HTML Source: ${cleanText.substring(0, 40000)}
            `;
        } else {
            // PROMPT GENERAL YANG LEBIH PINTAR CARI LINK
            prompt = `
            ROLE: Data Extractor.
            TASK: Extract job listings from the provided HTML.
            
            CRITICAL INSTRUCTION FOR "link_href":
            - Look for the <a> tag (anchor) associated with the Job Title.
            - Extract the value of the 'href' attribute.
            - If the href is relative (e.g., "/careers/job-123"), KEEP IT AS IS.
            - If no specific link is found for the job, use "#".
            
            OUTPUT JSON Format:
            [{
                "posisi": "Job Title",
                "perusahaan": "Company Name (if available, else use Domain Name)",
                "lokasi": "Location (City/Region) or 'Indonesia'",
                "snippet_deskripsi": "Short summary (max 150 chars)",
                "link_href": "The specific URL to the job detail page"
            }]

            HTML Source:
            ${cleanText}
            `;
        }

        // Call Gemini
        const aiRes = await geminiService.generateText(prompt);
        const jsonMatch = aiRes.match(/\[[\s\S]*\]/);

        let hasilLokal = [];

        if (jsonMatch) {
            const jobs = JSON.parse(jsonMatch[0]);
            for (const job of jobs) {
                if (job.posisi && job.perusahaan) {

                    // --- PERBAIKAN LINK (RESOLVE URL) ---
                    // Mengubah link relatif (/job/123) menjadi absolut (https://web.com/job/123)
                    let finalUrl = resolveUrl(currentUrl, job.link_href);

                    // Deduplikasi
                    if (await isLinkExists(finalUrl)) continue;

                    const id = "AUTO_" + Math.floor(Math.random() * 1000000);
                    const row = [
                        id, todayStr, "VERIFIED", "-",
                        job.posisi, job.perusahaan, job.lokasi || "-", "Hidden", "-",
                        (job.snippet_deskripsi || "-").substring(0, 300), "Cek Link", namaWeb, finalUrl
                    ];

                    await sheetService.saveJob(row);
                    hasilLokal.push({ posisi: job.posisi, pt: job.perusahaan });
                }
            }
        }
        return hasilLokal;

    } catch (e) {
        console.error(`❌ Error ${currentUrl}:`, e.message);
        return [];
    }
};

// --- CONTROLLER UTAMA ---
const jalankanAutoHunting = async () => {
    if (isRunning) return "BUSY";
    isRunning = true;
    forceStop = false;

    let totalTemuan = [];

    try {
        addLiveLog("🏁 Memulai proses Auto Hunting..."); // Sinkron Dashboard
        await telegramService.broadcastLog("🏁 **START HUNTING (Strict Source List)**\nMesin menyisir Database Saja.");

        // 1. Ambil Source Murni dari Sheet/Database
        addLiveLog("📂 Mengambil daftar sumber dari Database...");
        const sourcesRaw = await sheetService.getSources();

        // 2. Mapping Data Sheet ke Format Target
        const allTargets = sourcesRaw.map(row => ({
            name: row[0],
            url: row[1]
        })).filter(target => target.url && target.url.startsWith("http"));

        const targetInfo = `🎯 Target Total: ${allTargets.length} Sumber (Dari Database)`;
        console.log(targetInfo);
        addLiveLog(targetInfo);

        if (allTargets.length === 0) {
            addLiveLog("⚠️ Database Source List Kosong!");
            await telegramService.broadcastLog("⚠️ **Database Source List Kosong!** Harap isi tab SOURCE_LIST.");
        } else {
            addLiveLog("🚀 Mesin siap menyisir target...");
        }

        // 3. Loop Target
        for (let i = 0; i < allTargets.length; i++) {
            if (forceStop) {
                addLiveLog("🛑 Proses dihentikan oleh pengguna.");
                await telegramService.broadcastLog("🛑 **Diberhentikan Manual.**");
                break;
            }

            const { name, url } = allTargets[i];

            const logMsg = `🕵️ ${i + 1}/${allTargets.length} Mengunjungi: ${name}`;
            addLiveLog(logMsg);
            await telegramService.broadcastLog(logMsg);

            const results = await scrapWebsiteBulk(name, url);

            if (results.length > 0) {
                totalTemuan = totalTemuan.concat(results);
                const successMsg = `✅ **SUKSES ${name}:** +${results.length} Loker.`;
                addLiveLog(successMsg);
                await telegramService.broadcastLog(successMsg);
            } else {
                const nihilMsg = `ℹ️ ${name} nihil.`;
                addLiveLog(nihilMsg);
                console.log(nihilMsg);
            }

            if (!forceStop && i < allTargets.length - 1) {
                addLiveLog(`⏳ Memulai cooldown antar target...`);
                await smartCooldown(10);
            }
        }

        // 4. Rekap
        if (!forceStop) {
            let msg = `✅ **SIKLUS SELESAI.**\n📈 Total Baru: ${totalTemuan.length}`;
            if (totalTemuan.length > 0) {
                totalTemuan.slice(0, 5).forEach(t => msg += `\n- ${t.posisi} (${t.pt})`);
            }
            addLiveLog(`🏁 Siklus selesai. Total temuan: ${totalTemuan.length} loker.`);
            await telegramService.broadcastLog(msg);
        }

    } catch (e) {
        addLiveLog(`❌ ERROR FATAL: ${e.message}`);
        await telegramService.broadcastLog("❌ **Error Fatal:** " + e.message);
    } finally {
        isRunning = false;
        forceStop = false;
        addLiveLog("💤 Mesin kembali ke mode IDLE.");
    }
};

// --- FUNGSI KONTROL SISTEM ---
const stopHunting = async () => {
    if (!isRunning) return "ALREADY_IDLE";
    forceStop = true;
    await telegramService.broadcastLog("🛑 **Perintah STOP diterima.**\nMenunggu proses satu link ini selesai...");
    return "STOP_SIGNAL_SENT";
};

const resetSystem = async () => {
    isRunning = false;
    forceStop = false;
    console.log("🔄 SYSTEM RESET: Status dikembalikan ke IDLE.");
    await telegramService.broadcastLog("🔄 **RESET SYSTEM BERHASIL.**\nStatus bot dikembalikan ke IDLE (Siap Start).");
    return "SYSTEM_RESET_OK";
};

const getStatus = () => isRunning ? "BUSY" : "IDLE";

module.exports = {
    jalankanAutoHunting,
    stopHunting,
    resetSystem,
    getStatus,
    getLiveLogs // <-- Tambahkan ini
};