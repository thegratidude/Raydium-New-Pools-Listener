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
    print(f"{Fore.CYAN}🎧 Listening for events: pool_status_6, pool_ready, health{Style.RESET_ALL}")
    print(f"{Fore.CYAN}⏰ Health updates will be shown once per minute...{Style.RESET_ALL}")
    print(f"{Fore.YELLOW}💡 Press Ctrl+C to stop the listener{Style.RESET_ALL}")

@sio.event
async def disconnect():
    """Handle disconnection from the server"""
    if not running:
        return
        
    log_message("DISCONNECT", {"status": "disconnected", "server": SERVER_URL})
    print(f"{Fore.YELLOW}⚠️  Disconnected from server{Style.RESET_ALL}")

@sio.on('pool_status_6')
async def on_pool_status_6(data):
    """Handle pool status 6 events (NEW Status 6 pools detected)"""
    if not running:
        return
        
    global NEW_POOL_COUNT
    NEW_POOL_COUNT += 1
    
    # Safely prepare data for logging by converting any problematic fields
    safe_data = {}
    for key, value in data.items():
        if isinstance(value, bytes):
            safe_data[key] = value.hex() if len(value) <= 32 else f"{value[:16].hex()}..."
        elif isinstance(value, dict):
            safe_data[key] = {}
            for k, v in value.items():
                if isinstance(v, bytes):
                    safe_data[key][k] = v.hex() if len(v) <= 32 else f"{v[:16].hex()}..."
                else:
                    safe_data[key][k] = v
        else:
            safe_data[key] = value
    
    # Log the safe message
    log_message("POOL_STATUS_6", {
        **safe_data,
        "client_id": sio.sid,
        "received_at": datetime.now().isoformat()
    })
    
    try:
        timestamp = datetime.fromtimestamp(data.get('timestamp', 0) / 1000)
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
        
        print(f"\n{Fore.GREEN}[{formatted_time}] 🚀 NEW STATUS 6 POOL DETECTED:{Style.RESET_ALL}")
        print(f"{Fore.GREEN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Pool ID: {data.get('pool_id', 'N/A')}{Style.RESET_ALL}")
        
        # Token information
        data_obj = data.get('data', {})
        token_a = data_obj.get('token_a', {})
        token_b = data_obj.get('token_b', {})
        print(f"{Fore.GREEN}Token A: {token_a.get('symbol', 'N/A')} ({token_a.get('mint', 'N/A')[:8]}...){Style.RESET_ALL}")
        print(f"{Fore.GREEN}Token B: {token_b.get('symbol', 'N/A')} ({token_b.get('mint', 'N/A')[:8]}...){Style.RESET_ALL}")
        
        # Pool timing
        pool_open_time = data_obj.get('pool_open_time', 0)
        if pool_open_time > 0:
            pool_open_date = datetime.fromtimestamp(pool_open_time)
            print(f"{Fore.GREEN}Pool Opens: {pool_open_date.strftime('%Y-%m-%d %H:%M:%S')}{Style.RESET_ALL}")
            
            # Calculate pool age
            current_time = datetime.now()
            pool_age = (current_time - pool_open_date).total_seconds()
            print(f"{Fore.GREEN}Pool Age: {pool_age:.1f}s{Style.RESET_ALL}")
        
        # Vault addresses for trading
        print(f"{Fore.CYAN}Base Vault: {data_obj.get('base_vault', 'N/A')[:8]}...{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Quote Vault: {data_obj.get('quote_vault', 'N/A')[:8]}...{Style.RESET_ALL}")
        
        # Market information
        print(f"{Fore.CYAN}LP Mint: {data_obj.get('lp_mint', 'N/A')[:8]}...{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Market ID: {data_obj.get('market_id', 'N/A')[:8]}...{Style.RESET_ALL}")
        print(f"{Fore.CYAN}AMM Open Orders: {data_obj.get('amm_open_orders', 'N/A')[:8]}...{Style.RESET_ALL}")
        
        # Fee structure
        trade_fee_num = data_obj.get('trade_fee_numerator', 0)
        trade_fee_den = data_obj.get('trade_fee_denominator', 10000)
        swap_fee_num = data_obj.get('swap_fee_numerator', 0)
        swap_fee_den = data_obj.get('swap_fee_denominator', 10000)
        
        trade_fee_pct = (trade_fee_num / trade_fee_den * 100) if trade_fee_den > 0 else 0
        swap_fee_pct = (swap_fee_num / swap_fee_den * 100) if swap_fee_den > 0 else 0
        
        print(f"{Fore.YELLOW}Trade Fee: {trade_fee_pct:.3f}% ({trade_fee_num}/{trade_fee_den}){Style.RESET_ALL}")
        print(f"{Fore.YELLOW}Swap Fee: {swap_fee_pct:.3f}% ({swap_fee_num}/{swap_fee_den}){Style.RESET_ALL}")
        
        # Trading parameters
        min_size = data_obj.get('min_size', 0)
        max_price_mult = data_obj.get('max_price_multiplier', 0)
        min_price_mult = data_obj.get('min_price_multiplier', 0)
        
        print(f"{Fore.YELLOW}Min Size: {min_size}{Style.RESET_ALL}")
        print(f"{Fore.YELLOW}Price Range: {min_price_mult:.2f}x - {max_price_mult:.2f}x{Style.RESET_ALL}")
        
        # Pool configuration
        base_decimals = data_obj.get('base_decimals', 9)
        quote_decimals = data_obj.get('quote_decimals', 6)
        depth = data_obj.get('depth', 0)
        
        print(f"{Fore.YELLOW}Decimals: {base_decimals}/{quote_decimals}{Style.RESET_ALL}")
        print(f"{Fore.YELLOW}Order Book Depth: {depth}{Style.RESET_ALL}")
        
        # Detection metadata
        detected_at = data_obj.get('detected_at', 0)
        pool_age_seconds = data_obj.get('pool_age_seconds', 0)
        
        print(f"{Fore.MAGENTA}Detected At: {datetime.fromtimestamp(detected_at/1000).strftime('%H:%M:%S.%f')[:-3]}{Style.RESET_ALL}")
        print(f"{Fore.MAGENTA}Detection Delay: {pool_age_seconds}s{Style.RESET_ALL}")
        
        print(f"{Fore.GREEN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        
        # Send acknowledgment back to server
        await sio.emit('pool_status_6_received', {
            'pool_id': data.get('pool_id'),
            'received_at': datetime.now().isoformat(),
            'client_id': sio.sid
        })
        
    except Exception as e:
        print(f"{Fore.RED}Error processing pool_status_6 message: {str(e)}{Style.RESET_ALL}")
        log_message("ERROR", {
            "type": "pool_status_6_processing_error",
            "error": str(e),
            "data": safe_data,
            "client_id": sio.sid
        })

@sio.on('pool_ready')
async def on_pool_ready(data):
    """Handle pool ready events (pools ready for trading)"""
    if not running:
        return
        
    log_message("POOL_READY", {
        **data,
        "client_id": sio.sid,
        "received_at": datetime.now().isoformat()
    })
    
    try:
        timestamp = datetime.fromtimestamp(data.get('timestamp', 0) / 1000)
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
        
        print(f"\n{Fore.CYAN}[{formatted_time}] 🎯 POOL READY FOR TRADING:{Style.RESET_ALL}")
        print(f"{Fore.CYAN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Pool ID: {data.get('pool_id', 'N/A')}{Style.RESET_ALL}")
        
        # Trading information
        data_obj = data.get('data', {})
        print(f"{Fore.CYAN}Base Token: {data_obj.get('base_token', 'N/A')}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Quote Token: {data_obj.get('quote_token', 'N/A')}{Style.RESET_ALL}")
        
        # Pool timing
        pool_open_time = data_obj.get('pool_open_time', 0)
        if pool_open_time > 0:
            pool_open_date = datetime.fromtimestamp(pool_open_time)
            print(f"{Fore.CYAN}Pool Opened: {pool_open_date.strftime('%Y-%m-%d %H:%M:%S')}{Style.RESET_ALL}")
        
        print(f"{Fore.CYAN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        
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