import asyncio
import socketio
from datetime import datetime

# Create a Socket.IO client
sio = socketio.AsyncClient()

@sio.event
async def connect():
    print(f"✅ Connected to server. Client ID: {sio.sid}")
    print("Waiting for health messages...")

@sio.event
async def disconnect():
    print("❌ Disconnected from server")

@sio.on('health')
async def on_health(data):
    """Handle health check events"""
    try:
        timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%H:%M:%S')
    except Exception:
        formatted_time = data.get('timestamp', 'Invalid timestamp')

    uptime = data.get('uptime', 0)
    hours = int(uptime) // 3600
    minutes = (int(uptime) % 3600) // 60
    seconds = int(uptime) % 60
    
    messages_since_last = data.get('messages_since_last_check', 0)
    messages_per_minute = data.get('messages_per_minute', 0)
    active_clients = data.get('active_clients', 0)
    
    print(f"\n🏥 HEALTH CHECK [{formatted_time}]")
    print(f"   Uptime: {hours}h {minutes}m {seconds}s")
    print(f"   Messages since last check: {messages_since_last}")
    print(f"   Messages per minute: {messages_per_minute}")
    print(f"   Active clients: {active_clients}")
    print(f"   Connected: {sio.connected}")

@sio.on('new_pool')
async def on_new_pool(data):
    """Handle new pool events"""
    print(f"\n🆕 NEW POOL: {data.get('pool_id', 'N/A')}")

@sio.on('pool_update')
async def on_pool_update(data):
    """Handle pool update events"""
    print(f"\n📊 POOL UPDATE: {data.get('pool_id', 'N/A')}")

@sio.on('pool_ready')
async def on_pool_ready(data):
    """Handle pool ready events"""
    print(f"\n✅ POOL READY: {data.get('pool_id', 'N/A')}")

async def main():
    try:
        print("🔌 Connecting to Socket.IO server at http://localhost:5001...")
        await sio.connect('http://localhost:5001', transports=['websocket', 'polling'])
        print("✅ Connected! Waiting for health messages (every 1 minute)...")
        await sio.wait()
    except Exception as e:
        print(f"❌ Connection error: {e}")
    finally:
        if sio.connected:
            await sio.disconnect()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n�� Shutting down...") 