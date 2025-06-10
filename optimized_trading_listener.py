import asyncio
import json
import signal
import sys
import os
from datetime import datetime
import socketio
from colorama import init, Fore, Style
from typing import Dict, Any, Optional
import time
import threading
from concurrent.futures import ThreadPoolExecutor

# Constants
SERVER_URL = 'http://localhost:5001'
RECONNECT_DELAY = 5  # seconds
NEW_POOL_COUNT = 0
TRADE_COUNT = 0
MESSAGE_LOG_FILE = 'logs/optimized_trading.log'
TRADE_LOG_FILE = 'logs/trades_executed.log'

# Trading Configuration
TRADING_ENABLED = os.getenv('AUTO_TRADING_ENABLED', 'true').lower() == 'true'
SOL_AMOUNT = float(os.getenv('TRADE_SOL_AMOUNT', '0.05'))  # SOL amount per trade
SLIPPAGE = int(os.getenv('TRADE_SLIPPAGE', '5'))  # Slippage percentage
MAX_TRADES_PER_HOUR = int(os.getenv('MAX_TRADES_PER_HOUR', '10'))  # Rate limiting

# Performance Configuration
ENABLE_ASYNC_LOGGING = os.getenv('ASYNC_LOGGING', 'true').lower() == 'true'
LOG_BUFFER_SIZE = int(os.getenv('LOG_BUFFER_SIZE', '100'))
TRADE_TIMEOUT_MS = int(os.getenv('TRADE_TIMEOUT_MS', '30000'))  # 30 seconds
MAX_CONCURRENT_TRADES = int(os.getenv('MAX_CONCURRENT_TRADES', '3'))

# Initialize colorama for cross-platform colored terminal output
init()

# Create a Socket.IO client instance with optimized settings
sio = socketio.AsyncClient(
    reconnection=True,
    reconnection_attempts=0,
    reconnection_delay=RECONNECT_DELAY,
    reconnection_delay_max=30,
    randomization_factor=0.5,
    logger=False,
    engineio_logger=False,
    # Performance optimizations
    max_http_buffer_size=1e6,  # 1MB buffer
    ping_timeout=60,
    ping_interval=25,
)

# Global flags and state
running = True
shutdown_requested = False
last_health_log_time = 0
health_message_count = 0

# Trade tracking for rate limiting
trade_history: Dict[str, int] = {}  # pool_id -> timestamp
hourly_trade_count = 0
last_hour_reset = datetime.now().hour

# Performance tracking
trade_latencies: list = []
trade_start_times: Dict[str, float] = {}

# Async logging queue
log_queue = asyncio.Queue()
log_thread_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="Logger")

# Trade execution semaphore for concurrency control
trade_semaphore = asyncio.Semaphore(MAX_CONCURRENT_TRADES)

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
    
    def force_shutdown():
        print(f"\n{Fore.RED}Force shutdown after timeout{Style.RESET_ALL}")
        sys.exit(1)
    
    timer = threading.Timer(5.0, force_shutdown)
    timer.start()
    
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(graceful_shutdown())
        else:
            asyncio.run(graceful_shutdown())
    except Exception as e:
        print(f"{Fore.RED}Error during graceful shutdown: {e}{Style.RESET_ALL}")
        timer.cancel()
        sys.exit(1)

async def graceful_shutdown():
    """Perform graceful shutdown operations"""
    global sio, log_thread_pool
    
    try:
        if sio.connected:
            print(f"{Fore.CYAN}🔌 Disconnecting from Socket.IO server...{Style.RESET_ALL}")
            await sio.disconnect()
            print(f"{Fore.GREEN}✅ Successfully disconnected from server{Style.RESET_ALL}")
        else:
            print(f"{Fore.YELLOW}⚠️  Already disconnected from server{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}❌ Error disconnecting: {e}{Style.RESET_ALL}")
    
    # Shutdown thread pool
    log_thread_pool.shutdown(wait=True)
    
    print(f"{Fore.GREEN}✅ Shutdown complete{Style.RESET_ALL}")
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

async def async_log_message(message_type: str, data: dict):
    """Async logging to prevent blocking the event loop"""
    if not running:
        return
        
    timestamp = datetime.now().isoformat()
    log_entry = f"[{timestamp}] {message_type}: {json.dumps(data, indent=2)}\n"
    
    if ENABLE_ASYNC_LOGGING:
        await log_queue.put(('message', log_entry))
    else:
        # Fallback to synchronous logging
        try:
            with open(MESSAGE_LOG_FILE, 'a') as f:
                f.write(log_entry)
        except Exception as e:
            print(f"{Fore.RED}Error writing to log file: {e}{Style.RESET_ALL}")

