const fs = require('fs');
const path = require('path');
require('dotenv').config();
const machinesFilePath = path.join(__dirname, '..', process.env.MACHINES_FILE_PATH);


const machines = JSON.parse(fs.readFileSync(machinesFilePath, 'utf8')).machines;

function transformDataToHourly(db) {
    db.all('SELECT * FROM data', (err, rows) => {
        if (err) {
            console.error('Error reading data:', err);
            return;
        }


        const machinesData = {};

        rows.forEach(row => {
            if (!machinesData[row.machine_name]) {
                machinesData[row.machine_name] = [];
            }
            machinesData[row.machine_name].push(row);
        });

        Object.keys(machinesData).forEach(machineName => {
            const machineData = machinesData[machineName];
            if (machineData.length === 12) {
                const total = machineData.reduce((sum, entry) => sum + JSON.parse(entry.record).current, 0);
                const average = total / machineData.length;

                const stmt = db.prepare('INSERT INTO hour (machine_name, timestamp, record) VALUES (?, ?, ?)');
                stmt.run(machineName, new Date().toISOString(), JSON.stringify({ average }));
                stmt.finalize();

                db.run('DELETE FROM data WHERE machine_name = ?', machineName, err => {
                    if (err) {
                        console.error(`Error clearing data for machine ${machineName}:`, err);
                    } else {
                        console.log(`Data cleared for machine ${machineName}`);
                    }

                    checkAndTransformToDaily(db, machineName);
                });
            }
        });
    });
}

function checkAndTransformToDaily(db, machineName) {
    db.all('SELECT * FROM hour WHERE machine_name = ?', [machineName], (err, rows) => {
        if (err) {
            console.error('Error fetching hour data:', err);
            return;
        }

        if (rows.length >= 24) {
            const total = rows.reduce((sum, row) => sum + JSON.parse(row.record).average, 0);
            const dailyAverage = total / rows.length;

            const stmt = db.prepare('INSERT INTO day (machine_name, date, average) VALUES (?, ?, ?)');
            stmt.run(machineName, new Date().toISOString(), dailyAverage);
            stmt.finalize(() => {
                console.log(`Daily average for machine ${machineName} saved to database`);
                db.run('DELETE FROM hour WHERE machine_name = ?', [machineName]);
            });

            checkAndTransformToWeekly(db, machineName);
        }
    });
}

function checkAndTransformToWeekly(db, machineName) {
    db.all('SELECT * FROM day WHERE machine_name = ?', [machineName], (err, rows) => {
        if (err) {
            console.error('Error fetching day data:', err);
            return;
        }

        if (rows.length >= 7) {
            const total = rows.reduce((sum, row) => sum + row.average, 0);
            const weeklyAverage = total / rows.length;

            const stmt = db.prepare('INSERT INTO week (machine_name, week, average) VALUES (?, ?, ?)');
            const firstDate = new Date(rows[0].date);
            const year = firstDate.getFullYear();
            const weekNumber = getWeekNumber(firstDate);
            const weekIdentifier = `${year}-${weekNumber}`;
            stmt.run(machineName, weekIdentifier, weeklyAverage);
            stmt.finalize(() => {
                console.log(`Weekly average for machine ${machineName} saved to database`);
                db.run('DELETE FROM day WHERE machine_name = ?', [machineName]);
            });

            checkAndTransformToMonthly(db, machineName);
        }
    });
}

function getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

function checkAndTransformToMonthly(db, machineName) {
    db.all('SELECT * FROM week WHERE machine_name = ?', [machineName], (err, rows) => {
        if (err) {
            console.error('Error fetching week data:', err);
            return;
        }

        const currentDate = new Date();
        const currentMonth = currentDate.getMonth();
        const currentYear = currentDate.getFullYear();
        const daysInCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

        const weeksInMonth = Math.floor(daysInCurrentMonth / 7);

        if (rows.length >= weeksInMonth) {
            const total = rows.reduce((sum, row) => sum + row.average, 0);
            const monthlyAverage = total / rows.length;

            const stmt = db.prepare('INSERT INTO month (machine_name, month, average) VALUES (?, ?, ?)');
            const startOfMonth = rows[0].week.split(' - ')[0];
            const endOfMonth = rows[rows.length - 1].week.split(' - ')[1];
            stmt.run(machineName, `${startOfMonth} - ${endOfMonth}`, monthlyAverage);
            stmt.finalize(() => {
                console.log(`Monthly average for machine ${machineName} saved to database`);
                db.run('DELETE FROM week WHERE machine_name = ?', [machineName]);
            });
        }
    });
}

module.exports = { transformDataToHourly };