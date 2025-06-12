#!/usr/bin/env python3
"""
Raydium Pool Listener - Clean Version
Real-time monitoring of Raydium pool events and trading activities
"""

import asyncio
import json
import signal
import sys
from datetime import datetime
import socketio
from colorama import init, Fore, Style
import aiohttp

# Initialize colorama for cross-platform colored terminal output
init()

# Constants
SERVER_URL = 'http://localhost:5001'
RECONNECT_DELAY = 5
MESSAGE_LOG_FILE = 'logs/websocket_messages.log'

# Create Socket.IO client
sio = socketio.AsyncClient(
    reconnection=True,
    reconnection_attempts=0,
    reconnection_delay=RECONNECT_DELAY,
    reconnection_delay_max=30,
    randomization_factor=0.5,
    logger=False,
    engineio_logger=False,
)

# Global state
running = True
shutdown_requested = False
stats = {
    'pool_status_6_count': 0,
    'arbitrage_opportunities': 0,
    'paper_trades': 0,
    'health_checks': 0,
    'last_health_time': 0
}

def signal_handler(sig, frame):
    """Handle graceful shutdown"""
    global running, shutdown_requested
    
    if shutdown_requested:
        print(f"\n{Fore.RED}Force shutting down...{Style.RESET_ALL}")
        sys.exit(1)
    
    shutdown_requested = True
    print(f"\n{Fore.YELLOW}🛑 Shutdown requested (Ctrl+C)...{Style.RESET_ALL}")
    running = False

async def graceful_shutdown():
    """Perform graceful shutdown operations"""
    try:
        if sio.connected:
            print(f"{Fore.CYAN}🔌 Disconnecting from Socket.IO server...{Style.RESET_ALL}")
            await sio.disconnect()
            print(f"{Fore.GREEN}✅ Successfully disconnected{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}❌ Error disconnecting: {e}{Style.RESET_ALL}")
    
    print(f"{Fore.GREEN}✅ Shutdown complete{Style.RESET_ALL}")
    sys.exit(0)

def log_message(message_type: str, data: dict):
    """Log message to file"""
    if not running:
        return
        
    timestamp = datetime.now().isoformat()
    log_entry = f"[{timestamp}] {message_type}: {json.dumps(data, indent=2)}\n"
    
    try:
        with open(MESSAGE_LOG_FILE, 'a') as f:
            f.write(log_entry)
    except Exception as e:
        print(f"{Fore.RED}Error writing to log file: {e}{Style.RESET_ALL}")

def print_header():
    """Print application header"""
    print(f"{Fore.CYAN}╔════════════════════════════════════════════════════════════════════════════════╗{Style.RESET_ALL}")
    print(f"{Fore.CYAN}║                    🚀 RAYDIUM POOL LISTENER v2.0 🚀                        ║{Style.RESET_ALL}")
    print(f"{Fore.CYAN}║                    Real-time Pool Monitoring & Trading                       ║{Style.RESET_ALL}")
    print(f"{Fore.CYAN}╚════════════════════════════════════════════════════════════════════════════════╝{Style.RESET_ALL}")

def print_stats():
    """Print current statistics"""
    print(f"\n{Fore.MAGENTA}📊 STATISTICS:{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}   🆕 New Pools Detected: {stats['pool_status_6_count']}{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}   🎯 Arbitrage Opportunities: {stats['arbitrage_opportunities']}{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}   💰 Paper Trades: {stats['paper_trades']}{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}   🏥 Health Checks: {stats['health_checks']}{Style.RESET_ALL}")

# Socket.IO Event Handlers
@sio.event
async def connect():
    """Handle successful connection"""
    if not running:
        return
        
    print_header()
    print(f"{Fore.GREEN}✅ Connected to Socket.IO server at {SERVER_URL}{Style.RESET_ALL}")
    print(f"{Fore.GREEN}✅ Client ID: {sio.sid}{Style.RESET_ALL}")
    print(f"{Fore.GREEN}✅ Transport: {sio.transport()}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}🎧 Listening for events: pool_status_6, arbitrage_opportunity, paper_trading_update{Style.RESET_ALL}")
    print(f"{Fore.YELLOW}💡 Press Ctrl+C to stop the listener{Style.RESET_ALL}")
    
    # Send test connection
    try:
        await sio.emit('test_connection', {
            'client_id': sio.sid,
            'timestamp': datetime.now().isoformat(),
            'message': 'Python bridge connected and ready'
        })
        print(f"{Fore.GREEN}✅ Sent test connection message{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}❌ Error sending test message: {e}{Style.RESET_ALL}")

