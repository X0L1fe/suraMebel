const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { transformDataToHourly } = require('./transformService');
require('dotenv').config();

async function fetchDataAndStore() {
    try {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto('https://dash.wqtt.ru/');
        await page.waitForSelector('form.user');
        await page.type('#id_username', process.env.PUPPETEER_USERNAME);
        await page.type('#id_password', process.env.PUPPETEER_PASSWORD);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('button[type="submit"]')
        ]);

        const machinesConfigPath = process.env.MACHINES_FILE_PATH;
        const machinesConfig = JSON.parse(await fs.readFile(machinesConfigPath, 'utf8'));

        const db = require('../db/database').setupDatabase();

        for (const machine of machinesConfig.machines) {
            const { name, modalSelector, consumptionSelector } = machine;
            const cleanedSelector = modalSelector.trim();

            try {
                await page.waitForSelector(cleanedSelector);
            } catch (error) {
                console.error(`Error waiting for selector ${cleanedSelector} on machine ${name}:`, error);
                continue;
            }

            const machineData = await page.evaluate((consumptionSelector) => {
                const currentConsumption = document.querySelector(consumptionSelector).innerText;

                // Получение текущего времени в UTC
                let utcTime = new Date();

                // Добавляем 3 часа для получения времени в МСК
                utcTime.setHours(utcTime.getHours() + 3);

                // Преобразуем в ISO формат без суффикса 'Z'
                const mskTime = utcTime.toISOString().slice(0, -1);

                return {
                    time: mskTime,
                    current: parseFloat(currentConsumption)
                };
            }, consumptionSelector);

            const stmt = db.prepare('INSERT INTO data (machine_name, time, record) VALUES (?, ?, ?)');
            console.log('Data added successfully');
            stmt.run(name, machineData.time, JSON.stringify({ current: machineData.current }));
            stmt.finalize();
        }

        await browser.close();

        // Добавляем вызов функции преобразования после успешной записи 12 записей
        transformDataToHourly(db);

    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

module.exports = { fetchDataAndStore };
