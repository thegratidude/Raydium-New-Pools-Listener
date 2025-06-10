#!/usr/bin/env python3
"""
Test script for automated trading system
This script simulates a pool ready event to test the trading mechanism
"""

import asyncio
import json
import socketio
from datetime import datetime
from colorama import init, Fore, Style

# Initialize colorama
init()

# Create Socket.IO client for testing
sio = socketio.AsyncClient()

@sio.event
async def connect():
    """Handle connection"""
    print(f"{Fore.GREEN}✅ Connected to test server{Style.RESET_ALL}")
    
    # Simulate a pool ready event
    test_event = {
        "pool_id": "test_pool_123",
        "timestamp": datetime.now().isoformat(),
        "data": {
            "base_token": "TEST",
            "quote_token": "USDC",
            "pool_open_time": int(datetime.now().timestamp())
        }
    }
    
    print(f"{Fore.CYAN}🧪 Simulating pool ready event...{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Event: {json.dumps(test_event, indent=2)}{Style.RESET_ALL}")
    
    # Emit the test event
    await sio.emit('pool_ready', test_event)
    print(f"{Fore.GREEN}✅ Test event sent!{Style.RESET_ALL}")
    
    # Disconnect after sending
    await asyncio.sleep(2)
    await sio.disconnect()

@sio.event
async def disconnect():
    """Handle disconnection"""
    print(f"{Fore.YELLOW}Test completed{Style.RESET_ALL}")

async def main():
    """Main test function"""
    print(f"{Fore.CYAN}🧪 Testing Automated Trading System{Style.RESET_ALL}")
    print(f"{Fore.CYAN}This will simulate a pool ready event{Style.RESET_ALL}")
    
    try:
        await sio.connect('http://localhost:5001')
        await asyncio.sleep(3)  # Wait for event to be processed
    except Exception as e:
        print(f"{Fore.RED}Test failed: {e}{Style.RESET_ALL}")
    finally:
        if sio.connected:
            await sio.disconnect()

if __name__ == '__main__':
    asyncio.run(main()) 