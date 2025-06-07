"""
WebSocket client for Raydium pool monitoring and automated trading.
Implements a complete trading workflow:
1. Listen for new pools on port 5001
2. Execute immediate buys using swap_buy_ammv4
3. Record transactions in SQLite database
4. Monitor pools using TypeScript bridge
5. Execute sells based on exit criteria
6. Record all transactions
"""

import socketio
import asyncio
import logging
import logging.config
import os
import json
import sys
from datetime import datetime
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from decimal import Decimal
from dotenv import load_dotenv
from config import SERVER_CONFIG, LOGGING_CONFIG, EVENT_TYPES, DISPLAY_CONFIG
from db_manager import DatabaseManager
from swap.swap_buy_ammv4 import execute_buy
from swap.swap_sell_ammv4 import execute_sell
from paper_trading import PaperTradingManager

# Load environment variables
load_dotenv()

# Configure logging
logging.config.dictConfig(LOGGING_CONFIG)
logger = logging.getLogger(__name__)

# Add file handler for persistent logging
log_dir = 'logs'
log_file = os.path.join(log_dir, 'paper_trading.log')
os.makedirs(log_dir, exist_ok=True)
file_handler = logging.FileHandler(log_file)
file_handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s')
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

@dataclass
class TradeConfig:
    """Configuration for trading parameters."""
    initial_buy_amount: float = float(os.getenv('INITIAL_BUY', '0.005'))
    live_trading: bool = os.getenv('LIVE_TRADING', '0') == '1'
    max_reconnection_attempts: int = 5
    reconnection_delay: int = 1000
    reconnection_delay_max: int = 5000
    health_check_interval: int = 5
    exit_profit_threshold: float = float(os.getenv('EXIT_PROFIT_THRESHOLD', '0.1'))  # 10% profit
    stop_loss_threshold: float = float(os.getenv('STOP_LOSS_THRESHOLD', '-0.1'))  # 10% loss
    consecutive_updates_required: int = int(os.getenv('CONSECUTIVE_UPDATES', '3'))
    server_url: str = os.getenv('SERVER_URL', f"http://{SERVER_CONFIG['host']}:{SERVER_CONFIG['port']}")
    socket_path: str = os.getenv('SOCKET_PATH', '/socket.io/')

