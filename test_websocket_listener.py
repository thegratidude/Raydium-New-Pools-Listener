import asyncio
import json
import signal
import sys
from datetime import datetime
import socketio
from colorama import init, Fore, Style

# Initialize colorama for cross-platform colored terminal output
init()

# Create a Socket.IO client instance
sio = socketio.AsyncClient()

# Global flag for graceful shutdown
running = True

def signal_handler(sig, frame):
    global running
    print("\nListener stopped by user")
    running = False
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

@sio.event
async def connect():
    print(f"{Fore.GREEN}Connected to Socket.IO server{Style.RESET_ALL}")

@sio.event
async def disconnect():
    print(f"{Fore.YELLOW}Disconnected from server{Style.RESET_ALL}")

@sio.on('newPool')
async def on_new_pool(data):
    timestamp = datetime.fromtimestamp(data.get('timestamp', 0)).strftime('%Y-%m-%d %H:%M:%S')
    print(f"\n{Fore.CYAN}[{timestamp}] New Pool Detected:{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Action: {data.get('action', 'N/A')}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Pool Address: {data.get('poolAddress', 'N/A')}{Style.RESET_ALL}")

@sio.on('health')
async def on_health(data):
    # Parse ISO timestamp string
    timestamp_str = data.get('timestamp', '')
    try:
        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        formatted_time = timestamp_str  # fallback to raw string if parsing fails

    uptime = data.get('uptime', 0)
    hours = int(uptime) // 3600
    minutes = (int(uptime) % 3600) // 60
    seconds = int(uptime) % 60
    print(f"\n{Fore.GREEN}[{formatted_time}] Health Check:{Style.RESET_ALL}")
    print(f"{Fore.GREEN}Status: {data.get('status', 'N/A')}{Style.RESET_ALL}")
    print(f"{Fore.GREEN}Uptime: {hours}h {minutes}m {seconds}s{Style.RESET_ALL}")

async def connect_to_server():
    while running:
        try:
            print("Connecting to Socket.IO server at http://localhost:5002...")
            await sio.connect('http://localhost:5002')
            await sio.wait()
        except Exception as e:
            print(f"Connection lost. Reconnecting in 5 seconds... Error: {str(e)}")
            await asyncio.sleep(5)

if __name__ == "__main__":
    try:
        asyncio.run(connect_to_server())
    except KeyboardInterrupt:
        print("\nListener stopped by user")
    finally:
        if sio.connected:
            asyncio.run(sio.disconnect()) 