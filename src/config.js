module.exports = {
    // Server Port
    PORT: process.env.PORT || 3000,

    // Telegram Config
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
    ADMIN_ID: process.env.ADMIN_ID,
    ADMIN_PIN: process.env.ADMIN_PIN || "000000",
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,

    // Google Sheets Config
    SHEET_ID: process.env.SHEET_ID,

    // Special Audit Key
    SPECIAL_AUDIT_KEY: process.env.SPECIAL_AUDIT_KEY,

    // Gemini API Keys (Supported format: "KEY1,KEY2,KEY3")
    GEMINI_API_KEYS: (process.env.GEMINI_API_KEYS || "").split(",").filter(k => k.trim() !== ""),

    // Tab Names (Configurable via ENV or default)
    TAB: {
        LOKER: process.env.TAB_LOKER || "JOB_DATABASE",
        USER: process.env.TAB_USER || "USER_PROFILES",
        SOURCE: process.env.TAB_SOURCE || "SOURCE_LIST"
    }
};