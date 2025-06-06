import asyncio
import json
import signal
import sys
from datetime import datetime
import socketio
from colorama import init, Fore, Style
from typing import Dict, Any, Optional
import time

from config import SERVER_CONFIG, EVENT_TYPES, DISPLAY_CONFIG
from logger import setup_logger, log_message

# Initialize colorama for cross-platform colored terminal output
init()

# Setup logger
logger = setup_logger()

# Create a Socket.IO client instance with explicit transport options
sio = socketio.AsyncClient(
    reconnection=True,
    reconnection_attempts=0,  # infinite reconnection attempts
    reconnection_delay=SERVER_CONFIG['reconnect_delay'],
    reconnection_delay_max=SERVER_CONFIG['reconnection_delay_max'],
    randomization_factor=SERVER_CONFIG['randomization_factor'],
    logger=True,
    engineio_logger=True,
)

# Global state
class State:
    def __init__(self):
        self.running: bool = True
        self.new_pool_count: int = 0
        self.last_health_check: Optional[float] = None
        self.connection_start_time: Optional[float] = None
        self.total_reconnects: int = 0

state = State()

def signal_handler(sig, frame):
    """Handle graceful shutdown on SIGINT (Ctrl+C)"""
    logger.info("Shutdown signal received")
    state.running = False
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

def format_uptime(seconds: float) -> str:
    """Format uptime in a human-readable format"""
    hours = int(seconds) // 3600
    minutes = (int(seconds) % 3600) // 60
    seconds = int(seconds) % 60
    return f"{hours}h {minutes}m {seconds}s"

@sio.event
async def connect():
    """Handle successful connection to the server"""
    state.connection_start_time = time.time()
    state.total_reconnects += 1
    
    connection_data = {
        "status": "connected",
        "server": SERVER_CONFIG['url'],
        "client_id": sio.sid,
        "transport": sio.transport(),
        "reconnect_count": state.total_reconnects
    }
    
    log_message(logger, EVENT_TYPES['CONNECT'], connection_data)
    
    if DISPLAY_CONFIG['show_client_id']:
        print(f"{Fore.GREEN}✅ Client ID: {sio.sid}{Style.RESET_ALL}")
    if DISPLAY_CONFIG['show_transport']:
        print(f"{Fore.GREEN}✅ Transport: {sio.transport()}{Style.RESET_ALL}")
    
    # Subscribe to all events for debugging
    @sio.on('*')
    async def catch_all(event, data):
        if event not in [EVENT_TYPES['NEW_POOL'], EVENT_TYPES['HEALTH']]:
            logger.debug(f"Received event '{event}' with data: {data}")

@sio.event
async def disconnect():
    """Handle disconnection from the server"""
    uptime = time.time() - state.connection_start_time if state.connection_start_time else 0
    log_message(logger, EVENT_TYPES['DISCONNECT'], {
        "status": "disconnected",
        "server": SERVER_CONFIG['url'],
        "uptime": format_uptime(uptime)
    })
    print(f"{Fore.YELLOW}⚠️  Disconnected from server{Style.RESET_ALL}")

@sio.on(EVENT_TYPES['NEW_POOL'])
async def on_new_pool(data: Dict[str, Any]):
    """Handle new pool events"""
    state.new_pool_count += 1
    
    try:
        timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        formatted_time = data.get('timestamp', 'Invalid timestamp')
    
    pool_id = data.get('poolId', 'Unknown')
    base_mint = data.get('baseMint', 'Unknown')
    quote_mint = data.get('quoteMint', 'Unknown')
    
    # Only show the formatted table
    print('\n' + '=' * 80)
    print(f"{Fore.YELLOW}🚨 NEW POOL DETECTED 🚨{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Pool ID: {pool_id}{Style.RESET_ALL}")
    print(f"{Fore.GREEN}Base Mint: {base_mint}{Style.RESET_ALL}")
    print(f"{Fore.GREEN}Quote Mint: {quote_mint}{Style.RESET_ALL}")
    print(f"Time: {formatted_time}")
    print('=' * 80 + '\n')
    
    # Log to file only (no console output)
    log_entry = {
        'timestamp': datetime.now().isoformat(),
        'type': EVENT_TYPES['NEW_POOL'],
        'data': {
            "pool_id": pool_id,
            "base_mint": base_mint,
            "quote_mint": quote_mint,
            "timestamp": formatted_time,
            "total_pools": state.new_pool_count
        }
    }
    logger.info(json.dumps(log_entry))

@sio.on(EVENT_TYPES['HEALTH'])
async def on_health(data: Dict[str, Any]):
    """Handle health check events"""
    state.last_health_check = time.time()
    
    try:
        timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        formatted_time = data.get('timestamp', 'Invalid timestamp')

    uptime = data.get('uptime', 0)
    hours = int(uptime) // 3600
    minutes = (int(uptime) % 3600) // 60
    
    status_color = Fore.GREEN if sio.connected else Fore.RED
    status_icon = "✅" if sio.connected else "❌"
    
    health_data = {
        "timestamp": formatted_time,
        "status": "connected" if sio.connected else "disconnected",
        "uptime": f"{hours}h {minutes}m",
        "new_pools": state.new_pool_count,
        "client_uptime": format_uptime(time.time() - state.connection_start_time) if state.connection_start_time else "0s"
    }
    
    log_message(logger, EVENT_TYPES['HEALTH'], health_data)
    
    print(
        f"{status_color}[{formatted_time}] {status_icon} "
        f"Uptime: {hours}h {minutes}m – "
        f"New pools: {state.new_pool_count}{Style.RESET_ALL}"
    )

async def check_connection_health():
    """Background task to monitor connection health"""
    while state.running:
        if state.last_health_check and time.time() - state.last_health_check > 90:
            logger.warning("No health check received for over 90 seconds")
        await asyncio.sleep(10)

async def connect_to_server():
    """Main connection loop with automatic reconnection"""
    while state.running:
        try:
            logger.info(f"Connecting to Socket.IO server at {SERVER_CONFIG['url']}...")
            await sio.connect(SERVER_CONFIG['url'], transports=['websocket', 'polling'])
            
            # Start health check monitoring
            asyncio.create_task(check_connection_health())
            
            await sio.wait()
        except Exception as e:
            if state.running:
                logger.error(f"Connection lost. Reconnecting in {SERVER_CONFIG['reconnect_delay']} seconds... Error: {str(e)}")
                log_message(logger, "ERROR", {
                    "type": "connection_error",
                    "error": str(e),
                    "reconnect_delay": SERVER_CONFIG['reconnect_delay']
                })
            await asyncio.sleep(SERVER_CONFIG['reconnect_delay'])

if __name__ == "__main__":
    try:
        logger.info("Starting Raydium Pool Listener...")
        print(f"{Fore.BLUE}Press Ctrl+C to stop{Style.RESET_ALL}")
        asyncio.run(connect_to_server())
    except KeyboardInterrupt:
        logger.info("Listener stopped by user")
    finally:
        if sio.connected:
            asyncio.run(sio.disconnect())
        logger.info("Cleanup complete. Goodbye!") 