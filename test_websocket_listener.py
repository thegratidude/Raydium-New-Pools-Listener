import asyncio
import json
import signal
import sys
from datetime import datetime
import socketio
from colorama import init, Fore, Style

# Constants
SERVER_URL = 'http://localhost:5001'
RECONNECT_DELAY = 5  # seconds
NEW_POOL_COUNT = 0

# Initialize colorama for cross-platform colored terminal output
init()

# Create a Socket.IO client instance with explicit transport options
sio = socketio.AsyncClient(
    reconnection=True,
    reconnection_attempts=0,  # infinite reconnection attempts
    reconnection_delay=RECONNECT_DELAY,
    reconnection_delay_max=30,  # max delay between reconnection attempts
    randomization_factor=0.5,  # add some randomization to reconnection delays
    logger=True,  # enable client-side logging
    engineio_logger=True,  # enable engine.io logging
)

# Global flag for graceful shutdown
running = True

def signal_handler(sig, frame):
    """Handle graceful shutdown on SIGINT (Ctrl+C)"""
    global running
    print(f"\n{Fore.YELLOW}Shutting down listener...{Style.RESET_ALL}")
    running = False
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

@sio.event
async def connect():
    """Handle successful connection to the server"""
    print(f"{Fore.GREEN}✅ Connected to Socket.IO server at {SERVER_URL}{Style.RESET_ALL}")

@sio.event
async def disconnect():
    """Handle disconnection from the server"""
    print(f"{Fore.YELLOW}⚠️  Disconnected from server{Style.RESET_ALL}")

@sio.on('newPool')
async def on_new_pool(data):
    """Handle new pool events"""
    global NEW_POOL_COUNT
    NEW_POOL_COUNT += 1
    
    timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
    formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
    
    print(f"\n{Fore.CYAN}[{formatted_time}] New Pool Detected:{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Pool ID: {data.get('poolId', 'N/A')}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Type: {data.get('type', 'N/A')}{Style.RESET_ALL}")

@sio.on('health')
async def on_health(data):
    """Handle health check events"""
    try:
        timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        formatted_time = data.get('timestamp', 'Invalid timestamp')

    uptime = data.get('uptime', 0)
    hours = int(uptime) // 3600
    minutes = (int(uptime) % 3600) // 60
    seconds = int(uptime) % 60
    
    status_color = Fore.GREEN if sio.connected else Fore.RED
    status_icon = "✅" if sio.connected else "❌"
    
    print(
        f"{status_color}[{formatted_time}] {status_icon} "
        f"Connected: {sio.connected} – "
        f"Uptime: {hours}h {minutes}m {seconds}s – "
        f"New pools: {NEW_POOL_COUNT}{Style.RESET_ALL}"
    )

async def connect_to_server():
    """Main connection loop with automatic reconnection"""
    while running:
        try:
            print(f"{Fore.BLUE}Connecting to Socket.IO server at {SERVER_URL}...{Style.RESET_ALL}")
            await sio.connect(SERVER_URL, transports=['websocket', 'polling'])
            await sio.wait()
        except Exception as e:
            if running:  # Only print error if we're not shutting down
                print(f"{Fore.RED}Connection lost. Reconnecting in {RECONNECT_DELAY} seconds... Error: {str(e)}{Style.RESET_ALL}")
            await asyncio.sleep(RECONNECT_DELAY)

if __name__ == "__main__":
    try:
        print(f"{Fore.BLUE}Starting Raydium Pool Listener...{Style.RESET_ALL}")
        print(f"{Fore.BLUE}Press Ctrl+C to stop{Style.RESET_ALL}")
        asyncio.run(connect_to_server())
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}Listener stopped by user{Style.RESET_ALL}")
    finally:
        if sio.connected:
            asyncio.run(sio.disconnect())
        print(f"{Fore.GREEN}Cleanup complete. Goodbye!{Style.RESET_ALL}") 