async def async_log_trade(trade_data: dict):
    """Async trade logging"""
    timestamp = datetime.now().isoformat()
    log_entry = f"[{timestamp}] TRADE_EXECUTED: {json.dumps(trade_data, indent=2)}\n"
    
    if ENABLE_ASYNC_LOGGING:
        await log_queue.put(('trade', log_entry))
    else:
        # Fallback to synchronous logging
        try:
            with open(TRADE_LOG_FILE, 'a') as f:
                f.write(log_entry)
        except Exception as e:
            print(f"{Fore.RED}Error writing to trade log file: {e}{Style.RESET_ALL}")

def sync_write_log(log_type: str, log_entry: str):
    """Synchronous file writing in thread pool"""
    try:
        if log_type == 'message':
            with open(MESSAGE_LOG_FILE, 'a') as f:
                f.write(log_entry)
        elif log_type == 'trade':
            with open(TRADE_LOG_FILE, 'a') as f:
                f.write(log_entry)
    except Exception as e:
        print(f"{Fore.RED}Error writing to {log_type} log file: {e}{Style.RESET_ALL}")

async def log_worker():
    """Background worker for async logging"""
    while running:
        try:
            # Process log queue with timeout
            try:
                log_type, log_entry = await asyncio.wait_for(log_queue.get(), timeout=1.0)
                # Submit to thread pool for actual file I/O
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(log_thread_pool, sync_write_log, log_type, log_entry)
            except asyncio.TimeoutError:
                continue
        except Exception as e:
            print(f"{Fore.RED}Error in log worker: {e}{Style.RESET_ALL}")
            await asyncio.sleep(0.1)

def check_rate_limit() -> bool:
    """Check if we can execute another trade (rate limiting)"""
    global hourly_trade_count, last_hour_reset
    
    current_hour = datetime.now().hour
    
    # Reset hourly counter if hour changed
    if current_hour != last_hour_reset:
        hourly_trade_count = 0
        last_hour_reset = current_hour
    
    # Check if we're under the limit
    if hourly_trade_count >= MAX_TRADES_PER_HOUR:
        return False
    
    return True

def increment_trade_count():
    """Increment the hourly trade counter"""
    global hourly_trade_count
    hourly_trade_count += 1

async def execute_trade_inline(pool_id: str, base_token: str, quote_token: str) -> bool:
    """Execute trade inline without subprocess overhead"""
    global TRADE_COUNT
    
    if not TRADING_ENABLED:
        print(f"{Fore.YELLOW}⚠️  Trading is disabled (AUTO_TRADING_ENABLED=false){Style.RESET_ALL}")
        return False
    
    # Check rate limiting
    if not check_rate_limit():
        print(f"{Fore.YELLOW}⚠️  Rate limit exceeded ({MAX_TRADES_PER_HOUR} trades/hour){Style.RESET_ALL}")
        return False
    
    # Check if we've already traded this pool recently
    current_time = datetime.now()
    if pool_id in trade_history:
        last_trade_time = datetime.fromtimestamp(trade_history[pool_id])
        time_diff = (current_time - last_trade_time).total_seconds()
        if time_diff < 300:  # 5 minutes cooldown per pool
            print(f"{Fore.YELLOW}⚠️  Already traded pool {pool_id} recently (cooldown){Style.RESET_ALL}")
            return False
    
    # Record trade start time for latency tracking
    trade_start = time.time()
    trade_start_times[pool_id] = trade_start
    
    print(f"\n{Fore.MAGENTA}🚀 EXECUTING OPTIMIZED TRADE:{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}Pool ID: {pool_id}{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}Base Token: {base_token}{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}Quote Token: {quote_token}{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}SOL Amount: {SOL_AMOUNT}{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}Slippage: {SLIPPAGE}%{Style.RESET_ALL}")
    
    try:
        # Import the buy function directly (no subprocess overhead)
        from raydium.amm_v4 import buy
        
        # Execute trade with timeout
        trade_result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,  # Use default executor
                buy,
                pool_id,
                SOL_AMOUNT,
                SLIPPAGE
            ),
            timeout=TRADE_TIMEOUT_MS / 1000.0
        )
        
        # Calculate latency
        trade_end = time.time()
        latency_ms = (trade_end - trade_start) * 1000
        trade_latencies.append(latency_ms)
        
        # Keep only last 100 latencies for memory efficiency
        if len(trade_latencies) > 100:
            trade_latencies.pop(0)
        
        TRADE_COUNT += 1
        increment_trade_count()
        trade_history[pool_id] = int(current_time.timestamp())
        
        trade_data = {
            'pool_id': pool_id,
            'base_token': base_token,
            'quote_token': quote_token,
            'sol_amount': SOL_AMOUNT,
            'slippage': SLIPPAGE,
            'status': 'success',
            'latency_ms': round(latency_ms, 2),
            'timestamp': current_time.isoformat()
        }
        
        await async_log_trade(trade_data)
        
        print(f"{Fore.GREEN}✅ Trade executed successfully!{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Trade #: {TRADE_COUNT}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Latency: {latency_ms:.2f}ms{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Result: {trade_result}{Style.RESET_ALL}")
        
        return True
        
    except asyncio.TimeoutError:
        print(f"{Fore.RED}❌ Trade execution timed out after {TRADE_TIMEOUT_MS}ms{Style.RESET_ALL}")
        return False
    except Exception as e:
        print(f"{Fore.RED}❌ Error executing trade: {e}{Style.RESET_ALL}")
        return False
    finally:
        # Clean up trade start time
        if pool_id in trade_start_times:
            del trade_start_times[pool_id]