class RaydiumWebSocketClient:
    """Main WebSocket client for Raydium pool monitoring and trading."""
    
    def __init__(self, config: TradeConfig):
        self.config = config
        
        # Initialize Socket.IO client with proper error handling
        try:
            self.sio = socketio.AsyncClient(
                logger=True,
                engineio_logger=True,
                reconnection=True,
                reconnection_attempts=config.max_reconnection_attempts,
                reconnection_delay=config.reconnection_delay,
                reconnection_delay_max=config.reconnection_delay_max,
                randomization_factor=0.5
            )
        except Exception as e:
            logger.error(f"Failed to initialize Socket.IO client: {str(e)}")
            raise
        
        # Initialize database manager with error handling
        try:
            self.db_manager = DatabaseManager('trading_history.sqlite')
        except Exception as e:
            logger.error(f"Failed to initialize database: {str(e)}")
            raise
        
        # Initialize trading components based on mode
        if config.live_trading:
            logger.info("Running in LIVE TRADING mode")
            if not os.getenv('PAYER_PRIVATE_KEY'):
                logger.warning("PAYER_PRIVATE_KEY not set. Live trading will not work.")
            self.paper_trader = None
        else:
            logger.info("Running in PAPER TRADING mode")
            try:
                self.paper_trader = PaperTradingManager()
            except Exception as e:
                logger.error(f"Failed to initialize paper trading: {str(e)}")
                raise
        
        # Track active pool monitoring
        self._active_monitors: Dict[str, Dict[str, Any]] = {}
        
        # Register event handlers
        self._register_event_handlers()
    
    def _register_event_handlers(self):
        """Register all Socket.IO event handlers."""
        # Connection events
        self.sio.on('connect', self._on_connect)
        self.sio.on('connect_error', self._on_connect_error)
        self.sio.on('disconnect', self._on_disconnect)
        
        # Trading events
        self.sio.on(EVENT_TYPES['NEW_POOL'], self._on_new_pool)
        self.sio.on(EVENT_TYPES['HEALTH'], self._on_health)
        self.sio.on(EVENT_TYPES['POOL_UPDATE'], self._on_pool_update)
    
    async def _on_connect(self):
        """Handle successful connection to the server."""
        logger.info("✅ Connected to Raydium server")
        logger.info("Waiting for new pool events...")
    
    async def _on_connect_error(self, data):
        """Handle connection errors."""
        logger.error(f"❌ Connection error: {data}")
    
    async def _on_disconnect(self):
        """Handle disconnection from the server."""
        logger.warning("⚠️ Disconnected from server. Attempting to reconnect...")
        await self._cleanup_active_monitors()
    
    async def _on_health(self, data):
        """Handle health check events."""
        logger.info(f"Health check: {data}")
    
    async def _cleanup_active_monitors(self):
        """Cancel all active monitoring tasks."""
        for pool_id, monitor_data in self._active_monitors.items():
            if 'task' in monitor_data and not monitor_data['task'].done():
                monitor_data['task'].cancel()
                try:
                    await monitor_data['task']
                except asyncio.CancelledError:
                    pass
        self._active_monitors.clear()
    
    async def _execute_buy(self, pool_id: str, base_mint: str, quote_mint: str,
                          base_decimals: int, quote_decimals: int,
                          initial_price: float) -> Dict[str, Any]:
        """Execute buy trade in either live or paper trading mode."""
        try:
            if self.config.live_trading:
                logger.info(f"Executing LIVE buy for pool {pool_id}...")
                trade_result = await execute_buy(pool_id, self.config.initial_buy_amount)
            else:
                logger.info(f"Executing PAPER buy for pool{pool_id}...")
                trade_result = self.paper_trader.execute_buy(
                    pool_id=pool_id,
                    base_mint=base_mint,
                    quote_mint=quote_mint,
                    price=initial_price,
                    base_decimals=base_decimals,
                    quote_decimals=quote_decimals,
                    sol_amount=self.config.initial_buy_amount
                )
            
            # Record trade in database
            if trade_result['status'] == 'confirmed':
                await self._record_trade(pool_id, trade_result, 'buy')
            
            return trade_result
            
        except Exception as e:
            logger.error(f"Error executing buy: {str(e)}")
            return {
                'tx_signature': None,
                'pool_id': pool_id,
                'base_amount': 0,
                'quote_amount': self.config.initial_buy_amount,
                'price': initial_price,
                'timestamp': int(datetime.now().timestamp() * 1000),
                'status': 'failed',
                'error': str(e)
            }
    
    async def _execute_sell(self, pool_id: str, current_price: float, 
                          sell_percentage: float = 1.0) -> Dict[str, Any]:
        """Execute sell trade in either live or paper trading mode."""
        try:
            if self.config.live_trading:
                logger.info(f"Executing LIVE sell for pool {pool_id}...")
                trade_result = await execute_sell(pool_id, sell_percentage)
            else:
                logger.info(f"Executing PAPER sell for pool {pool_id}...")
                trade_result = self.paper_trader.execute_sell(
                    pool_id=pool_id,
                    price=current_price,
                    percentage=sell_percentage
                )
            
            # Record trade in database
            if trade_result['status'] == 'confirmed':
                await self._record_trade(pool_id, trade_result, 'sell')
                # Update pool status to closed
                self.db_manager.update_pool_status(pool_id, 'closed')
            
            return trade_result
            
        except Exception as e:
            logger.error(f"Error executing sell: {str(e)}")
            return {
                'tx_signature': None,
                'pool_id': pool_id,
                'base_amount': 0,
                'quote_amount': 0,
                'price': current_price,
                'timestamp': int(datetime.now().timestamp() * 1000),
                'status': 'failed',
                'error': str(e)
            }
    
    async def _record_trade(self, pool_id: str, trade_result: Dict[str, Any], trade_type: str):
        """Record trade details in the database."""
        try:
            # Store trade record
            if not self.db_manager.store_trade({
                **trade_result,
                'trade_type': trade_type
            }):
                logger.error(f"Failed to store {trade_type} trade for pool {pool_id}")
                return
            
            # For buys, create or update position
            if trade_type == 'buy':
                position_data = {
                    'pool_id': pool_id,
                    'entry_trade_id': trade_result['tx_signature'],
                    'entry_price': trade_result['price'],
                    'entry_timestamp': trade_result['timestamp'],
                    'status': 'open'
                }
                if not self.db_manager.store_position(position_data):
                    logger.error(f"Failed to store position for pool {pool_id}")
                    return
            
            logger.info(f"✅ Successfully recorded {trade_type} trade for pool {pool_id}")
            
        except Exception as e:
            logger.error(f"Error recording {trade_type} trade: {str(e)}")
    
    async def _on_new_pool(self, data: Dict[str, Any]):
        """Handle new pool discovery events."""
        try:
            # Extract and validate pool details
            pool_id = data.get('poolId')
            if not pool_id:
                logger.error("Received new pool event without pool ID")
                return
                
            base_mint = data.get('baseMint')
            quote_mint = data.get('quoteMint')
            base_decimals = int(data.get('baseDecimals', 9))
            quote_decimals = int(data.get('quoteDecimals', 6))
            
            # Handle initial price
            try:
                initial_price = float(data.get('initialPrice', 0.0))
            except (ValueError, TypeError):
                logger.warning(f"Invalid initial price: {data.get('initialPrice')}, using 0.0")
                initial_price = 0.0
            
            timestamp = data.get('timestamp', int(datetime.now().timestamp() * 1000))
            
            # Log pool details
            logger.info(f"\n{'='*50}")
            logger.info(f"🚀 NEW POOL DETECTED")
            logger.info(f"Pool ID: {pool_id}")
            logger.info(f"Base Token: {base_mint} (decimals: {base_decimals})")
            logger.info(f"Quote Token: {quote_mint} (decimals: {quote_decimals})")
            logger.info(f"Initial Price: {initial_price}")
            logger.info(f"{'='*50}\n")
            
            # Store pool in database
            pool_data = {
                'pool_id': pool_id,
                'base_mint': base_mint,
                'quote_mint': quote_mint,
                'base_decimals': base_decimals,
                'quote_decimals': quote_decimals,
                'initial_price': initial_price,
                'discovery_timestamp': timestamp,
                'status': 'active'
            }
            
            if not self.db_manager.store_pool(pool_data):
                logger.error(f"Failed to store pool {pool_id} in database")
                return
            
            # Execute buy trade
            trade_result = await self._execute_buy(
                pool_id=pool_id,
                base_mint=base_mint,
                quote_mint=quote_mint,
                base_decimals=base_decimals,
                quote_decimals=quote_decimals,
                initial_price=initial_price
            )
            
            if trade_result['status'] == 'confirmed':
                # Start monitoring the pool
                self._start_pool_monitoring(pool_id, initial_price)
            else:
                logger.error(f"❌ Buy trade failed: {trade_result.get('error', 'Unknown error')}")
                
        except Exception as e:
            logger.error(f"Error processing new pool event: {str(e)}")
            logger.error(f"Event data: {data}")
    
    def _start_pool_monitoring(self, pool_id: str, entry_price: float):
        """Start monitoring a pool for exit conditions."""
        if pool_id in self._active_monitors:
            logger.warning(f"Pool {pool_id} is already being monitored")
            return
        
        # Initialize monitoring data
        self._active_monitors[pool_id] = {
            'entry_price': entry_price,
            'last_price': entry_price,
            'consecutive_updates': 0,
            'last_update_time': datetime.now(),
            'status': 'monitoring'
        }
        
        logger.info(f"Started monitoring pool {pool_id}")
    
    async def _on_pool_update(self, data: Dict[str, Any]):
        """Handle pool price update events."""
        try:
            pool_id = data.get('poolId')
            current_price = data.get('price')
            
            if not pool_id or not current_price:
                return
            
            # Update monitoring data
            if pool_id in self._active_monitors:
                monitor_data = self._active_monitors[pool_id]
                monitor_data['last_price'] = current_price
                monitor_data['last_update_time'] = datetime.now()
                
                # Calculate profit percentage
                entry_price = monitor_data['entry_price']
                profit_pct = (current_price - entry_price) / entry_price
                
                # Check exit conditions
                should_exit = False
                exit_reason = None
                
                # Stop loss check
                if profit_pct <= self.config.stop_loss_threshold:
                    should_exit = True
                    exit_reason = f"Stop loss triggered at {profit_pct:.2%}"
                
                # Profit target check
                elif profit_pct >= self.config.exit_profit_threshold:
                    monitor_data['consecutive_updates'] += 1
                    if monitor_data['consecutive_updates'] >= self.config.consecutive_updates_required:
                        should_exit = True
                        exit_reason = f"Profit target reached at {profit_pct:.2%}"
                else:
                    monitor_data['consecutive_updates'] = 0
                
                if should_exit:
                    logger.info(f"\n{'='*50}")
                    logger.info(f"💰 EXIT SIGNAL DETECTED")
                    logger.info(f"Pool: {pool_id}")
                    logger.info(f"Reason: {exit_reason}")
                    logger.info(f"Entry Price: {entry_price}")
                    logger.info(f"Current Price: {current_price}")
                    logger.info(f"Profit: {profit_pct:.2%}")
                    logger.info(f"{'='*50}\n")
                    
                    # Execute sell
                    sell_result = await self._execute_sell(pool_id, current_price)
                    
                    if sell_result['status'] == 'confirmed':
                        # Remove from active monitors
                        del self._active_monitors[pool_id]
                        logger.info(f"Successfully exited position in pool {pool_id}")
                    else:
                        logger.error(f"Failed to execute sell for pool {pool_id}: {sell_result.get('error')}")
                
        except Exception as e:
            logger.error(f"Error processing pool update: {str(e)}")
    
    async def start(self):
        """Start the WebSocket client and maintain connection."""
        try:
            logger.info(f"Starting Raydium WebSocket client... Connecting to {self.config.server_url}")
            
            # Attempt connection with timeout
            try:
                await asyncio.wait_for(
                    self.sio.connect(
                        self.config.server_url,
                        wait_timeout=10
                    ),
                    timeout=15
                )
                logger.info("Connection established. Listening for events (including real-time price updates)...")
            except asyncio.TimeoutError:
                logger.error("Connection attempt timed out")
                raise
            except Exception as e:
                logger.error(f"Connection failed: {str(e)}")
                raise
            
            # Keep the client running
            while True:
                try:
                    await asyncio.sleep(1)
                except asyncio.CancelledError:
                    logger.info("Client task cancelled")
                    break
                except Exception as e:
                    logger.error(f"Error in main loop: {str(e)}")
                    await asyncio.sleep(5)  # Wait before retrying
                
        except KeyboardInterrupt:
            logger.info("Shutdown requested by user")
        except Exception as e:
            logger.error(f"Fatal error: {str(e)}")
            raise
        finally:
            await self.shutdown()
    
    async def shutdown(self):
        """Clean shutdown of the WebSocket client."""
        logger.info("Shutting down WebSocket client...")
        
        try:
            # Clean up active monitors
            await self._cleanup_active_monitors()
            
            # Disconnect from server
            if self.sio.connected:
                await self.sio.disconnect()
            
            # Close database connection
            if self.db_manager:
                self.db_manager.close()
            
            logger.info("Shutdown complete")
        except Exception as e:
            logger.error(f"Error during shutdown: {str(e)}")
            raise

async def main():
    """Main entry point."""
    try:
        config = TradeConfig()
        client = RaydiumWebSocketClient(config)
        
        try:
            await client.start()
        except KeyboardInterrupt:
            logger.info("Shutdown requested by user")
        except Exception as e:
            logger.error(f"Fatal error: {str(e)}")
            raise
        finally:
            await client.shutdown()
            
    except Exception as e:
        logger.error(f"Failed to start client: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Shutdown requested by user")
    except Exception as e:
        logger.error(f"Fatal error: {str(e)}")
        sys.exit(1) 