#!/usr/bin/env python3
"""
Test script to verify Ctrl+C mechanism works properly
"""
import asyncio
import signal
import sys
from datetime import datetime
import socketio
from colorama import init, Fore, Style

# Initialize colorama
init()

# Create Socket.IO client
sio = socketio.AsyncClient(
    reconnection=False,  # Disable reconnection for testing
    logger=False,
    engineio_logger=False,
)

# Global flags
running = True
shutdown_requested = False

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
    
    # Schedule force shutdown after 3 seconds
    def force_shutdown():
        print(f"\n{Fore.RED}Force shutdown after timeout{Style.RESET_ALL}")
        sys.exit(1)
    
    import threading
    timer = threading.Timer(3.0, force_shutdown)
    timer.start()
    
    # Try to disconnect gracefully
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

@sio.event
async def connect():
    """Handle successful connection"""
    print(f"{Fore.GREEN}✅ Connected to server{Style.RESET_ALL}")
    print(f"{Fore.YELLOW}💡 Press Ctrl+C to test shutdown mechanism{Style.RESET_ALL}")

@sio.event
async def disconnect():
    """Handle disconnection"""
    print(f"{Fore.YELLOW}⚠️  Disconnected from server{Style.RESET_ALL}")

async def main():
    """Main function"""
    global running
    
    print(f"{Fore.CYAN}Starting Ctrl+C test...{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Connecting to localhost:5001...{Style.RESET_ALL}")
    
    try:
        await sio.connect('http://localhost:5001')
        
        # Keep connection alive
        while running and sio.connected:
            await asyncio.sleep(1)
            
    except Exception as e:
        print(f"{Fore.RED}Connection failed: {e}{Style.RESET_ALL}")
        print(f"{Fore.YELLOW}This is expected if the NestJS server is not running{Style.RESET_ALL}")
    finally:
        if sio.connected:
            await sio.disconnect()
        print(f"{Fore.GREEN}Test completed{Style.RESET_ALL}")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}Keyboard interrupt handled{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}Fatal error: {e}{Style.RESET_ALL}")
        sys.exit(1) 