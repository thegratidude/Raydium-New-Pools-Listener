import asyncio
import socketio
import json
from datetime import datetime

# Create a Socket.IO client
sio = socketio.AsyncClient()

@sio.event
async def connect():
    print("✅ Connected to Socket.IO server!")
    print(f"📡 Connected to namespace: {sio.namespaces}")
    print(f"🔗 Transport: {sio.transport()}")

@sio.event
async def disconnect():
    print("❌ Disconnected from Socket.IO server")

@sio.event
async def health(data):
    print(f"\n🏥 HEALTH UPDATE RECEIVED:")
    print(f"   ⏰ Timestamp: {data.get('timestamp', 'N/A')}")
    print(f"   ⏱️  Uptime: {data.get('uptime', 'N/A')} seconds")
    print(f"   📨 Messages since last check: {data.get('messages_since_last_check', 'N/A')}")
    print(f"   📊 Messages per minute: {data.get('messages_per_minute', 'N/A')}")
    print(f"   ⏱️  Time since last check: {data.get('time_since_last_check_ms', 'N/A')} ms")
    print(f"   👥 Active clients: {data.get('active_clients', 'N/A')}")

@sio.event
async def new_pool(data):
    print(f"\n🆕 NEW POOL DETECTED:")
    print(f"   🏊 Pool ID: {data.get('pool_id', 'N/A')}")
    print(f"   🪙 Token A: {data.get('token_a', 'N/A')}")
    print(f"   🪙 Token B: {data.get('token_b', 'N/A')}")
    print(f"   ⏰ Timestamp: {data.get('timestamp', 'N/A')}")

@sio.event
async def pool_ready(data):
    print(f"\n✅ POOL READY:")
    print(f"   🏊 Pool ID: {data.get('pool_id', 'N/A')}")
    print(f"   📊 Initial liquidity: {data.get('initial_liquidity', 'N/A')}")
    print(f"   ⏰ Timestamp: {data.get('timestamp', 'N/A')}")

@sio.event
async def pool_update(data):
    print(f"\n📊 POOL UPDATE:")
    print(f"   🏊 Pool ID: {data.get('pool_id', 'N/A')}")
    print(f"   💰 Current liquidity: {data.get('current_liquidity', 'N/A')}")
    print(f"   📈 Price change: {data.get('price_change', 'N/A')}")
    print(f"   ⏰ Timestamp: {data.get('timestamp', 'N/A')}")

async def main():
    try:
        print("🔌 Connecting to Socket.IO server at http://localhost:5001...")
        print("🔌 Connecting to DEFAULT namespace (/) to test health messages...")
        await sio.connect('http://localhost:5001')
        print("✅ Connected! Waiting for health messages...")
        
        # Wait for 30 seconds to see if we receive any health messages
        await asyncio.sleep(30)
        
    except Exception as e:
        print(f"❌ Connection error: {e}")
    finally:
        if sio.connected:
            await sio.disconnect()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n Shutting down...") 