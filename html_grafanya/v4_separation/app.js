require('dotenv').config();
const express = require('express');
const path = require('path');
const { setupDatabase } = require('./db/database');
const apiRoutes = require('./routes/apiRoutes');
const cron = require('node-cron');
const { fetchDataAndStore } = require('./services/fetchService');

const app = express();
const port = process.env.PORT || 3000;
const db = setupDatabase();

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRoutes);

// Schedule the task to run every 5 minutes
cron.schedule('*/5 * * * *', async () => {
    try {
        await fetchDataAndStore();
    } catch (err) {
        console.error('Error fetching data:', err);
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
