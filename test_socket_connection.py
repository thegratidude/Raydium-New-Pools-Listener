#!/usr/bin/env python3

import asyncio
import socketio
import json
from datetime import datetime

# Create a Socket.IO client
sio = socketio.AsyncClient(
    logger=True,
    engineio_logger=True
)

@sio.event
async def connect():
    print(f"✅ Connected to server with ID: {sio.sid}")
    
    # Send a test message
    await sio.emit('test_connection', {
        'client_id': sio.sid,
        'timestamp': datetime.now().isoformat(),
        'message': 'Test from simple client'
    })
    print("📤 Sent test message")

@sio.event
async def disconnect():
    print("❌ Disconnected from server")

@sio.event
async def test_response(data):
    print(f"✅ Test response received: {json.dumps(data, indent=2)}")

@sio.event
async def health(data):
    print(f"🏥 Health check received: {json.dumps(data, indent=2)}")

@sio.event
async def pool_status_6(data):
    print(f"🚀 Pool status 6 received: {json.dumps(data, indent=2)}")

@sio.event
async def arbitrage_opportunity(data):
    print(f"🎯 Arbitrage opportunity received: {json.dumps(data, indent=2)}")

@sio.event
async def paper_trading_update(data):
    print(f"💰 Paper trading update received: {json.dumps(data, indent=2)}")

@sio.event
async def message(data):
    print(f"📨 Generic message received: {json.dumps(data, indent=2)}")

async def main():
    try:
        print("🔌 Connecting to Socket.IO server...")
        await sio.connect('http://localhost:5001')
        
        print("⏳ Waiting for events...")
        await asyncio.sleep(30)  # Wait 30 seconds for events
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        await sio.disconnect()

if __name__ == '__main__':
    asyncio.run(main()) 