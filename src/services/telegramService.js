const axios = require('axios');
const CONFIG = require('../config');

const sendMessage = async (chatId, text, replyMarkup = null) => {
    try {
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        };
        if (replyMarkup) payload.reply_markup = replyMarkup;

        await axios.post(`https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`, payload);
    } catch (e) {
        console.error(`❌ Gagal kirim TG ke ${chatId}:`, e.message);
    }
};

// Untuk Log Cerewet
const broadcastLog = async (text) => {
    await sendMessage(CONFIG.LOG_CHANNEL_ID, text);
};

// Download File (Gambar/PDF) dari Telegram
const getFile = async (fileId) => {
    try {
        // 1. Get File Path
        const resPath = await axios.get(`https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
        const filePath = resPath.data.result.file_path;

        // 2. Download Content
        const fileUrl = `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_TOKEN}/${filePath}`;
        const resFile = await axios.get(fileUrl, { responseType: 'arraybuffer' });

        return Buffer.from(resFile.data);
    } catch (e) {
        console.error("❌ Gagal download file TG:", e.message);
        throw e;
    }
};

module.exports = { sendMessage, broadcastLog, getFile };