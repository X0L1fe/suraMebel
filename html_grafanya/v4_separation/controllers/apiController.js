const { setupDatabase } = require('../db/database');
const { readFileSync } = require('fs');
const path = require('path');
const { fetchPeriods } = require('../services/externalApiService');
require('dotenv').config();

const db = setupDatabase();
const machinesFilePath = path.join(__dirname, '..', process.env.MACHINES_FILE_PATH);

const getMachines = (req, res) => {
    try {
        const machinesData = readFileSync(machinesFilePath, 'utf8');
        const machinesJson = JSON.parse(machinesData);
        const machines = machinesJson.machines.map(machine => ({
            name: machine.name,
            displayName: machine.name,
            modalSelector: machine.modalSelector,
            consumptionSelector: machine.consumptionSelector
        }));
        res.json(machines);
    } catch (err) {
        console.error('Ошибка чтения файла станков:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
};

const getHourData = async (req, res) => {
    try {
        // Получение данных из таблицы data
        const rows = await queryDatabase('SELECT * FROM data WHERE machine_name = ?', [req.params.machine_name]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Данные не найдены' });
        }

        const processedRows = rows.map(row => ({
            timestamp: row.time,
            record: JSON.parse(row.record) // Предположим, что `record` - это JSON-объект
        }));

        res.json(processedRows);
    } catch (err) {
        console.error('Ошибка получения данных за час:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
};

const getDayData = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);  // Начало дня

        const rows = await queryDatabase(
            'SELECT * FROM hour WHERE machine_name = ? AND timestamp >= ?',
            [req.params.machine_name, today]
        );
        //console.log(rows);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Данные не найдены' });
        }
        
        const periods = await fetchPeriods(req.params.machine_name); // Передаем имя машины для фильтрации

        const dayDataWithPeriods = integratePeriods(rows, periods);
        res.json(dayDataWithPeriods);
        console.log(dayDataWithPeriods);
    } catch (err) {
        console.error('Ошибка получения данных за день:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
};

const convertToMoscowTime = (utcTime) => {
    const date = new Date(utcTime);
    const moscowOffset = 3 * 60;  // Смещение для Москвы — UTC+3 в минутах
    const localTime = new Date(date.getTime() + (moscowOffset * 60 * 1000));
    return localTime;
};

const integratePeriods = (rows, periods) => {
    return rows.map(entry => {
        const hourEnd = convertToMoscowTime(entry.timestamp);
        const hourStart = new Date(hourEnd);
        hourStart.setMinutes(hourEnd.getMinutes() - 55);
        const relevantPeriods = periods.filter(period => {
            const periodStart = new Date(period.start_time+"Z").getTime();
            const periodEnd = new Date(period.end_time+"Z").getTime();
            console.log(`${periodStart} - ${periodEnd}`);
            return periodStart < hourEnd.getTime() && periodEnd > hourStart.getTime();
        });

        const periodProportions = relevantPeriods.length > 0 ? relevantPeriods.map(period => {
            const proportion = getPeriodProportion(period, hourStart.getTime(), hourEnd.getTime());
            console.log(proportion)
            return {
                reason: period.reason,
                proportion
            };
        }) : [];

        const parsedRecord = entry.record ? JSON.parse(entry.record) : {};
        const value = parsedRecord.average || 0;

        return {
            time: hourEnd.toISOString(),  // Конец периода как время отчета
            value,  // Значение из записи
            periodProportions  // Пропорции времени для каждой причины
        };
    });
};

// Функция для вычисления длительности периода в часе
function getPeriodProportion(period, periodStartTime, periodEndTime) {
    const periodStart = convertToMoscowTime(period.start_time);
    const periodEnd = convertToMoscowTime(period.end_time);
    console.log(`${periodStart.toISOString()} - ${periodEnd.toISOString()}`);
    // Вычисляем пересечение периода с заданным временным интервалом
    const effectiveStart = Math.max(periodStart.getTime(), periodStartTime);  // Позднее начало
    const effectiveEnd = Math.min(periodEnd.getTime(), periodEndTime);  // Ранний конец

    if (effectiveEnd <= effectiveStart) return 0;  // Если пересечений нет

    const overlapDuration = effectiveEnd - effectiveStart;
    const totalDuration = periodEndTime - periodStartTime;
    return overlapDuration / totalDuration;  // Пропорция пересечения
}

const getPeriodsData = async (req, res) => {
    try {
        const periods = await fetchPeriods();
        res.json(periods);
    } catch (err) {
        console.error('Ошибка получения данных о периодах:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
};

const getWeekData = async (req, res) => {
    try {
        const rows = await queryDatabase('SELECT * FROM week WHERE machine_name = ?', [req.params.machine_name]);
        res.json(rows);
    } catch (err) {
        console.error('Ошибка получения данных за неделю:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
};

const getMonthData = async (req, res) => {
    try {
        const rows = await queryDatabase('SELECT * FROM month WHERE machine_name = ?', [req.params.machine_name]);
        res.json(rows);
    } catch (err) {
        console.error('Ошибка получения данных за месяц:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
};

const queryDatabase = (query, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};
module.exports = { getHourData, getDayData, getWeekData, getMonthData, getPeriodsData, getMachines };