async def execute_trade(pool_id: str, base_token: str, quote_token: str) -> bool:
    """Execute trade with concurrency control"""
    async with trade_semaphore:
        return await execute_trade_inline(pool_id, base_token, quote_token)

@sio.event
async def connect():
    """Handle successful connection to the server"""
    if not running:
        return
        
    await async_log_message("CONNECT", {
        "status": "connected",
        "server": SERVER_URL,
        "client_id": sio.sid,
        "transport": sio.transport(),
        "trading_enabled": TRADING_ENABLED,
        "sol_amount": SOL_AMOUNT,
        "slippage": SLIPPAGE,
        "max_trades_per_hour": MAX_TRADES_PER_HOUR,
        "optimizations": {
            "async_logging": ENABLE_ASYNC_LOGGING,
            "max_concurrent_trades": MAX_CONCURRENT_TRADES,
            "trade_timeout_ms": TRADE_TIMEOUT_MS
        }
    })
    
    print(f"{Fore.GREEN}✅ Connected to Socket.IO server at {SERVER_URL}{Style.RESET_ALL}")
    print(f"{Fore.GREEN}✅ Client ID: {sio.sid}{Style.RESET_ALL}")
    print(f"{Fore.GREEN}✅ Transport: {sio.transport()}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}🎧 Listening for events: pool_status_6, pool_ready{Style.RESET_ALL}")
    print(f"{Fore.CYAN}🤖 Automated Trading: {'ENABLED' if TRADING_ENABLED else 'DISABLED'}{Style.RESET_ALL}")
    if TRADING_ENABLED:
        print(f"{Fore.CYAN}💰 Trade Amount: {SOL_AMOUNT} SOL per trade{Style.RESET_ALL}")
        print(f"{Fore.CYAN}📊 Slippage: {SLIPPAGE}%{Style.RESET_ALL}")
        print(f"{Fore.CYAN}⏱️  Rate Limit: {MAX_TRADES_PER_HOUR} trades/hour{Style.RESET_ALL}")
        print(f"{Fore.CYAN}⚡ Max Concurrent: {MAX_CONCURRENT_TRADES} trades{Style.RESET_ALL}")
        print(f"{Fore.CYAN}🚀 Async Logging: {'ENABLED' if ENABLE_ASYNC_LOGGING else 'DISABLED'}{Style.RESET_ALL}")
    print(f"{Fore.YELLOW}💡 Press Ctrl+C to stop the listener{Style.RESET_ALL}")

@sio.event
async def disconnect():
    """Handle disconnection from the server"""
    if not running:
        return
        
    await async_log_message("DISCONNECT", {"status": "disconnected", "server": SERVER_URL})
    print(f"{Fore.YELLOW}⚠️  Disconnected from server{Style.RESET_ALL}")

@sio.on('pool_status_6')
async def on_pool_status_6(data):
    """Handle status 6 events - pool is now tradeable"""
    if not running:
        return
        
    global NEW_POOL_COUNT
    NEW_POOL_COUNT += 1
    
    await async_log_message("POOL_STATUS_6", {
        **data,
        "client_id": sio.sid,
        "received_at": datetime.now().isoformat()
    })
    
    try:
        timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
        
        print(f"\n{Fore.BLUE}[{formatted_time}] 🎯 STATUS 6 DETECTED:{Style.RESET_ALL}")
        print(f"{Fore.BLUE}Pool ID: {data.get('pool_id', 'N/A')}{Style.RESET_ALL}")
        
        data_obj = data.get('data', {})
        base_token = data_obj.get('token_a', {}).get('symbol', 'N/A')
        quote_token = data_obj.get('token_b', {}).get('symbol', 'N/A')
        
        print(f"{Fore.BLUE}Base Token: {base_token}{Style.RESET_ALL}")
        print(f"{Fore.BLUE}Quote Token: {quote_token}{Style.RESET_ALL}")
        print(f"{Fore.BLUE}Pool Open Time: {data_obj.get('pool_open_time', 'N/A')}{Style.RESET_ALL}")
        
        # Execute trade if this is a new pool (not missed tee up)
        if not data_obj.get('missed_tee_up', False):
            print(f"{Fore.CYAN}🤖 Attempting optimized trade...{Style.RESET_ALL}")
            await execute_trade(
                data.get('pool_id'),
                base_token,
                quote_token
            )
        else:
            print(f"{Fore.YELLOW}⚠️  Skipping trade - missed tee up{Style.RESET_ALL}")
        
    except Exception as e:
        print(f"{Fore.RED}Error processing status 6 message: {str(e)}{Style.RESET_ALL}")

