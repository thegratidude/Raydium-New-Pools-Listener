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
MESSAGE_LOG_FILE = 'websocket_messages.log'

# Initialize colorama for cross-platform colored terminal output
init()

# Create a Socket.IO client instance with explicit transport options
sio = socketio.AsyncClient(
    reconnection=True,
    reconnection_attempts=0,  # infinite reconnection attempts
    reconnection_delay=RECONNECT_DELAY,
    reconnection_delay_max=30,  # max delay between reconnection attempts
    randomization_factor=0.5,  # add some randomization to reconnection delays
    logger=False,  # disable client-side logging to quiet console
    engineio_logger=False,  # disable engine.io logging to quiet console
)

# Global flag for graceful shutdown
running = True

# Track health messages to only show once per minute
last_health_log_time = 0
health_message_count = 0

def signal_handler(sig, frame):
    """Handle graceful shutdown on SIGINT (Ctrl+C)"""
    global running
    print(f"\n{Fore.YELLOW}Shutting down listener...{Style.RESET_ALL}")
    running = False
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

def log_message(message_type: str, data: dict):
    """Log message to both console and file"""
    timestamp = datetime.now().isoformat()
    log_entry = f"[{timestamp}] {message_type}: {json.dumps(data, indent=2)}\n"
    
    # Log to file
    with open(MESSAGE_LOG_FILE, 'a') as f:
        f.write(log_entry)

@sio.event
async def connect():
    """Handle successful connection to the server"""
    log_message("CONNECT", {
        "status": "connected",
        "server": SERVER_URL,
        "client_id": sio.sid,
        "transport": sio.transport()
    })
    print(f"{Fore.GREEN}✅ Connected to Socket.IO server at {SERVER_URL}{Style.RESET_ALL}")
    print(f"{Fore.GREEN}✅ Client ID: {sio.sid}{Style.RESET_ALL}")
    print(f"{Fore.GREEN}✅ Transport: {sio.transport()}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}🎧 Listening for events: health, new_pool, pool_update, pool_ready{Style.RESET_ALL}")
    print(f"{Fore.CYAN}⏰ Health updates will be shown once per minute...{Style.RESET_ALL}")

@sio.event
async def disconnect():
    """Handle disconnection from the server"""
    log_message("DISCONNECT", {"status": "disconnected", "server": SERVER_URL})
    print(f"{Fore.YELLOW}⚠️  Disconnected from server{Style.RESET_ALL}")

@sio.on('new_pool')
async def on_new_pool(data):
    """Handle new pool events"""
    global NEW_POOL_COUNT
    NEW_POOL_COUNT += 1
    
    # Log the raw message with more detail
    log_message("NEW_POOL", {
        **data,
        "client_id": sio.sid,
        "received_at": datetime.now().isoformat()
    })
    
    try:
        timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
        
        print(f"\n{Fore.CYAN}[{formatted_time}] New Pool Detected:{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Pool ID: {data.get('poolId', 'N/A')}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Type: {data.get('type', 'N/A')}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Client ID: {sio.sid}{Style.RESET_ALL}")
        
        # Send acknowledgment back to server
        await sio.emit('pool_received', {
            'poolId': data.get('poolId'),
            'received_at': datetime.now().isoformat(),
            'client_id': sio.sid
        })
        
    except Exception as e:
        print(f"{Fore.RED}Error processing new pool message: {str(e)}{Style.RESET_ALL}")
        log_message("ERROR", {
            "type": "new_pool_processing_error",
            "error": str(e),
            "data": data,
            "client_id": sio.sid
        })

@sio.on('pool_update')
async def on_pool_update(data):
    """Handle pool update events"""
    log_message("POOL_UPDATE", {
        **data,
        "client_id": sio.sid,
        "received_at": datetime.now().isoformat()
    })
    
    try:
        timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
        
        print(f"\n{Fore.YELLOW}[{formatted_time}] Pool Update:{Style.RESET_ALL}")
        print(f"{Fore.YELLOW}Pool ID: {data.get('pool_id', 'N/A')}{Style.RESET_ALL}")
        print(f"{Fore.YELLOW}Current Liquidity: {data.get('current_liquidity', 'N/A')}{Style.RESET_ALL}")
        print(f"{Fore.YELLOW}Price Change: {data.get('price_change', 'N/A')}{Style.RESET_ALL}")
        
    except Exception as e:
        print(f"{Fore.RED}Error processing pool update message: {str(e)}{Style.RESET_ALL}")

