async function drawChart(apiEndpoint, elementId, type) {
    try {
        const response = await fetch(apiEndpoint);
        if (!response.ok) {
            throw new Error(`Ошибка сети: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.length === 0) {
            console.warn(`Нет данных для отображения с ${apiEndpoint}`);
            return; // Выход из функции, если данные отсутствуют
        }

        const machineName = getMachineNameFromApiEndpoint(apiEndpoint);

        if (!Array.isArray(data)) {
            throw new Error('Ожидаемый формат данных - массив.');
        }

        let periodsData = [];
        if (type === 'hour' || type === 'day') {
            const periodsResponse = await fetch(`/api/machine/${machineName}/periods-data`);
            periodsData = await periodsResponse.json();
        }

        const processedData = data.map(d => {
            //console.log(`Обработка записи:`, d);

            let time = null;
            let value = null;
            let weekRange = '';

            if (type === 'hour' && d.timestamp) {
                // Обработка часовых данных
                time = new Date(d.timestamp);
                if (isNaN(time.getTime())) {
                    console.error(`Ошибка обработки временной метки: Invalid Date. Временная метка: ${d.timestamp}`);
                    return null; // Пропускаем запись с некорректной датой
                }

                try {
                    value = d.record ? (d.record.current ?? JSON.parse(d.record).current) : null;
                } catch (error) {
                    console.error(`Ошибка при парсинге записи: ${error}`);
                    value = null;
                }
            } else if (type === 'day' && d.time) {
                time = d.time;
                try {
                    value = d.value !== undefined ? d.value : null;
                } catch (error) {
                    console.error(`Ошибка при парсинге записи record: ${error}`);
                    value = null;
                }
            } else if (type === 'week' && d.week) {
                // Обработка недельных данных
                const [year, week] = d.week.split('-').map(Number);
                if (!isNaN(year) && !isNaN(week)) {
                    const { startOfWeek, endOfWeek } = getWeekRange(year, week);
                    weekRange = `${formatDate(startOfWeek)} - ${formatDate(endOfWeek)}`;
                    time = startOfWeek;
                } else {
                    console.error(`Ошибка обработки недели: Invalid week format. Данные: ${d.week}`);
                }
                try {
                    value = d.average || null;
                } catch (error) {
                    console.error(`Ошибка при парсинге записи: ${error}`);
                    value = null;
                }
            } else if (type === 'month' && d.record) {
                // Обработка данных за месяц
                try {
                    const record = typeof d.record === 'string' ? JSON.parse(d.record) : d.record;
                    value = record.average !== undefined ? record.average : null;
                    time = d.timestamp ? new Date(d.timestamp) : null;
                } catch (error) {
                    console.error(`Ошибка при парсинге записи: ${error}`);
                    value = null;
                }
            }

            //console.log(`Значение: ${apiEndpoint}`, value);
            let reason = 'Не указана';
            if (type === 'hour' && periodsData.length > 0 && time) {
                reason = getReason(time, periodsData);
            }

            // Возвращаем данные для графика, если они валидны
            return time && value !== null ? { time, value, reason, weekRange } : null;
        }).filter(item => item !== null); // Убираем null значения

        console.log("Дата для графика:", data.map(d => d.time));
        console.log(`Проверка данных для графика: ${apiEndpoint}`, processedData);
        try {
            const response = await fetch(apiEndpoint);
            if (!response.ok) {
                throw new Error(`Ошибка сети: ${response.statusText}`);
            }

            const data = await response.json();
            if (!data || !Array.isArray(data)) {
                console.warn(`Нет данных для отображения с ${apiEndpoint}`);
                return;
            }
        } catch (error) {
            console.error(`ERROR!!! ${apiEndpoint}: ${error}`);
        }
        console.log("Шкала X диапазон:", d3.extent(data, d => d.time));
        console.log("Проверка времени для каждой записи:", data.map(d => d.time));
        renderGanttChart(processedData, elementId, type);
    } catch (error) {
        console.error(`Ошибка при загрузке данных с ${apiEndpoint}: ${error}`);
    }
}

// Функция для получения начала и конца недели
function getWeekRange(year, week) {
    const firstDayOfYear = new Date(year, 0, 1);  // 1 января указанного года
    const dayOffset = (firstDayOfYear.getDay() || 7) - 1;  // смещение для понедельника
    const firstMonday = new Date(firstDayOfYear.setDate(firstDayOfYear.getDate() - dayOffset));  // первый понедельник года
    const startOfWeek = new Date(firstMonday.setDate(firstMonday.getDate() + (week - 1) * 7));  // добавляем недели
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);  // последний день недели (воскресенье)
    return { startOfWeek, endOfWeek };
}

// Вспомогательная функция для форматирования даты (например, "02-09")
function formatDate(date) {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${day}-${month}`;
}

const convertToMoscowTime = (utcTime) => {
    const date = new Date(utcTime);
    const moscowOffset = 3 * 60;  // Смещение для Москвы — UTC+3 в минутах
    const localTime = new Date(date.getTime() + (moscowOffset * 60 * 1000));
    return localTime;
};

// Функция для извлечения имени машины из URL
function getMachineNameFromApiEndpoint(apiEndpoint) {
    const parts = apiEndpoint.split('/');
    return parts[parts.length - 2];
}

// Функция для получения причины состояния на основе времени и данных периодов
function getReason(time, periodsData) {
    const period = periodsData.find(period => {
        const periodStart = new Date(period.start_time).getTime();
        const periodEnd = new Date(period.end_time).getTime();
        return time.getTime() >= periodStart && time.getTime() <= periodEnd;
    });
    return period ? period.reason : 'Не указана';
}



// Функция для рендеринга графика Ганта
function renderGanttChart(data, elementId, type) {

    const margin = { top: 20, right: 20, bottom: 30, left: 80 };
    const width = 1200 - margin.left - margin.right;
    const height = 125 - margin.top - margin.bottom;

    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`Element with id ${elementId} not found.`);
        return;
    }

    // Удаление предыдущего SVG
    console.log("Удаление предыдущего SVG элементов");
    d3.select(element).selectAll("svg").remove();

    // Создание нового SVG
    const svg = d3.select(element).append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Настройка шкалы X
    let x;
    if (type === 'week') {
        // Шкала для недельного графика
        x = d3.scaleTime()
            .domain([
                d3.min(data, d => d.time),
                d3.max(data, d => new Date(d.time.getTime() + 6 * 24 * 60 * 60 * 1000)) // 6 дней для полного диапазона недели
            ])
            .range([0, width]);
    }
    else {
        x = d3.scaleTime()
            .domain([d3.min(data, d => d.time), d3.max(data, d => d.time)])
            .range([0, width]);
    }

    // Настройка шкалы Y
    const y = d3.scaleBand()
        .domain(["Выключен", "Простой", "Работает"])
        .range([height, 0])
        .padding(0.1);

    // Настройка цветовой шкалы
    const colorScale = d3.scaleOrdinal()
        .domain(["Выключен", "Простой", "Работает"])
        .range(["#FF0000", "#FFFF00", "#00FF00"]);
    if (type === "day") {
        if (!Array.isArray(data)) {
            console.error("Ошибка: данные не являются массивом", data);
            return;
        }
        console.log(`Данные с DAY ${apiEndpoint}:`, data);
        if (!data || data.length === 0) {
            console.warn(`Нет данных для отображения с ${apiEndpoint}`);
            return;
        }
        data.forEach(d => {
            const periodProportions = Array.isArray(d.periodProportions) ? d.periodProportions : [{ reason: d.reason || 'Не указана', proportion: 1 }];
            if (!Array.isArray(periodProportions)) {
                console.error("Ошибка: periodProportions не является массивом", periodProportions);
                return;
            }
            let hourStart = new Date(d.time);
            hourStart.setHours(hourStart.getHours() - 3);
            hourStart.setMinutes(0, 0, 0);

            const hourEnd = convertToMoscowTime(hourStart);
            hourEnd.setHours(hourEnd.getHours() - 3);
            hourEnd.setMinutes(59, 59, 999);
            console.log(`HOUR: ${hourStart} - ${hourEnd}`)
            let xOffset = x(hourStart);
            d.periodProportions.forEach(period => {
                const segmentWidth = period.proportion * (x(hourEnd) - x(hourStart));

                // Отрисовка сегмента
                svg.append("rect")
                    .attr("x", xOffset)
                    .attr("y", d.value > 4.8 ? y("Работает") : (d.value > 0 ? y("Простой") : y("Выключен")))
                    .attr("width", segmentWidth)
                    .attr("height", y.bandwidth())
                    .attr("fill", reasonColorMap[period.reason] || "#999")
                    .attr("opacity", 1);

                xOffset += segmentWidth;
            });
        });
    }
    // Создание тултипа
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);


    //console.log("Шкала Y:", y.domain());


    // Добавление прямоугольников
    svg.selectAll(".bar")
        .data(data)
        .enter().append("rect")
        .attr("class", "bar")
        .attr("x", d => x(d.time))
        .attr("y", d => {
            if (d.value > 4.8) return y("Работает");
            if (d.value > 0) return y("Простой");
            return y("Выключен");
        })
        .attr("width", type === 'week' ? width : Math.max(width / data.length - 2, 1))
        .attr("height", y.bandwidth())
        .attr("fill", d => {
            const reasonColorMap = {
                'Обед': '#FFA500',
                'Перерыв': '#800080',
                'Уборка': '#0000FF',
                'Короткая остановка': '#808000',
                'Плановый простой': '#00ff95',
                'Перенастройка': '#00d0ff',
                'Переналадка на другой продукт': '#6e4f00',
                'Запуск линии': '#c70285',
                'Собрание': '#d32f2f',
                'Замена оснастки': '#7b1fa2',
                'Замена материала': '#1976d2',
                'Плановое ТО': '#388e3c',
                'Отсутствие материала': '#fbc02d',
                'Отсутствие места в буфере': '#e64a19',
                'Переход на другой станок': '#455a64',
                'Ошибка в механике': '#5d4037',
                'Ошибка в электронике': '#0288d1',
                'Аспирация': '#7cb342',
                'Отсутствие давления': '#c2185b',
                'Подвоз материала': '#303f9f',
                'Отключение электричества': '#f57c00'
            };
            return reasonColorMap[d.reason] || (d.value > 4.8 ? colorScale("Работает") : (d.value > 0 ? colorScale("Простой") : colorScale("Выключен")));
        })
        .attr("opacity", 1)
        .on("mouseover", function (event, d) {
            d3.select(this).attr("opacity", 0.7);
            tooltip.transition()
                .duration(200)
                .style("opacity", .9);

            let displayText = '';
            if (type === 'week') {
                displayText = `Неделя: ${d.weekRange}`;
            } else if (type === 'day') {
                // Вычисление начала часа
                const startOfHour = new Date(d.time);
                startOfHour.setMinutes(0);
                startOfHour.setSeconds(0);
                startOfHour.setMilliseconds(0);

                displayText = `Время: ${d3.timeFormat('%H:%M')(startOfHour)} - ${d3.timeFormat('%H:%M')(d.time)}`;
            } else if (type === 'hour') {
                displayText = `Время: ${d3.timeFormat('%H:%M')(d.time)}`;
            }

            tooltip.html(`${displayText}<br/>Значение: ${d.value}<br/>Причина: ${d.reason}`)
                .style("left", (event.pageX + 5) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function () {
            d3.select(this).attr("opacity", 1);
            tooltip.transition()
                .duration(500)
                .style("opacity", 0);
        })
        .on("click", function (event, d) {
            if (d.value <= 4.8) {
                window.location.href = "https://t.me/SuraMebel_BOT";
            }
        });

    // Добавление меток на ось Y
    svg.append("g")
        .attr("class", "y-axis")
        .call(d3.axisLeft(y));

    // Добавление временных меток на ось X
    if (type === 'week' && data.length > 0) {
        const { weekRange } = data[0]; // берем диапазон из первой записи
        svg.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x).tickValues([x(data[0].time)]).tickFormat(() => weekRange));
    } else if (type === 'hour') {
        svg.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x).tickFormat(d3.timeFormat('%H:%M')));
    } else if (type === 'day') {
        svg.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x).tickFormat(d3.timeFormat('%H:%M')));
    }
    data.forEach(d => {
        const date = new Date(d.time);
        //date.setHours(date.getHours() - 3);
        if (isNaN(date.getTime())) {
            console.error(`Ошибка при преобразовании даты: ${d.time}`);
        } else {
            console.log(`Дата успешно преобразована: ${date}`);
        }
    });
}