@sio.event
async def disconnect():
    """Handle disconnection"""
    if not running:
        return
    print(f"{Fore.YELLOW}⚠️  Disconnected from server{Style.RESET_ALL}")

@sio.event
async def test_response(data):
    """Handle test response from server"""
    if not running:
        return
    print(f"{Fore.GREEN}✅ Server test response: {data.get('message', 'N/A')}{Style.RESET_ALL}")

@sio.event
async def pool_status_6(data):
    """Handle new Status 6 pool events"""
    if not running:
        return
        
    stats['pool_status_6_count'] += 1
    
    try:
        timestamp = datetime.fromtimestamp(data.get('timestamp', 0) / 1000)
        formatted_time = timestamp.strftime('%H:%M:%S')
        
        print(f"\n{Fore.GREEN}🚀 NEW STATUS 6 POOL DETECTED - {formatted_time}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        
        pool_id = data.get('pool_id', 'N/A')
        data_obj = data.get('data', {})
        
        print(f"{Fore.GREEN}Pool ID: {pool_id[:8]}...{Style.RESET_ALL}")
        
        # Token information
        token_a = data_obj.get('token_a', {})
        token_b = data_obj.get('token_b', {})
        print(f"{Fore.GREEN}Token A: {token_a.get('symbol', 'N/A')} ({token_a.get('mint', 'N/A')[:8]}...){Style.RESET_ALL}")
        print(f"{Fore.GREEN}Token B: {token_b.get('symbol', 'N/A')} ({token_b.get('mint', 'N/A')[:8]}...){Style.RESET_ALL}")
        
        # Pool timing
        pool_open_time = data_obj.get('pool_open_time', 0)
        if pool_open_time > 0:
            pool_open_date = datetime.fromtimestamp(pool_open_time)
            print(f"{Fore.GREEN}Pool Opens: {pool_open_date.strftime('%H:%M:%S')}{Style.RESET_ALL}")
        
        # Trading info
        trade_fee = data_obj.get('trade_fee', 0)
        swap_fee = data_obj.get('swap_fee', 0)
        print(f"{Fore.YELLOW}Trade Fee: {trade_fee:.3f}% | Swap Fee: {swap_fee:.3f}%{Style.RESET_ALL}")
        
        # Detection info
        detected_at = data_obj.get('detected_at', 0)
        if detected_at > 0:
            detection_time = datetime.fromtimestamp(detected_at/1000)
            print(f"{Fore.MAGENTA}Detected: {detection_time.strftime('%H:%M:%S.%f')[:-3]}{Style.RESET_ALL}")
        
        print(f"{Fore.GREEN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        
        # Send acknowledgment
        await sio.emit('pool_status_6_received', {
            'pool_id': pool_id,
            'received_at': datetime.now().isoformat(),
            'client_id': sio.sid
        })
        
    except Exception as e:
        print(f"{Fore.RED}Error processing pool_status_6: {e}{Style.RESET_ALL}")

@sio.event
async def arbitrage_opportunity(data):
    """Handle arbitrage opportunity events"""
    if not running:
        return
        
    stats['arbitrage_opportunities'] += 1
    
    try:
        timestamp = datetime.fromtimestamp(data.get('timestamp', 0) / 1000)
        formatted_time = timestamp.strftime('%H:%M:%S')
        
        opportunity_data = data.get('data', {})
        
        print(f"\n{Fore.CYAN}🎯 ARBITRAGE OPPORTUNITY - {formatted_time}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        
        pool_id = data.get('pool_id', 'N/A')
        confidence = opportunity_data.get('confidence', 'N/A')
        entry_price = opportunity_data.get('entryPrice', 0)
        current_price = opportunity_data.get('currentPrice', 0)
        price_change = opportunity_data.get('priceChangePercent', 0)
        tvl_change = opportunity_data.get('tvlChangePercent', 0)
        
        print(f"{Fore.CYAN}Pool: {pool_id[:8]}... | Confidence: {confidence.upper()}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Entry Price: {entry_price:.8f} SOL{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Current Price: {current_price:.8f} SOL{Style.RESET_ALL}")
        print(f"{Fore.CYAN}Price Change: {price_change:+.2f}% | TVL Change: {tvl_change:+.2f}%{Style.RESET_ALL}")
        
        # Exit strategy
        exit_strategy = opportunity_data.get('exitStrategy', {})
        take_profit = exit_strategy.get('takeProfit', 0)
        stop_loss = exit_strategy.get('stopLoss', 0)
        max_hold_time = exit_strategy.get('maxHoldTime', 0) / 1000 / 60
        
        print(f"{Fore.YELLOW}Take Profit: {take_profit:.8f} SOL | Stop Loss: {stop_loss:.8f} SOL{Style.RESET_ALL}")
        print(f"{Fore.YELLOW}Max Hold Time: {max_hold_time:.0f} minutes{Style.RESET_ALL}")
        
        print(f"{Fore.CYAN}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        
    except Exception as e:
        print(f"{Fore.RED}Error processing arbitrage_opportunity: {e}{Style.RESET_ALL}")

@sio.event
async def paper_trading_update(data):
    """Handle paper trading updates"""
    if not running:
        return
        
    stats['paper_trades'] += 1
    
    try:
        trade_type = data.get('type', 'unknown').upper()
        pool_id = data.get('pool_id', 'N/A')
        amount = data.get('amount', 0)
        price = data.get('price', 0)
        pnl = data.get('pnl', 0)
        balance = data.get('balance', 0)
        
        print(f"\n{Fore.MAGENTA}💰 PAPER TRADING UPDATE{Style.RESET_ALL}")
        print(f"{Fore.MAGENTA}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        
        print(f"{Fore.MAGENTA}Type: {trade_type} | Pool: {pool_id[:8]}...{Style.RESET_ALL}")
        print(f"{Fore.MAGENTA}Amount: {amount:.4f} SOL | Price: {price:.8f} SOL{Style.RESET_ALL}")
        
        if pnl != 0:
            pnl_color = Fore.GREEN if pnl > 0 else Fore.RED
            print(f"{pnl_color}PnL: {pnl:+.4f} SOL{Style.RESET_ALL}")
        
        print(f"{Fore.MAGENTA}Portfolio Balance: {balance:.4f} SOL{Style.RESET_ALL}")
        print(f"{Fore.MAGENTA}════════════════════════════════════════════════════════════════════════════════{Style.RESET_ALL}")
        
    except Exception as e:
        print(f"{Fore.RED}Error processing paper_trading_update: {e}{Style.RESET_ALL}")

@sio.event
async def health(data):
    """Handle health check events"""
    if not running:
        return
        
    stats['health_checks'] += 1
    
    # Only show health every 5 minutes to reduce noise
    current_time = datetime.now()
    if stats['last_health_time'] == 0 or (current_time.timestamp() - stats['last_health_time']) >= 300:
        uptime = data.get('uptime', 0)
        hours = int(uptime) // 3600
        minutes = (int(uptime) % 3600) // 60
        
        print(f"\n{Fore.GREEN}🏥 HEALTH CHECK - {current_time.strftime('%H:%M:%S')}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   ⏱️  Server uptime: {hours}h {minutes}m{Style.RESET_ALL}")
        print(f"{Fore.GREEN}   💓 Health messages: {stats['health_checks']}{Style.RESET_ALL}")
        print_stats()
        
        stats['last_health_time'] = current_time.timestamp()

@sio.event
async def message(data):
    """Catch-all event handler for debugging"""
    if not running:
        return
    print(f"{Fore.RED}🔍 UNHANDLED EVENT: {data}{Style.RESET_ALL}")

# Main connection function
async def connect_to_server():
    """Connect to the Socket.IO server with retry logic"""
    global running
    
    while running:
        try:
            if sio.connected:
                print(f"{Fore.YELLOW}Already connected, maintaining connection...{Style.RESET_ALL}")
                while running and sio.connected:
                    await asyncio.sleep(1)
                if not running:
                    break
                continue
            
            print(f"{Fore.CYAN}Connecting to Socket.IO server at {SERVER_URL}...{Style.RESET_ALL}")
            await sio.connect(SERVER_URL)
            
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
    """Main function"""
    global running
    
    print(f"{Fore.CYAN}Starting Raydium Pool Listener (Clean Version)...{Style.RESET_ALL}")
    
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

# Register signal handlers
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}Shutdown complete{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}Fatal error: {e}{Style.RESET_ALL}")
        sys.exit(1) 