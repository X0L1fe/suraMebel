const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

function connectToExternalDatabase() {
    const dbPath = path.resolve(__dirname, '..', process.env.EXTERNAL_DB_PATH);
    const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Error connecting to external database:', err.message);
        } else {
            console.log('Connected to external SQLite database.');
        }
    });
    return db;
}

const db = connectToExternalDatabase();

function fetchPeriods() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM periods', [], (err, rows) => {
            if (err) {
                reject(`Error querying external database: ${err.message}`);
            } else {
                resolve(rows);
            }
        });
    });
}

module.exports = { fetchPeriods };
