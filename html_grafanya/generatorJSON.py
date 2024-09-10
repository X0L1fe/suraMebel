import json
import random
from datetime import datetime, timedelta

# Генерация данных для одной машины
def generate_records(start_time, num_records):
    records = []
    for i in range(num_records):  # 12 записей за час (каждые 5 минут)
        current_time = start_time + timedelta(minutes=i*5)
        time_str = current_time.strftime("%H:%M")
        current_value = round(random.uniform(0.00, 10.00), 2)
        records.append({"time": time_str, "current": current_value})
    return records

# Генерация данных для нескольких машин
def generate_all_records(start_time="09:00:00", num_records=12):
    start_time = datetime.strptime(start_time, "%H:%M:%S")
    all_records = []
    for _ in range(num_records):
        machine_records = generate_records(start_time, num_records)
        all_records.extend(machine_records)
    return all_records

# Сохранение данных в JSON файл
def save_to_json(records, filename='data.json'):
    with open(filename, 'w') as json_file:
        json.dump(records, json_file, indent=4)

def main():
    records = generate_all_records()
    save_to_json(records)
    print(f"Generated records saved to data.json")

# Запуск
if __name__ == '__main__':
    main()