@sio.on('pool_ready')
async def on_pool_ready(data):
    """Handle pool ready events - this is our main trading trigger"""
    if not running:
        return
        
    await async_log_message("POOL_READY", {
        **data,
        "client_id": sio.sid,
        "received_at": datetime.now().isoformat()
    })
    
    try:
        timestamp = datetime.fromisoformat(data.get('timestamp', '').replace('Z', '+00:00'))
        formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
        
        print(f"\n{Fore.GREEN}[{formatted_time}] 🎯 POOL READY FOR TRADING:{Style.RESET_ALL}")
        print(f"{Fore.GREEN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Pool ID: {data.get('pool_id', 'N/A')}{Style.RESET_ALL}")
        
        # Trading information
        data_obj = data.get('data', {})
        base_token = data_obj.get('base_token', 'N/A')
        quote_token = data_obj.get('quote_token', 'N/A')
        
        print(f"{Fore.GREEN}Base Token: {base_token}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Quote Token: {quote_token}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}Pool Open Time: {data_obj.get('pool_open_time', 'N/A')}{Style.RESET_ALL}")
        
        print(f"{Fore.GREEN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        
        # Execute the automated trade
        print(f"{Fore.CYAN}🤖 Executing optimized trade...{Style.RESET_ALL}")
        await execute_trade(
            data.get('pool_id'),
            base_token,
            quote_token
        )
        
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
        
        # Calculate average latency
        avg_latency = sum(trade_latencies) / len(trade_latencies) if trade_latencies else 0
        
        print(f"\n{Fore.GREEN}🏥 HEALTH CHECK - {current_time.strftime('%H:%M:%S')}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   ⏱️  Server uptime: {hours}h {minutes}m{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   💓 Health messages received: {health_message_count}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   🆕 New pools detected: {NEW_POOL_COUNT}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   💰 Trades executed: {TRADE_COUNT}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   ⏱️  Hourly trades: {hourly_trade_count}/{MAX_TRADES_PER_HOUR}{Style.RESET_ALL}")
        if trade_latencies:
            print(f"{Fore.GREEN}   ⚡ Avg trade latency: {avg_latency:.2f}ms{Style.RESET_ALL}")
        
        # Reset counters
        last_health_log_time = current_time
        health_message_count = 0

async def connect_to_server():
    """Connect to the Socket.IO server with retry logic"""
    global running
    
    while running:
        try:
            if sio.connected:
                print(f"{Fore.YELLOW}Already connected to server, maintaining connection...{Style.RESET_ALL}")
                while running and sio.connected:
                    await asyncio.sleep(1)
                if not running:
                    break
                continue
            
            print(f"{Fore.CYAN}Connecting to Socket.IO server at {SERVER_URL}...{Style.RESET_ALL}")
            await sio.connect(SERVER_URL)
            print(f"{Fore.GREEN}Connection established. Client ID: {sio.sid}{Style.RESET_ALL}")
            
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
    """Main function to run the optimized trading listener"""
    global running
    
    print(f"{Fore.CYAN}Starting Optimized Trading Listener...{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Connecting to Socket.IO server at {SERVER_URL}...{Style.RESET_ALL}")
    
    # Create log directories if they don't exist
    os.makedirs('logs', exist_ok=True)
    
    # Start async log worker
    log_worker_task = asyncio.create_task(log_worker())
    
    try:
        await connect_to_server()
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}Keyboard interrupt received{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}Unexpected error: {e}{Style.RESET_ALL}")
    finally:
        # Cancel log worker
        log_worker_task.cancel()
        try:
            await log_worker_task
        except asyncio.CancelledError:
            pass
        
        if sio.connected:
            await sio.disconnect()
        print(f"{Fore.GREEN}Optimized trading listener stopped{Style.RESET_ALL}")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}Shutdown complete{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}Fatal error: {e}{Style.RESET_ALL}")
        sys.exit(1) 