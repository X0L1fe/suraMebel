// routes/apiRoutes.js
const express = require('express');
const router = express.Router();
const { getHourData, getDayData, getWeekData, getMonthData, getPeriodsData, getMachines } = require('../controllers/apiController');

router.get('/machines', getMachines);
router.get('/machine/:machine_name/day-data', getDayData);
router.get('/machine/:machine_name/week-data', getWeekData);
router.get('/machine/:machine_name/month-data', getMonthData);
router.get('/machine/:machine_name/hour-data', getHourData);
router.get('/machine/:machine_name/periods-data', getPeriodsData);

module.exports = router;
