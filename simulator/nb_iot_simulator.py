#!/usr/bin/env python3
"""
NB-IoT 数据模拟器
模拟50台传感器（30台含水率 + 20台应变片）每小时上报数据
"""

import requests
import random
import time
import json
from datetime import datetime, timezone
from typing import List, Dict

API_BASE_URL = "http://localhost:8080/api"

class NbIoTSimulator:
    def __init__(self, api_base_url: str = API_BASE_URL):
        self.api_base_url = api_base_url
        self.moisture_sensors = []
        self.strain_sensors = []
        self.moisture_history = {}
        self.strain_history = {}
        self.signal_base = {}
        self._init_sensors()

    def _init_sensors(self):
        for i in range(1, 31):
            device_id = f"MS{i:04d}"
            self.moisture_sensors.append(device_id)
            self.moisture_history[device_id] = 75.0 + random.uniform(-5, 10)
            self.signal_base[device_id] = random.uniform(-65, -80)

        for i in range(1, 21):
            device_id = f"SS{i:04d}"
            self.strain_sensors.append(device_id)
            self.strain_history[device_id] = 0.5 + random.uniform(-0.2, 1.0)
            self.signal_base[device_id] = random.uniform(-65, -80)

    def _simulate_signal_attenuation(self, device_id: str) -> float:
        base = self.signal_base.get(device_id, -70.0)
        rain_attenuation = random.uniform(0, 5) if random.random() < 0.3 else 0
        distance_attenuation = random.uniform(0, 3)
        obstacle_attenuation = random.uniform(5, 15) if random.random() < 0.1 else 0
        fading = random.gauss(0, 2)
        signal = base - rain_attenuation - distance_attenuation - obstacle_attenuation + fading
        return round(max(-120.0, min(-40.0, signal)), 1)

    def generate_moisture_data(self, device_id: str) -> Dict:
        prev_value = self.moisture_history.get(device_id, 75.0)

        drop_rate = random.uniform(0.02, 0.15)
        noise = random.uniform(-0.5, 0.5)

        new_value = prev_value - drop_rate + noise
        new_value = max(5.0, min(95.0, new_value))

        if random.random() < 0.02:
            new_value = prev_value - random.uniform(12, 25)
            print(f"⚠️  模拟异常: {device_id} 含水率突降至 {new_value:.1f}%")

        self.moisture_history[device_id] = new_value

        return {
            "device_id": device_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sensor_type": "moisture",
            "value": round(new_value, 2),
            "temperature": round(20 + random.uniform(-3, 5), 1),
            "battery_level": round(80 + random.uniform(-5, 15), 1),
            "signal_strength": self._simulate_signal_attenuation(device_id)
        }

    def generate_strain_data(self, device_id: str) -> Dict:
        prev_value = self.strain_history.get(device_id, 1.0)

        increase_rate = random.uniform(0.005, 0.03)
        noise = random.uniform(-0.1, 0.1)

        new_value = prev_value + increase_rate + noise
        new_value = max(0.1, min(15.0, new_value))

        if random.random() < 0.015:
            new_value = random.uniform(6, 12)
            print(f"⚠️  模拟异常: {device_id} 收缩应变升至 {new_value:.2f}%")

        self.strain_history[device_id] = new_value

        return {
            "device_id": device_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sensor_type": "strain",
            "value": round(new_value, 3),
            "temperature": round(20 + random.uniform(-3, 5), 1),
            "battery_level": round(80 + random.uniform(-5, 15), 1),
            "signal_strength": self._simulate_signal_attenuation(device_id)
        }

    def send_data(self, data: Dict) -> bool:
        try:
            response = requests.post(
                f"{self.api_base_url}/nb-iot/data",
                json=data,
                timeout=10
            )
            if response.status_code == 200:
                result = response.json()
                return result.get("success", False)
            else:
                print(f"❌ 发送失败 [{data['device_id']}]: HTTP {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ 发送异常 [{data['device_id']}]: {e}")
            return False

    def run_cycle(self):
        print(f"\n{'='*60}")
        print(f"📡 NB-IoT 数据上报周期 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*60}")

        success_count = 0
        fail_count = 0

        print(f"\n💧 含水率传感器 ({len(self.moisture_sensors)} 台):")
        for i, device_id in enumerate(self.moisture_sensors):
            data = self.generate_moisture_data(device_id)
            if self.send_data(data):
                success_count += 1
                if i < 5:
                    print(f"  ✅ {device_id}: {data['value']:.2f}%")
            else:
                fail_count += 1

            time.sleep(0.05)

        print(f"\n📏 收缩应变传感器 ({len(self.strain_sensors)} 台):")
        for i, device_id in enumerate(self.strain_sensors):
            data = self.generate_strain_data(device_id)
            if self.send_data(data):
                success_count += 1
                if i < 5:
                    print(f"  ✅ {device_id}: {data['value']:.3f}%")
            else:
                fail_count += 1

            time.sleep(0.05)

        print(f"\n📊 本次上报统计:")
        print(f"   成功: {success_count} 台")
        print(f"   失败: {fail_count} 台")
        print(f"   总计: {success_count + fail_count} 台")

    def run_continuous(self, interval_seconds: int = 3600):
        print(f"🚀 NB-IoT 模拟器启动")
        print(f"   上报间隔: {interval_seconds} 秒 ({interval_seconds/3600:.1f} 小时)")
        print(f"   API地址: {self.api_base_url}")
        print(f"   含水率传感器: {len(self.moisture_sensors)} 台")
        print(f"   应变传感器: {len(self.strain_sensors)} 台")

        try:
            while True:
                self.run_cycle()
                print(f"\n⏳ 等待 {interval_seconds} 秒后进行下一次上报...")
                time.sleep(interval_seconds)
        except KeyboardInterrupt:
            print("\n\n👋 模拟器已停止")

    def run_once(self):
        self.run_cycle()


def main():
    import argparse

    parser = argparse.ArgumentParser(description="NB-IoT 数据模拟器")
    parser.add_argument("--url", default=API_BASE_URL, help="API 基础地址")
    parser.add_argument("--interval", type=int, default=3600, help="上报间隔（秒）")
    parser.add_argument("--once", action="store_true", help="只运行一次")
    parser.add_argument("--fast", action="store_true", help="快速模式，10秒上报一次")

    args = parser.parse_args()

    interval = 10 if args.fast else args.interval

    simulator = NbIoTSimulator(api_base_url=args.url)

    if args.once:
        simulator.run_once()
    else:
        simulator.run_continuous(interval_seconds=interval)


if __name__ == "__main__":
    main()
