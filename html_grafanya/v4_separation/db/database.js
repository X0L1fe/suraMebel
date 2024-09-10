const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

function setupDatabase() {
    const dbPath = path.join(__dirname, '..', process.env.DB_PATH);
    const db = new sqlite3.Database(dbPath);

    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_name TEXT,
            time TEXT,
            record TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS hour (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_name TEXT,
            timestamp TEXT,
            record TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS day (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_name TEXT,
            date TEXT,
            average REAL
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS week (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_name TEXT,
            week TEXT,
            average REAL
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS month (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_name TEXT,
            month TEXT,
            average REAL
        )`);
    });

    return db;
}

module.exports = { setupDatabase };