@sio.on('pool_ready')
async def on_pool_ready(data):
    """Handle pool ready events"""
    log_message("POOL_READY", {
        **data,
        "client_id": sio.sid,
        "received_at": datetime.now().isoformat()
    })
    
    try:
        timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
        
        print(f"\n{Fore.GREEN}[{formatted_time}] Pool Ready:{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Pool ID: {data.get('pool_id', 'N/A')}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Initial Liquidity: {data.get('initial_liquidity', 'N/A')}{Style.RESET_ALL}")
        
    except Exception as e:
        print(f"{Fore.RED}Error processing pool ready message: {str(e)}{Style.RESET_ALL}")

@sio.on('health')
async def on_health(data):
    """Handle health check events - only show once per minute"""
    global last_health_log_time, health_message_count
    health_message_count += 1
    
    # Only log health messages once per minute
    current_time = datetime.now()
    if last_health_log_time == 0 or (current_time - last_health_log_time).seconds >= 60:
        uptime = data.get('uptime', 0)
        hours = int(uptime) // 3600
        minutes = (int(uptime) % 3600) // 60
        
        print(f"\n{Fore.GREEN}🏥 HEALTH CHECK - {current_time.strftime('%H:%M:%S')}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   ⏱️  Server uptime: {hours}h {minutes}m{Style.RESET_ALL}")
        #print(f"{Fore.GREEN}   📨 Messages since last check: {data.get('messages_since_last_check', 0)}{Style.RESET_ALL}")
        #print(f"{Fore.GREEN}   📊 Messages per minute: {data.get('messages_per_minute', 0)}{Style.RESET_ALL}")
        #print(f"{Fore.GREEN}   👥 Active clients: {data.get('active_clients', 0)}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   💓 Health messages received: {health_message_count}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   🆕 New pools detected: {NEW_POOL_COUNT}{Style.RESET_ALL}")
        
        last_health_log_time = current_time
    
    # Always log to file for debugging
    log_message("HEALTH", {
        "timestamp": data.get('timestamp', ''),
        "uptime": data.get('uptime', 0),
        "messages_since_last_check": data.get('messages_since_last_check', 0),
        "messages_per_minute": data.get('messages_per_minute', 0),
        "active_clients": data.get('active_clients', 0),
        "health_message_count": health_message_count,
        "new_pools": NEW_POOL_COUNT,
        "client_id": sio.sid
    })

async def connect_to_server():
    """Main connection loop with automatic reconnection"""
    while running:
        try:
            print(f"{Fore.BLUE}Connecting to Socket.IO server at {SERVER_URL}...{Style.RESET_ALL}")
            await sio.connect(SERVER_URL, transports=['websocket', 'polling'])
            print(f"{Fore.GREEN}Connection established. Client ID: {sio.sid}{Style.RESET_ALL}")
            await sio.wait()
        except Exception as e:
            if running:  # Only print error if we're not shutting down
                print(f"{Fore.RED}Connection lost. Reconnecting in {RECONNECT_DELAY} seconds... Error: {str(e)}{Style.RESET_ALL}")
                log_message("ERROR", {
                    "type": "connection_error",
                    "error": str(e),
                    "reconnect_delay": RECONNECT_DELAY
                })
            await asyncio.sleep(RECONNECT_DELAY)

if __name__ == "__main__":
    try:
        print(f"{Fore.BLUE}Starting Raydium Pool Listener...{Style.RESET_ALL}")
        asyncio.run(connect_to_server())
    except KeyboardInterrupt:
        pass
    finally:
        if sio.connected:
            asyncio.run(sio.disconnect()) 