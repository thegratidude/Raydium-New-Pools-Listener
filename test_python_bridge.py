#!/usr/bin/env python3
"""
Test script to verify Python bridge communication with NestJS system
"""

import asyncio
import aiohttp
import json
from datetime import datetime

async def test_api_endpoints():
    """Test all API endpoints to ensure they're working"""
    base_url = 'http://localhost:5001'
    
    print("🔍 Testing API Endpoints...")
    print("=" * 60)
    
    # Test health endpoint
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f'{base_url}/health') as response:
                if response.status == 200:
                    data = await response.json()
                    print(f"✅ Health Check: {data.get('status', 'unknown')}")
                else:
                    print(f"❌ Health Check: HTTP {response.status}")
    except Exception as e:
        print(f"❌ Health Check Error: {e}")
    
    # Test trading status
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f'{base_url}/trading/status') as response:
                if response.status == 200:
                    data = await response.json()
                    early_trading = data.get('data', {}).get('earlyTrading', {})
                    print(f"✅ Trading Status: {early_trading.get('status', 'unknown')}")
                    print(f"   📊 Active Positions: {early_trading.get('stats', {}).get('activePositions', 0)}")
                else:
                    print(f"❌ Trading Status: HTTP {response.status}")
    except Exception as e:
        print(f"❌ Trading Status Error: {e}")
    
    # Test paper portfolio
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f'{base_url}/trading/paper-portfolio') as response:
                if response.status == 200:
                    data = await response.json()
                    portfolio = data.get('data', {})
                    print(f"✅ Paper Portfolio: {portfolio.get('balance', 0)} SOL")
                    print(f"   📈 Total PnL: {portfolio.get('totalPnL', 0)} SOL")
                    print(f"   🎯 Total Trades: {portfolio.get('totalTrades', 0)}")
                else:
                    print(f"❌ Paper Portfolio: HTTP {response.status}")
    except Exception as e:
        print(f"❌ Paper Portfolio Error: {e}")
    
    print("=" * 60)

async def test_websocket_connection():
    """Test WebSocket connection to verify event listening"""
    import socketio
    
    print("\n🔌 Testing WebSocket Connection...")
    print("=" * 60)
    
    sio = socketio.AsyncClient()
    
    @sio.event
    async def connect():
        print(f"✅ WebSocket Connected: {sio.sid}")
        
    @sio.event
    async def disconnect():
        print("❌ WebSocket Disconnected")
    
    @sio.on('health')
    async def on_health(data):
        print(f"✅ Health Event Received: {data.get('uptime', 0)}s uptime")
    
    try:
        await sio.connect('http://localhost:5001')
        print("✅ WebSocket connection successful")
        
        # Wait for a health event
        print("⏳ Waiting for health event...")
        await asyncio.sleep(5)
        
        await sio.disconnect()
        print("✅ WebSocket test completed")
        
    except Exception as e:
        print(f"❌ WebSocket Error: {e}")
    
    print("=" * 60)

async def main():
    """Main test function"""
    print("🚀 Python Bridge Test Suite")
    print("=" * 60)
    
    await test_api_endpoints()
    await test_websocket_connection()
    
    print("\n🎉 Test Suite Complete!")
    print("=" * 60)

if __name__ == '__main__':
    asyncio.run(main()) 