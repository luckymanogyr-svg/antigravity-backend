const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const CONFIG = require('../config');

// Setup Local DB Path (Untuk simulasi PropertiesService & Fallback)
const JSON_DB_PATH = path.join(__dirname, '../../data/local_db.json');
if (!fs.existsSync(path.dirname(JSON_DB_PATH))) fs.mkdirSync(path.dirname(JSON_DB_PATH), { recursive: true });

let authClient = null;

// Buat fungsi init yang bisa dipanggil kapan saja
const initAuth = async () => {
    if (authClient) return authClient;
    try {
        // 1. Cek Environment Variable (Production)
        if (process.env.GOOGLE_CREDENTIALS) {
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            authClient = await auth.getClient();
            return authClient;
        }

        // 2. Cek File Lokal (Development)
        const credentialsPath = path.join(__dirname, '../../credentials.json');
        if (fs.existsSync(credentialsPath)) {
            const auth = new google.auth.GoogleAuth({
                keyFile: credentialsPath,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            authClient = await auth.getClient();
            return authClient;
        }
    } catch (e) { console.error('❌ Auth Error:', e); }
    return null;
};

// --- Update Fungsi Wrapper agar memanggil initAuth secara internal ---
const getSheetData = async (tabName) => {
    const auth = await initAuth(); // Panggil di sini
    if (auth) {
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SHEET_ID, range: `${tabName}!A2:M`
        });
        return res.data.values || [];
    }
    // Fallback Local
    if (!fs.existsSync(JSON_DB_PATH)) return [];
    const db = JSON.parse(fs.readFileSync(JSON_DB_PATH));
    return db[tabName] || [];
};

const appendRow = async (tabName, values) => {
    if (authClient) {
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        await sheets.spreadsheets.values.append({
            spreadsheetId: CONFIG.SHEET_ID,
            range: tabName,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [values] },
        });
    } else {
        // Fallback Local
        let db = fs.existsSync(JSON_DB_PATH) ? JSON.parse(fs.readFileSync(JSON_DB_PATH)) : {};
        if (!db[tabName]) db[tabName] = [];
        db[tabName].push(values);
        fs.writeFileSync(JSON_DB_PATH, JSON.stringify(db, null, 2));
    }
};

// --- Specific Wrappers ---
const saveJob = async (row) => await appendRow(CONFIG.TAB.LOKER, row);
const saveUserProfile = async (row) => await appendRow(CONFIG.TAB.USER, row);
const getSources = async () => {
    const data = await getSheetData(CONFIG.TAB.SOURCE);
    return data.slice(1); // Skip Header
};
const getAllJobs = async () => {
    const data = await getSheetData(CONFIG.TAB.LOKER);
    return data.slice(1);
};
const getAllUsers = async () => {
    const data = await getSheetData(CONFIG.TAB.USER);
    return data.slice(1);
};

// Fungsi Get User Profile by ID (Persis logika GAS)
const getUserProfileFromDB = async (userID) => {
    const data = await getAllUsers();
    // Loop cari User ID (Kolom A)
    for (let i = 0; i < data.length; i++) {
        if (String(data[i][0]) === String(userID)) {
            return {
                nama: data[i][1],
                summary: data[i][2],
                skills: data[i][3],
                experience: data[i][6] || "-" // Kolom G
            };
        }
    }
    return null;
};

module.exports = {
    getSheetData, appendRow, saveJob, saveUserProfile,
    getSources, getAllJobs, getAllUsers, getUserProfileFromDB
};