import threading
import time
import schedule
from telebot import types
from dotenv import load_dotenv
from datetime import datetime, timedelta
import telebot
import os
import json
import sqlite3
import logging

load_dotenv()

BOT_API_TOKEN = os.getenv('BOT_API_TOKEN')
EXTERNAL_DB_PATH = os.getenv('EXTERNAL_DB_PATH')
MACHINES_PATH = os.getenv('MACHINES_FILE_PATH')

bot = telebot.TeleBot(BOT_API_TOKEN)
pending_reasons = {}
message_ids = {}
processed_periods = {"OFF": [], "SIMP": []}

# Configure logging
logging.basicConfig(level=logging.INFO)

def create_tables():
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()

    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_name TEXT,
            start_time TEXT,
            end_time TEXT,
            reason TEXT
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS unresolved_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_name TEXT,
            record_date TEXT,
            periods TEXT
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS weekly_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_name TEXT,
            report_date TEXT,
            report TEXT
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS monthly_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_name TEXT,
            report_date TEXT,
            report TEXT
        )
        '''
    )
    conn.commit()
    cur.close()
    conn.close()
            
def insert_period(machine_name, start_time, end_time, reason):
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    try:
        cur.execute(
            '''INSERT INTO periods (machine_name, start_time, end_time, reason) 
               VALUES (?, ?, ?, ?)''',  
            (machine_name, start_time, end_time, reason)
        )
        conn.commit()
    except sqlite3.Error as e:
        print(f"Ошибка базы данных: {e}")
    finally:
        cur.close()
        conn.close()

def get_saved_periods():
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    cur.execute('SELECT start_time, end_time FROM periods')
    saved_periods = cur.fetchall()
    cur.close()
    conn.close()
    return saved_periods

def insert_unresolved_periods(machine_name, record_date, periods):
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    try:
        cur.execute(
            '''INSERT INTO unresolved_periods (machine_name, record_date, periods) 
               VALUES (?, ?, ?)''',  
            (machine_name, record_date, json.dumps(periods))
        )
        conn.commit()
        print(f"Запись сохранена для {machine_name}: {periods}")  # Отладочное сообщение
    except sqlite3.Error as e:
        print(f"Ошибка базы данных: {e}")
    finally:
        cur.close()
        conn.close()

def get_unresolved_periods(machine_name):
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    cur.execute('SELECT record_date, periods FROM unresolved_periods WHERE machine_name = ?', (machine_name,))
    unresolved_periods = cur.fetchall()
    cur.close()
    conn.close()
    return unresolved_periods


def delete_unresolved_period(record_date):
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    try:
        cur.execute('DELETE FROM unresolved_periods WHERE record_date = ?', (record_date,))
        conn.commit()
    except sqlite3.Error as e:
        print(f"Ошибка базы данных: {e}")
    finally:
        cur.close()
        conn.close()

def update_unresolved_periods(record_date, updated_periods):
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    try:
        cur.execute('UPDATE unresolved_periods SET periods = ? WHERE record_date = ?', (json.dumps(updated_periods), record_date))
        conn.commit()
    except sqlite3.Error as e:
        print(f"Ошибка базы данных: {e}")
    finally:
        cur.close()
        conn.close()


def form_message(chat_id, periods, condition, reason, period_key):
    def format_time(time_str):
        return time_str[11:16]
    
    markup = types.InlineKeyboardMarkup()
    for period in periods:
        start_time = period[0]['time']
        end_time = period[-1]['time']

        if start_time > end_time:
            start_time, end_time = end_time, start_time

        formatted_start_time = format_time(start_time)
        formatted_end_time = format_time(end_time)
        
        # Используем полные временные метки для callback_data
        callback_data = f"period|{period_key}|{start_time}|{end_time}|{condition}"
        
        if len(callback_data.encode('utf-8')) > 64:
            print(f"WARNING: Callback data too long: {callback_data}")
            continue  # Пропускаем слишком длинные данные
        
        # Но показываем пользователю только форматированные часы и минуты
        button = types.InlineKeyboardButton(f"Период: {formatted_start_time} - {formatted_end_time}", callback_data=callback_data)
        markup.add(button)
    
    if reason == "OFF":
        reason = "отключения"
    elif reason == "SIMP":
        reason = "простоя"
    
    if markup.keyboard:  # Если есть кнопки в разметке, отправляем сообщение
        message = bot.send_message(chat_id, f"Выберите период {reason}:", reply_markup=markup)
        message_ids[reason] = message.message_id
    else:
        bot.send_message(chat_id, f"Нет новых периодов для {reason}.")

def extract_periods(data_worker, machine_name, types):
    periods_0 = []
    periods_4_8 = []

    current_period = []
    current_condition = None

    saved_periods = get_saved_periods_for_check(machine_name)
    if types == "UNRESOLVED":
        for cursor in data_worker:
            time = cursor['time']
            current = cursor['current']

            if current == 0:
                condition = 0
            elif current <= 4.8:
                condition = 4.8
            else:
                condition = None

            if condition == current_condition:
                current_period.append(cursor)
            else:
                if current_period:
                    start_time = current_period[0]['time']
                    end_time = current_period[-1]['time']

                    if current_condition == 0:
                        # Проверяем текущий период с сохраненными period_0
                        if not any(compare_periods(current_period, saved_period) for saved_period in saved_periods["periods_0"]):
                            print(type(saved_periods))
                            periods_0.append(current_period)
                            print(f"Добавлен новый период 0: {current_period}")
                    elif current_condition == 4.8:
                        # Проверяем текущий период с сохраненными period_4_8
                        print(type(saved_periods))
                        if not any(compare_periods(current_period, saved_period) for saved_period in saved_periods["periods_4_8"]):
                            periods_4_8.append(current_period)
                            print(f"Добавлен новый период 4.8: {current_period}")

                current_period = [cursor]
                current_condition = condition

        # Добавляем последний период
        if current_period:
            start_time = current_period[0]['time']
            end_time = current_period[-1]['time']

            if current_condition == 0:
                if not any(compare_periods(current_period, saved_period) for saved_period in saved_periods["periods_0"]):
                    periods_0.append(current_period)
                    print(f"Добавлен последний период 0: {current_period}")
            elif current_condition == 4.8:
                if not any(compare_periods(current_period, saved_period) for saved_period in saved_periods["periods_4_8"]):
                    periods_4_8.append(current_period)
                    print(f"Добавлен последний период 4.8: {current_period}")
        
        return periods_0, periods_4_8
    else:
        for cursor in data_worker:
            time = cursor['time']
            current = cursor['current']

            if current == 0:
                condition = 0
            elif current <= 4.8:
                condition = 4.8
            else:
                condition = None

            if condition == current_condition:
                current_period.append(cursor)
            else:
                if current_period:
                    start_time = current_period[0]['time']
                    end_time = current_period[-1]['time']

                    if (start_time, end_time) not in saved_periods:  # Проверка на сохраненный период
                        if current_condition == 0:
                            periods_0.append(current_period)
                        elif current_condition == 4.8:
                            periods_4_8.append(current_period)

                current_period = [cursor]
                current_condition = condition

        # Добавляем последний период
        if current_period:
            start_time = current_period[0]['time']
            end_time = current_period[-1]['time']

            if (start_time, end_time) not in saved_periods:  # Проверка на сохраненный период
                if current_condition == 0:
                    periods_0.append(current_period)
                elif current_condition == 4.8:
                    periods_4_8.append(current_period)

        return periods_0, periods_4_8

def is_period_exists(machine_name, start_time, end_time):
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    cur.execute('''
        SELECT 1 FROM periods 
        WHERE machine_name = ? AND start_time = ? AND end_time = ?
    ''', (machine_name, start_time, end_time))
    exists = cur.fetchone() is not None
    cur.close()
    conn.close()
    return exists

def get_saved_periods_for_check(machine_name):
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    cur.execute('SELECT start_time, end_time FROM periods WHERE machine_name = ?', (machine_name,))
    saved_periods = {(start_time, end_time) for start_time, end_time in cur.fetchall()}
    cur.close()
    conn.close()
    print(type(saved_periods), saved_periods)
    return saved_periods

@bot.message_handler(commands=['start'])
def start_command(message):
    bot.send_message(message.chat.id, f'Здравствуйте, {message.from_user.first_name}, Я - Телеграм Бот компании SuraMebel!')
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True)
    button_1 = types.KeyboardButton("Неуказанные причины❌")
    markup.add(button_1)
    bot.send_message(message.chat.id, "Выберите пункт меню ниже:", reply_markup=markup)

def get_machine_name():
    with open(MACHINES_PATH, 'r', encoding='utf-8') as file:
        data = json.load(file)
    machines = data['machines']
    return machines

@bot.message_handler(func=lambda message: message.text == "Неуказанные причины❌")
def handle_machine_selection(message):
    machines = get_machine_name()
    
    markup = types.InlineKeyboardMarkup()
    for machine in machines:
        machine_name = machine['name']
        markup.add(types.InlineKeyboardButton(machine_name, callback_data=f"machine|{machine_name}"))
    
    bot.send_message(message.chat.id, "Выберите станок:", reply_markup=markup)

selected_machine = None

@bot.callback_query_handler(func=lambda call: call.data.startswith('machine|'))
def handle_machine_selection(call):
    global selected_machine
    _, selected_machine = call.data.split('|')
    unresolved_periods = get_unresolved_periods(selected_machine)
    
    if unresolved_periods:
        for record_date, periods in unresolved_periods:
            periods = json.loads(periods)
            periods_0, periods_4_8 = periods['periods_0'], periods['periods_4_8']
            if periods_0:
                pending_reasons["OFF"] = periods_0
                form_message(call.message.chat.id, periods_0, 0, reason="OFF", period_key="OFF")
            if periods_4_8:
                pending_reasons["SIMP"] = periods_4_8
                form_message(call.message.chat.id, periods_4_8, 4.8, reason="SIMP", period_key="SIMP")
    else:
        data_worker = get_data_from_db(selected_machine)
        
        if not data_worker:
            bot.send_message(call.message.chat.id, "Нет данных для обработки.")
            return

        periods_0, periods_4_8 = extract_periods(data_worker, selected_machine, "RESOLVED")

        pending_reasons["OFF"] = periods_0
        pending_reasons["SIMP"] = periods_4_8

        if periods_0:
            form_message(call.message.chat.id, periods_0, 0, reason="OFF", period_key="OFF")
        else:
            bot.send_message(call.message.chat.id, "Нет периодов отключения.")

        if periods_4_8:
            form_message(call.message.chat.id, periods_4_8, 4.8, reason="SIMP", period_key="SIMP")
        else:
            bot.send_message(call.message.chat.id, "Нет периодов простоя.")
        
        # Сохранение неразрешенных периодов, если есть
        if periods_0 or periods_4_8:
            save_unresolved_periods(selected_machine)

def create_reasons_markup(period_key, start_time, end_time, reason_page=0):
    reasons = {
        "1": "🍽️ Обед", "2": "☕ Перерыв", "3": "🧹 Уборка", "4": "⏸️ Короткая остановка",
        "5": "🛠️ Плановый простой", "6": "🔧 Перенастройка", "7": "🔄 Переналадка на другой продукт",
        "8": "🚀 Запуск линии", "9": "👥 Собрание", "10": "🔩 Замена оснастки",
        "11": "📦 Замена материала", "12": "🛠️ Плановое ТО", "13": "📦 Отсутствие материала",
        "14": "🚫 Отсутствие места в буфере", "15": "🔄 Переход на другой станок",
        "16": "⚙️ Ошибка в механике", "17": "⚡ Ошибка в электронике",
        "18": "🌬️ Аспирация", "19": "🔄 Отсутствие давления", "20": "🚚 Подвоз материала",
        "21": "⚡ Отключение электричества"
    }
    
    items_per_page = 6
    start_idx = reason_page * items_per_page
    end_idx = min(start_idx + items_per_page, len(reasons))
    page_reasons = list(reasons.items())[start_idx:end_idx]

    markup = types.InlineKeyboardMarkup()
    for reason_id, reason_text in page_reasons:
        callback_data = f"reason|{period_key}|{start_time}|{end_time}|{reason_id}"
        
        if len(callback_data.encode('utf-8')) > 64:
            print(f"WARNING: Callback data too long: {callback_data}")
            continue
        
        markup.add(types.InlineKeyboardButton(reason_text, callback_data=callback_data))
    
    nav_buttons = []
    if reason_page > 0:
        nav_buttons.append(types.InlineKeyboardButton("⬅️ Назад", callback_data=f"navigate|{period_key}|{start_time}|{end_time}|{reason_page-1}"))
    if end_idx < len(reasons):
        nav_buttons.append(types.InlineKeyboardButton("Вперед ➡️", callback_data=f"navigate|{period_key}|{start_time}|{end_time}|{reason_page+1}"))
    
    if nav_buttons:
        markup.row(*nav_buttons)

    return markup

@bot.callback_query_handler(func=lambda call: call.data.startswith('navigate|'))
def handle_navigation(call):
    try:
        _, period_key, start_time, end_time, reason_page = call.data.split('|')
        reason_page = int(reason_page)
        markup = create_reasons_markup(period_key, start_time, end_time, reason_page)
        bot.edit_message_text(chat_id=call.message.chat.id, message_id=call.message.message_id, text=f"Выберите причину для периода {start_time} - {end_time}:", reply_markup=markup)
    except ValueError as e:
        print(f"Ошибка разбора данных навигации: {e}")
        
@bot.callback_query_handler(func=lambda call: call.data.startswith('period|'))
def handle_period_selection(call):
    data_parts = call.data.split('|')
    
    if len(data_parts) != 5:
        bot.send_message(call.message.chat.id, "Произошла ошибка обработки данных. Пожалуйста, повторите попытку.")
        return
    
    _, period_key, start_time, end_time, condition = data_parts

    markup = create_reasons_markup(period_key, start_time, end_time)
    bot.edit_message_text(chat_id=call.message.chat.id, message_id=call.message.message_id, text=f"Выберите причину для периода {start_time} - {end_time}:", reply_markup=markup)

@bot.callback_query_handler(func=lambda call: call.data.startswith('reason|'))
def handle_reason_selection(call):
    try:
        _, period_key, start_time, end_time, reason_key = call.data.split('|')
        reasons = {
            "1": "Обед", "2": "Перерыв", "3": "Уборка", "4": "Короткая остановка", 
            "5": "Плановый простой", "6": "Перенастройка", "7": "Переналадка на другой продукт", 
            "8": "Запуск линии", "9": "Собрание", "10": "Замена оснастки", 
            "11": "Замена материала", "12": "Плановое ТО", "13": "Отсутствие материала", 
            "14": "Отсутствие места в буфере", "15": "Переход на другой станок", 
            "16": "Ошибка в механике", "17": "Ошибка в электронике", 
            "18": "Аспирация", "19": "Отсутствие давления", "20": "Подвоз материала", 
            "21": "Отключение электричества"
        }
        reason = reasons.get(reason_key, "Неизвестная причина")

        periods = pending_reasons.get(period_key, [])

        if selected_machine:
            machine_name = selected_machine
        else:
            bot.send_message(call.message.chat.id, "Ошибка: Не выбрана машина.")
            return

        insert_period(machine_name, start_time, end_time, reason)
        
        def remove_period_from_pending(reason_type):
            for period in pending_reasons.get(reason_type, []):
                if period[0]['time'] == start_time and period[-1]['time'] == end_time:
                    pending_reasons[reason_type].remove(period)
                    processed_periods[reason_type].append(period)
                    break

        remove_period_from_pending("OFF")
        remove_period_from_pending("SIMP")

        unresolved_periods = get_unresolved_periods(machine_name)
        for record_date, periods in unresolved_periods:
            periods = json.loads(periods)
            periods_0, periods_4_8 = periods['periods_0'], periods['periods_4_8']

            for period_list in [periods_0, periods_4_8]:
                period_list[:] = [p for p in period_list if not (p[0]['time'] == start_time and p[-1]['time'] == end_time)]

            if not periods_0 and not periods_4_8:
                delete_unresolved_period(record_date)
            else:
                update_unresolved_periods(record_date, {"periods_0": periods_0, "periods_4_8": periods_4_8})

        bot.edit_message_text(chat_id=call.message.chat.id, message_id=call.message.message_id, text=f"Причина '{reason}' для периода {start_time} - {end_time} сохранена.")

        if not pending_reasons["OFF"] and not pending_reasons["SIMP"]:
            bot.send_message(call.message.chat.id, "Все причины указаны.")
    except ValueError as e:
        print(f"Ошибка разбора данных: {e}")
        
def save_unresolved_periods(machine_name):
    unresolved_periods = {
        "periods_0": pending_reasons.get("OFF", []),
        "periods_4_8": pending_reasons.get("SIMP", [])
    }
    print(f"Периоды для сохранения для {machine_name}: {unresolved_periods}")  # Отладочное сообщение
    if unresolved_periods["periods_0"] or unresolved_periods["periods_4_8"]:
        record_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        insert_unresolved_periods(machine_name, record_date, unresolved_periods)
    else:
        print(f"Нет неразрешённых периодов для сохранения для станка {machine_name}")

def get_unresolved_periods_for_machine(machine_name):
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    cur.execute('SELECT periods FROM unresolved_periods WHERE machine_name = ?', (machine_name,))
    unresolved_periods = cur.fetchall()
    cur.close()
    conn.close()

    # Парсим данные JSON из поля periods
    parsed_unresolved_periods = {"periods_0": [], "periods_4_8": []}
    for periods_json, in unresolved_periods:
        try:
            periods_data = json.loads(periods_json)  # декодируем periods как словарь
            if "periods_0" in periods_data:
                parsed_unresolved_periods["periods_0"].extend(periods_data["periods_0"])
            if "periods_4_8" in periods_data:
                parsed_unresolved_periods["periods_4_8"].extend(periods_data["periods_4_8"])
        except json.JSONDecodeError:
            print(f"Ошибка декодирования JSON для записей в unresolved_periods для {machine_name}")

    return parsed_unresolved_periods

def get_data_from_db(machine_name):
    conn = sqlite3.connect(EXTERNAL_DB_PATH)
    cursor = conn.cursor()
    # Извлекаем все записи для указанного станка, независимо от значения current
    cursor.execute("""
        SELECT time, record FROM data 
        WHERE machine_name = ?
        ORDER BY time ASC
    """, (machine_name,))
    results = cursor.fetchall()
    conn.close()

    if not results:
        print(f"Данные для станка {machine_name} не найдены.")
        return []

    data_worker = []
    for time, record in results:
        try:
            data = json.loads(record)
            data_worker.append({'time': time, 'current': data['current']})
        except json.JSONDecodeError:
            print(f"Ошибка декодирования JSON для станка {machine_name}: {record}")
            continue

    # print(data_worker)
    return data_worker


def run_schedule():
    while True:
        schedule.run_pending()
        time.sleep(1)

def save_unresolved_periods_task():
    for machine in get_machine_name():
        machine_name = machine['name']
        
        data_worker = get_data_from_db(machine_name)
        periods_0, periods_4_8 = extract_periods(data_worker, machine_name, "UNRESOLVED")

        pending_reasons["OFF"] = periods_0
        pending_reasons["SIMP"] = periods_4_8
        print(f"Периоды OFF: {pending_reasons['OFF']}")
        print(f"Периоды SIMP: {pending_reasons['SIMP']}")

        existing_unresolved_periods = get_unresolved_periods_for_machine(machine_name)
        if existing_unresolved_periods["periods_0"] or existing_unresolved_periods["periods_4_8"]:
            save_unresolved_periods(machine_name)
        else:
            print(f"Нет периодов для сохранения {machine_name}")

def compare_periods(new_period, existing_period):
    if not isinstance(new_period, list) or not isinstance(existing_period, list):
        print(f"Некорректные типы данных для сравнения: {type(new_period)} и {type(existing_period)}")
        return False

    # Длина периодов должна совпадать для корректного сравнения
    if len(new_period) != len(existing_period):
        return False
    
    # Сравниваем поэлементно каждую запись в периодах
    for new_rec, existing_rec in zip(new_period, existing_period):
        # Если хотя бы одно из полей 'time' или 'current' отличается, периоды считаются разными
        if new_rec['time'] != existing_rec['time'] or new_rec['current'] != existing_rec['current']:
            return False

    return True

def generate_weekly_reports():
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    # Логика генерации недельных отчетов и их сохранения в БД
    conn.commit()
    cur.close()
    conn.close()

def generate_monthly_reports():
    conn = sqlite3.connect('DATABASE.db')
    cur = conn.cursor()
    # Логика генерации месячных отчетов и их сохранения в БД
    conn.commit()
    cur.close()
    conn.close()

schedule.every(1).hour.at(":58").do(save_unresolved_periods_task)
schedule.every().monday.at("00:00").do(generate_weekly_reports)
schedule.every().day.at("00:00").do(generate_monthly_reports)

if __name__ == '__main__':
    create_tables()
    threading.Thread(target=run_schedule).start()
    bot.polling(none_stop=True)