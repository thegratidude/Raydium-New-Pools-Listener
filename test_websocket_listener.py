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
MESSAGE_LOG_FILE = 'logs/websocket_messages.log'

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
shutdown_requested = False

# Track health messages to only show once per minute
last_health_log_time = 0
health_message_count = 0

def signal_handler(sig, frame):
    """Handle graceful shutdown on SIGINT (Ctrl+C)"""
    global running, shutdown_requested
    
    if shutdown_requested:
        print(f"\n{Fore.RED}Force shutting down...{Style.RESET_ALL}")
        sys.exit(1)
    
    shutdown_requested = True
    print(f"\n{Fore.YELLOW}🛑 Shutdown requested (Ctrl+C)...{Style.RESET_ALL}")
    print(f"{Fore.YELLOW}⏳ Disconnecting from server and cleaning up...{Style.RESET_ALL}")
    
    running = False
    
    # Schedule the actual shutdown after a brief delay to allow cleanup
    def force_shutdown():
        print(f"\n{Fore.RED}Force shutdown after timeout{Style.RESET_ALL}")
        sys.exit(1)
    
    # Set a timeout for graceful shutdown
    import threading
    timer = threading.Timer(5.0, force_shutdown)
    timer.start()
    
    # Try to disconnect gracefully
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Schedule the disconnect in the event loop
            asyncio.create_task(graceful_shutdown())
        else:
            # If no event loop is running, run the shutdown directly
            asyncio.run(graceful_shutdown())
    except Exception as e:
        print(f"{Fore.RED}Error during graceful shutdown: {e}{Style.RESET_ALL}")
        timer.cancel()
        sys.exit(1)

async def graceful_shutdown():
    """Perform graceful shutdown operations"""
    global sio
    
    try:
        if sio.connected:
            print(f"{Fore.CYAN}🔌 Disconnecting from Socket.IO server...{Style.RESET_ALL}")
            await sio.disconnect()
            print(f"{Fore.GREEN}✅ Successfully disconnected from server{Style.RESET_ALL}")
        else:
            print(f"{Fore.YELLOW}⚠️  Already disconnected from server{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}❌ Error disconnecting: {e}{Style.RESET_ALL}")
    
    print(f"{Fore.GREEN}✅ Shutdown complete{Style.RESET_ALL}")
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def log_message(message_type: str, data: dict):
    """Log message to both console and file"""
    if not running:
        return  # Don't log during shutdown
        
    timestamp = datetime.now().isoformat()
    log_entry = f"[{timestamp}] {message_type}: {json.dumps(data, indent=2)}\n"
    
    # Log to file
    try:
        with open(MESSAGE_LOG_FILE, 'a') as f:
            f.write(log_entry)
    except Exception as e:
        print(f"{Fore.RED}Error writing to log file: {e}{Style.RESET_ALL}")

@sio.event
async def connect():
    """Handle successful connection to the server"""
    if not running:
        return
        
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
    print(f"{Fore.YELLOW}💡 Press Ctrl+C to stop the listener{Style.RESET_ALL}")

@sio.event
async def disconnect():
    """Handle disconnection from the server"""
    if not running:
        return
        
    log_message("DISCONNECT", {"status": "disconnected", "server": SERVER_URL})
    print(f"{Fore.YELLOW}⚠️  Disconnected from server{Style.RESET_ALL}")

@sio.on('new_pool')
async def on_new_pool(data):
    """Handle new pool events"""
    if not running:
        return
        
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
    if not running:
        return
        
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
    if not running:
        return
        
    log_message("POOL_READY", {
        **data,
        "client_id": sio.sid,
        "received_at": datetime.now().isoformat()
    })
    
    try:
        timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
        
        print(f"\n{Fore.GREEN}[{formatted_time}] 🎯 STATUS 6 POOL READY:{Style.RESET_ALL}")
        print(f"{Fore.GREEN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Pool ID: {data.get('pool_id', 'N/A')}{Style.RESET_ALL}")
        
        # Trading information
        data_obj = data.get('data', {})
        print(f"{Fore.GREEN}Base Token: {data_obj.get('base_token', 'N/A')}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Quote Token: {data_obj.get('quote_token', 'N/A')}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Base Vault: {data_obj.get('base_vault', 'N/A')}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Quote Vault: {data_obj.get('quote_vault', 'N/A')}{Style.RESET_ALL}")
        
        # Reserves and price
        base_reserve = data_obj.get('base_reserve', 0)
        quote_reserve = data_obj.get('quote_reserve', 0)
        price = data_obj.get('price', 0)
        print(f"{Fore.GREEN}Base Reserve: {base_reserve}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Quote Reserve: {quote_reserve}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Current Price: {price:.6f} quote/base{Style.RESET_ALL}")
        
        # Timing information
        time_to_status_6 = data_obj.get('time_to_status_6_ms', 0)
        pool_open_time = data_obj.get('pool_open_time', 0)
        print(f"{Fore.GREEN}Time to Status 6: {time_to_status_6/1000:.1f}s{Style.RESET_ALL}")
        if pool_open_time > 0:
            pool_open_date = datetime.fromtimestamp(pool_open_time)
            print(f"{Fore.GREEN}Pool Opened: {pool_open_date.strftime('%Y-%m-%d %H:%M:%S')}{Style.RESET_ALL}")
        
        print(f"{Fore.GREEN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        
    except Exception as e:
        print(f"{Fore.RED}Error processing pool ready message: {str(e)}{Style.RESET_ALL}")

@sio.on('health')
async def on_health(data):
    """Handle health check events - only show once per minute"""
    if not running:
        return
        
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
        print(f"{Fore.GREEN}   💓 Health messages received: {health_message_count}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   🆕 New pools detected: {NEW_POOL_COUNT}{Style.RESET_ALL}")
        
        # Reset counters
        last_health_log_time = current_time
        health_message_count = 0

async def connect_to_server():
    """Connect to the Socket.IO server with retry logic"""
    global running
    
    while running:
        try:
            # Check if already connected
            if sio.connected:
                print(f"{Fore.YELLOW}Already connected to server, maintaining connection...{Style.RESET_ALL}")
                # Keep the connection alive
                while running and sio.connected:
                    await asyncio.sleep(1)
                if not running:
                    break
                continue
            
            print(f"{Fore.CYAN}Connecting to Socket.IO server at {SERVER_URL}...{Style.RESET_ALL}")
            await sio.connect(SERVER_URL)
            print(f"{Fore.GREEN}Connection established. Client ID: {sio.sid}{Style.RESET_ALL}")
            
            # Keep the connection alive
            while running and sio.connected:
                await asyncio.sleep(1)
                
            if not running:
                break
                
        except Exception as e:
            if not running:
                break
            print(f"{Fore.RED}Connection failed: {e}{Style.RESET_ALL}")
            print(f"{Fore.YELLOW}Retrying in {RECONNECT_DELAY} seconds...{Style.RESET_ALL}")
            await asyncio.sleep(RECONNECT_DELAY)

async def main():
    """Main function to run the listener"""
    global running
    
    print(f"{Fore.CYAN}Starting Raydium Pool Listener...{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Connecting to Socket.IO server at {SERVER_URL}...{Style.RESET_ALL}")
    
    try:
        await connect_to_server()
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}Keyboard interrupt received{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}Unexpected error: {e}{Style.RESET_ALL}")
    finally:
        if sio.connected:
            await sio.disconnect()
        print(f"{Fore.GREEN}Listener stopped{Style.RESET_ALL}")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}Shutdown complete{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}Fatal error: {e}{Style.RESET_ALL}")
        sys.exit(1) 