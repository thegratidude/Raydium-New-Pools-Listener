import asyncio
import socketio
import json
from datetime import datetime

# Create a Socket.IO client
sio = socketio.AsyncClient()

# Track health messages to only show once per minute
last_health_log_time = 0
health_message_count = 0

@sio.event
async def connect():
    print("✅ Connected to Socket.IO server!")
    print(f"📡 Connected to namespace: {sio.namespaces}")
    print(f"🔗 Transport: {sio.transport()}")
    print("🎧 Listening for events: health, new_pool, pool_update, pool_ready")
    print("⏰ Health updates will be shown once per minute...")

@sio.event
async def disconnect():
    print("❌ Disconnected from Socket.IO server")

@sio.event
async def health(data):
    global last_health_log_time, health_message_count
    health_message_count += 1
    
    # Only log health messages once per minute
    current_time = datetime.now()
    if last_health_log_time == 0 or (current_time - last_health_log_time).seconds >= 60:
        uptime_seconds = data.get('uptime', 0)
        hours = uptime_seconds // 3600
        minutes = (uptime_seconds % 3600) // 60
        
        print(f"\n🏥 HEALTH CHECK - {current_time.strftime('%H:%M:%S')}")
        print(f"   ⏱️  Server uptime: {hours}h {minutes}m")
        print(f"   📨 Messages since last check: {data.get('messages_since_last_check', 0)}")
        print(f"   📊 Messages per minute: {data.get('messages_per_minute', 0)}")
        print(f"   👥 Active clients: {data.get('active_clients', 0)}")
        print(f"   💓 Health messages received: {health_message_count}")
        
        last_health_log_time = current_time

@sio.event
async def new_pool(data):
    print(f"\n🆕 NEW POOL DETECTED!")
    print(f"   🏊 Pool ID: {data.get('pool_id', 'N/A')}")
    print(f"   🪙 Token A: {data.get('token_a', 'N/A')}")
    print(f"   🪙 Token B: {data.get('token_b', 'N/A')}")
    print(f"   ⏰ Timestamp: {data.get('timestamp', 'N/A')}")

@sio.event
async def pool_ready(data):
    print(f"\n✅ POOL READY!")
    print(f"   🏊 Pool ID: {data.get('pool_id', 'N/A')}")
    print(f"   📊 Initial liquidity: {data.get('initial_liquidity', 'N/A')}")
    print(f"   ⏰ Timestamp: {data.get('timestamp', 'N/A')}")

@sio.event
async def pool_update(data):
    print(f"\n📊 POOL UPDATE!")
    print(f"   🏊 Pool ID: {data.get('pool_id', 'N/A')}")
    print(f"   💰 Current liquidity: {data.get('current_liquidity', 'N/A')}")
    print(f"   📈 Price change: {data.get('price_change', 'N/A')}")
    print(f"   ⏰ Timestamp: {data.get('timestamp', 'N/A')}")

async def main():
    try:
        print("🔌 Connecting to Socket.IO server at http://localhost:5001...")
        print("🔌 Connecting to DEFAULT namespace (/) where all events are broadcast...")
        await sio.connect('http://localhost:5001')
        print("✅ Connected! Waiting for events...")
        
        # Keep running indefinitely
        while True:
            await asyncio.sleep(1)
        
    except Exception as e:
        print(f"❌ Connection error: {e}")
    finally:
        if sio.connected:
            await sio.disconnect()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Shutting down...") 