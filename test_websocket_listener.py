"""
WebSocket client for Raydium pool monitoring and automated trading.
Implements immediate trading with optimized latency handling.
"""

import socketio
import asyncio
import logging
import logging.config
import os
import json
import sys
from datetime import datetime
from typing import Dict, Any, Optional, List, Set, Deque
from collections import deque
from dataclasses import dataclass
from decimal import Decimal
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor
from config import SERVER_CONFIG, LOGGING_CONFIG, EVENT_TYPES, DISPLAY_CONFIG
from db_manager import DatabaseManager
from swap.swap_buy_ammv4 import execute_buy
from swap.swap_sell_ammv4 import execute_sell
from paper_trading import PaperTradingManager

# Load environment variables
load_dotenv()

# Configure logging
logging.config.dictConfig({
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'standard': {
            'format': '%(asctime)s [%(levelname)s] %(message)s',
            'datefmt': '%H:%M:%S'
        },
        'pool_event': {
            'format': '\n%(message)s\n',
            'datefmt': '%H:%M:%S'
        },
        'trade_event': {
            'format': '\n%(message)s\n',
            'datefmt': '%H:%M:%S'
        }
    },
    'handlers': {
        'default': {
            'level': 'INFO',
            'formatter': 'standard',
            'class': 'logging.StreamHandler',
        },
        'file': {
            'level': 'INFO',
            'formatter': 'standard',
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': 'logs/paper_trading.log',
            'maxBytes': 10 * 1024 * 1024,  # 10MB
            'backupCount': 5,
        },
    },
    'loggers': {
        '': {  # Root logger
            'handlers': ['default', 'file'],
            'level': 'INFO',
            'propagate': True
        }
    }
})

# Initialize loggers
logger = logging.getLogger(__name__)  # Main logger for general logging
pool_logger = logging.getLogger('pool_events')  # Logger for pool-related events
trade_logger = logging.getLogger('trade_events')  # Logger for trade-related events

# Create log directory if it doesn't exist
os.makedirs('logs', exist_ok=True)

def log_pool_event(message: str, level: str = 'info'):
    """Log a pool-related event with visual formatting."""
    separator = '=' * 80
    formatted_message = f"\n{separator}\n{message}\n{separator}\n"
    if level == 'info':
        pool_logger.info(formatted_message)
    elif level == 'warning':
        pool_logger.warning(formatted_message)
    elif level == 'error':
        pool_logger.error(formatted_message)

def log_trade_event(message: str, level: str = 'info'):
    """Log a trade-related event with visual formatting."""
    separator = '-' * 80
    formatted_message = f"\n{separator}\n{message}\n{separator}\n"
    if level == 'info':
        trade_logger.info(formatted_message)
    elif level == 'warning':
        trade_logger.warning(formatted_message)
    elif level == 'error':
        trade_logger.error(formatted_message)

@dataclass
class TradeConfig:
    """Configuration for trading parameters."""
    initial_buy_amount: float = float(os.getenv('INITIAL_BUY', '0.005'))
    live_trading: bool = os.getenv('LIVE_TRADING', '0') == '1'
    max_reconnection_attempts: int = 5
    reconnection_delay: int = 1000
    reconnection_delay_max: int = 5000
    health_check_interval: int = 5
    exit_profit_threshold: float = float(os.getenv('EXIT_PROFIT_THRESHOLD', '0.1'))
    stop_loss_threshold: float = float(os.getenv('STOP_LOSS_THRESHOLD', '-0.1'))
    consecutive_updates_required: int = int(os.getenv('CONSECUTIVE_UPDATES', '3'))
    server_url: str = os.getenv('SERVER_URL', f"http://{SERVER_CONFIG['host']}:{SERVER_CONFIG['port']}")
    socket_path: str = os.getenv('SOCKET_PATH', '/socket.io/')
    max_parallel_pools: int = int(os.getenv('MAX_PARALLEL_POOLS', '10'))
    rpc_connection_pool_size: int = int(os.getenv('RPC_POOL_SIZE', '5'))
    min_liquidity_threshold: float = float(os.getenv('MIN_LIQUIDITY', '0.5'))
    max_price_impact: float = float(os.getenv('MAX_PRICE_IMPACT', '0.05'))
    immediate_trading: bool = os.getenv('IMMEDIATE_TRADING', '1') == '1'
    max_trade_delay_ms: int = int(os.getenv('MAX_TRADE_DELAY_MS', '100'))
    max_pool_age_ms: int = int(os.getenv('MAX_POOL_AGE_MS', '5000'))  # Maximum age of pool to consider for trading
    pre_warm_connections: bool = os.getenv('PRE_WARM_CONNECTIONS', '1') == '1'  # Pre-warm RPC connections
    enable_timing_logs: bool = os.getenv('ENABLE_TIMING_LOGS', '1') == '1'  # Enable detailed timing logs
    max_monitor_time: int = int(os.getenv('MAX_MONITOR_TIME', '300'))  # Maximum monitoring time in seconds

class RaydiumWebSocketClient:
    """Main WebSocket client for Raydium pool monitoring and trading with immediate execution."""
    
    def __init__(self, config: TradeConfig, db_manager: Optional[DatabaseManager] = None):
        """Initialize WebSocket client with configuration and database manager."""
        self.config = config
        self.db_manager = db_manager
        self.ws = None
        self._trade_queue = asyncio.Queue()
        self._pending_pools = {}  # Track pools waiting for valid price
        self._active_monitors = {}  # Track actively monitored pools
        self._traded_pools = set()  # Track pools that have been traded
        self._monitor_tasks = {}  # Track monitoring tasks
        self._pool_locks = {}  # Track locks for pool operations
        self._pool_stats = {}  # Track statistics for each pool
        self._latency_stats = {
            'ready_to_trade': [],
            'total_latency': []
        }
        self._trade_timings = {}
        self.paper_trader = PaperTradingManager() if not config.live_trading else None
        self._stop_event = asyncio.Event()
        self._max_concurrent_monitors = 50  # Maximum number of pools to monitor simultaneously
        self._monitor_semaphore = asyncio.Semaphore(self._max_concurrent_monitors)  # Limit concurrent monitors
        self.sio = socketio.AsyncClient()
        self._register_event_handlers()
        
        # Initialize state tracking
        self._recent_pools = []
        self._pool_processing_tasks: Dict[str, asyncio.Task] = {}
        self._rpc_connection_pool = []
        self._thread_pool = ThreadPoolExecutor(max_workers=config.max_parallel_pools)
        self._trade_processor_task = None
        self._recent_pools: Deque[Dict[str, Any]] = deque(maxlen=100)  # Track recent pools for latency analysis
        self._latency_stats: Dict[str, List[float]] = {
            'detection_to_ready': [],
            'ready_to_trade': [],
            'total_latency': []
        }
        self._timing_stats: Dict[str, List[float]] = {
            'detection_to_qualify': [],
            'qualify_to_buy': [],
            'buy_execution': [],
            'sell_execution': [],
            'total_buy_latency': [],
            'total_sell_latency': []
        }
        
        # Initialize components
        self._initialize_socket()
        self._initialize_database()
        self._initialize_trading()
        self._initialize_rpc_pool()
        
        # Start trade processor and latency monitor
        self._trade_processor_task = asyncio.create_task(self._process_trade_queue())
        self._latency_monitor_task = asyncio.create_task(self._monitor_latency())
    
    def _initialize_socket(self):
        """Initialize Socket.IO client with proper error handling."""
        try:
            self.sio = socketio.AsyncClient(
                logger=True,
                engineio_logger=True,
                reconnection=True,
                reconnection_attempts=self.config.max_reconnection_attempts,
                reconnection_delay=self.config.reconnection_delay,
                reconnection_delay_max=self.config.reconnection_delay_max,
                randomization_factor=0.5
            )
            self._register_event_handlers()
        except Exception as e:
            logger.error(f"Failed to initialize Socket.IO client: {str(e)}")
            raise
    
    def _initialize_database(self):
        """Initialize database manager."""
        try:
            self.db_manager = DatabaseManager('trading_history.sqlite')
        except Exception as e:
            logger.error(f"Failed to initialize database: {str(e)}")
            raise
    
    def _initialize_trading(self):
        """Initialize trading components based on mode."""
        if self.config.live_trading:
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
    
    def _register_event_handlers(self):
        """Register all Socket.IO event handlers."""
        self.sio.on('connect', self._on_connect)
        self.sio.on('connect_error', self._on_connect_error)
        self.sio.on('disconnect', self._on_disconnect)
        self.sio.on(EVENT_TYPES['NEW_POOL'], self._on_new_pool)
        self.sio.on(EVENT_TYPES['POOL_READY'], self._on_pool_ready)
        self.sio.on(EVENT_TYPES['HEALTH'], self._on_health)
        self.sio.on(EVENT_TYPES['POOL_UPDATE'], self._on_pool_update)
    
    async def _process_trade_queue(self):
        """Process trades in the queue."""
        while True:
            try:
                # Get next trade from queue
                pool_id, trade_data = await self._trade_queue.get()
                
                # Skip if already traded
                if pool_id in self._traded_pools:
                    logger.info(f"Skipping already traded pool {pool_id}")
                    self._trade_queue.task_done()
                    continue
                
                # Record buy start time
                buy_start = datetime.now()
                
                # Execute trade with timing
                try:
                    if self.config.live_trading:
                        logger.info(f"Executing LIVE buy for pool {pool_id}...")
                        trade_result = await execute_buy(pool_id, self.config.initial_buy_amount)
                    else:
                        logger.info(f"Executing PAPER buy for pool {pool_id}...")
                        trade_result = self.paper_trader.execute_buy(
                            pool_id=pool_id,
                            base_mint=trade_data['base_mint'],
                            quote_mint=trade_data['quote_mint'],
                            price=trade_data.get('initial_price', 0.000001),  # Use mock price for paper trading
                            base_decimals=trade_data['base_decimals'],
                            quote_decimals=trade_data['quote_decimals'],
                            sol_amount=self.config.initial_buy_amount
                        )
                    
                    buy_end = datetime.now()
                    trade_data['buy_end_time'] = buy_end
                    
                    # Log buy timing
                    self._log_timing(pool_id, 'buy_execution', buy_start, buy_end)
                    if trade_data['qualification_time']:
                        self._log_timing(pool_id, 'qualify_to_buy', trade_data['qualification_time'], buy_end)
                    if trade_data['detection_time']:
                        self._log_timing(pool_id, 'total_buy_latency', trade_data['detection_time'], buy_end)
                    
                    # Calculate and record latencies
                    execution_time = datetime.now()
                    total_latency_ms = (execution_time - trade_data['detection_time']).total_seconds() * 1000
                    execution_latency_ms = (execution_time - buy_start).total_seconds() * 1000
                    
                    # Update latency statistics
                    self._latency_stats['ready_to_trade'].append(execution_latency_ms)
                    self._latency_stats['total_latency'].append(total_latency_ms)
                    
                    # Record trade and start monitoring
                    if trade_result['status'] == 'confirmed':
                        # Mark pool as traded
                        self._traded_pools.add(pool_id)
                        
                        # Update pool data with effective price
                        if pool_id in self._pending_pools:
                            self._pending_pools[pool_id]['initial_price'] = trade_result['price']
                            self._pending_pools[pool_id]['price_received'] = True
                        
                        # Record trade asynchronously
                        asyncio.create_task(self._record_trade(pool_id, trade_result, 'buy'))
                        
                        # Start monitoring the pool
                        await self._start_pool_monitoring(pool_id, trade_result['price'])
                        
                        # Log successful trade
                        logger.info(f"""
✅ TRADE EXECUTED SUCCESSFULLY

Pool: {pool_id}
Type: {'LIVE' if self.config.live_trading else 'PAPER'}
Price: {trade_result['price']:.9f}
Base Amount: {trade_result['base_amount']:.2f}
Quote Amount: {trade_result['quote_amount']:.6f} SOL

Timing:
-------
Execution Latency: {execution_latency_ms:.2f}ms
Total Latency: {total_latency_ms:.2f}ms
""")
                    else:
                        logger.error(f"❌ Buy trade failed for pool {pool_id}: {trade_result.get('error', 'Unknown error')}")
                    
                except Exception as e:
                    logger.error(f"Error executing trade for pool {pool_id}: {str(e)}")
                finally:
                    self._trade_queue.task_done()
                
            except Exception as e:
                logger.error(f"Error processing trade queue: {str(e)}")
                await asyncio.sleep(0.001)  # Minimal delay to prevent CPU spinning
    
    async def _on_new_pool(self, data: Dict[str, Any]):
        """Handle new pool discovery events with timing measurements."""
        try:
            detection_time = datetime.now()
            pool_id = data.get('poolId')
            if not pool_id:
                logger.error("❌ Received new pool event without pool ID")
                return
            
            # Convert server timestamp to naive datetime for comparison
            event_time = datetime.fromisoformat(data['timestamp'].replace('Z', '+00:00'))
            event_time = event_time.replace(tzinfo=None)  # Convert to naive datetime
            age_ms = (detection_time - event_time).total_seconds() * 1000
            
            if age_ms > self.config.max_pool_age_ms:
                logger.warning(f"⏰ Skipping old pool {pool_id} (age: {age_ms:.2f}ms)")
                return
            
            # Prepare pool data with timing information
            pool_data = {
                'pool_id': pool_id,
                'base_mint': data.get('baseMint'),
                'quote_mint': data.get('quoteMint'),
                'base_decimals': int(data.get('baseDecimals', 9)),
                'quote_decimals': int(data.get('quoteDecimals', 6)),
                'initial_price': float(data.get('initialPrice', 0.0)),
                'timestamp': int(event_time.timestamp() * 1000),
                'detection_time': detection_time,
                'qualification_time': None,
                'buy_start_time': None,
                'buy_end_time': None,
                'sell_start_time': None,
                'sell_end_time': None,
                'server_latency_ms': age_ms,
                'price_received': False  # Track if we've received a valid price
            }
            
            # Log pool discovery with custom formatting
            pool_message = f"""
🚨 NEW POOL DETECTED 🚨

Pool Details:
------------
ID: {pool_id}
Base Token: {pool_data['base_mint']} (decimals: {pool_data['base_decimals']})
Quote Token: {pool_data['quote_mint']} (decimals: {pool_data['quote_decimals']})
Initial Price: {pool_data['initial_price']}

Timing:
-------
Detection Time: {pool_data['detection_time'].strftime('%H:%M:%S.%f')[:-3]}
Server Latency: {pool_data['server_latency_ms']:.2f}ms
"""
            log_pool_event(pool_message)
            
            # Store pool in database (non-blocking)
            asyncio.create_task(self._store_pool_async(pool_data))
            
            # Add to recent pools for latency tracking
            self._recent_pools.append(pool_data)
            
            # Add to pending pools to wait for price
            self._pending_pools[pool_id] = pool_data
            
            # Start a task to monitor for price updates
            asyncio.create_task(self._wait_for_valid_price(pool_id))
            
        except Exception as e:
            error_message = f"""
❌ POOL PROCESSING ERROR

Error: {str(e)}
Event Data: {data}
"""
            log_pool_event(error_message, level='error')
    
    async def _store_pool_async(self, pool_data: Dict[str, Any]):
        """Store pool data in database asynchronously."""
        try:
            if not self.db_manager.store_pool(pool_data):
                logger.error(f"Failed to store pool {pool_data['pool_id']} in database")
        except Exception as e:
            logger.error(f"Error storing pool data: {str(e)}")
    
    async def _record_trade(self, pool_id: str, trade_result: Dict[str, Any], trade_type: str):
        """Record trade details in the database asynchronously."""
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
                    'base_amount': trade_result['base_amount'],
                    'quote_amount': trade_result['quote_amount'],
                    'status': 'open',
                    'opened_at': datetime.fromtimestamp(trade_result['timestamp'] / 1000).isoformat()
                }
                if not self.db_manager.store_position(position_data):
                    logger.error(f"Failed to store position for pool {pool_id}")
                    return
            
            # For sells, update position status
            if trade_type == 'sell':
                position_data = {
                    'pool_id': pool_id,
                    'exit_trade_id': trade_result['tx_signature'],
                    'exit_price': trade_result['price'],
                    'pnl': trade_result.get('pnl', 0.0),
                    'pnl_percentage': trade_result.get('pnl_percentage', 0.0),
                    'status': 'closed',
                    'closed_at': datetime.fromtimestamp(trade_result['timestamp'] / 1000).isoformat()
                }
                if not self.db_manager.update_position(position_data):
                    logger.error(f"Failed to update position for pool {pool_id}")
                    return
            
            logger.info(f"✅ Successfully recorded {trade_type} trade for pool {pool_id}")
            
        except Exception as e:
            logger.error(f"Error recording {trade_type} trade: {str(e)}")
    
    async def _on_health(self, data):
        """Handle health check events."""
        logger.info(f"Health check: {data}")
    
    async def _on_pool_update(self, data: Dict[str, Any]):
        """Handle pool updates with improved concurrency and error handling."""
        try:
            pool_id = data.get('pool_id')
            if not pool_id:
                return

            # Get pool lock before processing update
            async with await self._get_pool_lock(pool_id):
                current_price = float(data.get('price', 0))
                if current_price <= 0:
                    return

                # Update pool stats
                if pool_id in self._pool_stats:
                    stats = self._pool_stats[pool_id]
                    stats['last_price'] = current_price
                    stats['highest_price'] = max(stats['highest_price'], current_price)
                    stats['lowest_price'] = min(stats['lowest_price'], current_price)
                    stats['price_updates'] += 1
                    stats['last_update'] = datetime.now()

                # Format and log snapshot
                snapshot_msg = f"""
📊 POOL UPDATE
Pool: {pool_id}
Current Price: {current_price:.9f}
Price Change: {((current_price / stats['initial_price'] - 1) * 100):.2f}%
24h Volume: {data.get('volume_24h', 0):.2f} SOL
TVL: {data.get('tvl', 0):.2f} SOL
Base Reserve: {data.get('base_reserve', 0):.2f}
Quote Reserve: {data.get('quote_reserve', 0):.2f}
Active Monitors: {len(self._active_monitors)}/{self._max_concurrent_monitors}
Last Update: {datetime.now().strftime('%H:%M:%S')}
"""
                log_pool_event(pool_id, snapshot_msg)

                # Update initial price if needed
                if pool_id in self._pending_pools and not self._pending_pools[pool_id]['price_received']:
                    self._pending_pools[pool_id]['initial_price'] = current_price
                    self._pending_pools[pool_id]['price_received'] = True
                    if self.db_manager:
                        self.db_manager.update_pool_initial_price(pool_id, current_price)

                # Check exit conditions for active trades
                if pool_id in self._active_monitors:
                    await self._check_exit_conditions(pool_id, current_price)

                # Store snapshot
                if self.db_manager:
                    snapshot_data = {
                        'pool_id': pool_id,
                        'price': current_price,
                        'base_reserve': data.get('base_reserve', 0),
                        'quote_reserve': data.get('quote_reserve', 0),
                        'volume_24h': data.get('volume_24h', 0),
                        'tvl': data.get('tvl', 0),
                        'timestamp': int(datetime.now().timestamp() * 1000)
                    }
                    self.db_manager.store_pool_snapshot(snapshot_data)

        except Exception as e:
            logger.error(f"Error processing pool update for {pool_id}: {str(e)}")
    
    async def _on_pool_ready(self, data: Dict[str, Any]):
        """Handle pool ready events."""
        try:
            pool_id = data.get('poolId')
            if not pool_id:
                logger.error("Received pool ready event without pool ID")
                return
            
            if pool_id not in self._pending_pools:
                logger.warning(f"Received ready event for unknown pool {pool_id}")
                return
            
            pool_data = self._pending_pools[pool_id]
            ready_time = datetime.now()
            detection_time = datetime.fromisoformat(pool_data['detection_time'])
            latency_ms = (ready_time - detection_time).total_seconds() * 1000
            
            logger.info(f"\n{'='*50}")
            logger.info(f"✅ POOL READY FOR TRADING")
            logger.info(f"Pool ID: {pool_id}")
            logger.info(f"Detection to Ready Latency: {latency_ms:.2f}ms")
            logger.info(f"{'='*50}\n")
            
            # Queue trade immediately if enabled
            if self.config.immediate_trading:
                await self._trade_queue.put(pool_data)
                logger.info(f"Trade queued for pool {pool_id}")
            
            # Remove from pending pools
            del self._pending_pools[pool_id]
            
        except Exception as e:
            logger.error(f"Error processing pool ready event: {str(e)}")
            logger.error(f"Event data: {data}")
    
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
            # Cancel trade processor
            if self._trade_processor_task:
                self._trade_processor_task.cancel()
                try:
                    await self._trade_processor_task
                except asyncio.CancelledError:
                    pass
            
            # Clean up active monitors
            for pool_id, monitor_data in self._active_monitors.items():
                if 'task' in monitor_data and not monitor_data['task'].done():
                    monitor_data['task'].cancel()
                    try:
                        await monitor_data['task']
                    except asyncio.CancelledError:
                        pass
            self._active_monitors.clear()
            
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

    async def _initialize_rpc_pool(self):
        """Initialize and pre-warm RPC connections."""
        logger.info("Initializing RPC connection pool...")
        try:
            if self.config.pre_warm_connections:
                # Pre-warm connections in parallel
                tasks = []
                for _ in range(self.config.rpc_connection_pool_size):
                    tasks.append(self._create_rpc_connection())
                connections = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Filter out failed connections
                self._rpc_connection_pool = [
                    {'connection': conn, 'last_used': datetime.now(), 'in_use': False}
                    for conn in connections if not isinstance(conn, Exception)
                ]
                logger.info(f"Pre-warmed {len(self._rpc_connection_pool)} RPC connections")
            else:
                # Single connection for immediate use
                self._rpc_connection_pool = [{
                    'connection': None,
                    'last_used': datetime.now(),
                    'in_use': False
                }]
        except Exception as e:
            logger.error(f"Error initializing RPC pool: {str(e)}")
            # Fallback to single connection
            self._rpc_connection_pool = [{
                'connection': None,
                'last_used': datetime.now(),
                'in_use': False
            }]

    async def _create_rpc_connection(self):
        """Create a new RPC connection with timeout."""
        try:
            # Implement your RPC connection creation here
            # This is a placeholder - replace with actual connection logic
            return None
        except Exception as e:
            logger.error(f"Failed to create RPC connection: {str(e)}")
            raise

    async def _monitor_latency(self):
        """Monitor and log latency statistics."""
        while True:
            try:
                await asyncio.sleep(60)  # Log stats every minute
                
                # Calculate timing statistics
                stats = {}
                for metric, values in self._timing_stats.items():
                    if values:
                        avg = sum(values) / len(values)
                        p95 = sorted(values)[int(len(values) * 0.95)]
                        p99 = sorted(values)[int(len(values) * 0.99)]
                        stats[metric] = {
                            'avg_ms': round(avg, 2),
                            'p95_ms': round(p95, 2),
                            'p99_ms': round(p99, 2),
                            'min_ms': round(min(values), 2),
                            'max_ms': round(max(values), 2),
                            'count': len(values)
                        }
                
                # Log detailed timing statistics
                logger.info("\n⏱️ Timing Statistics (last minute):")
                for metric, data in stats.items():
                    logger.info(f"{metric}:")
                    logger.info(f"  Count: {data['count']}")
                    logger.info(f"  Average: {data['avg_ms']}ms")
                    logger.info(f"  95th percentile: {data['p95_ms']}ms")
                    logger.info(f"  99th percentile: {data['p99_ms']}ms")
                    logger.info(f"  Min: {data['min_ms']}ms")
                    logger.info(f"  Max: {data['max_ms']}ms")
                
                # Clear old stats
                for values in self._timing_stats.values():
                    values.clear()
                    
            except Exception as e:
                logger.error(f"Error in latency monitor: {str(e)}")
                await asyncio.sleep(5)

    async def _on_connect(self):
        """Handle successful connection."""
        logger.info("Connected to server")

    async def _on_connect_error(self, data):
        """Handle connection errors."""
        logger.error(f"Connection error: {data}")

    async def _on_disconnect(self):
        """Handle disconnection."""
        logger.info("Disconnected from server")

    async def _get_pool_lock(self, pool_id: str) -> asyncio.Lock:
        """Get or create a lock for a specific pool."""
        if pool_id not in self._pool_locks:
            self._pool_locks[pool_id] = asyncio.Lock()
        return self._pool_locks[pool_id]

    async def _start_pool_monitoring(self, pool_id: str, initial_price: float) -> None:
        """Start monitoring a pool with resource limits and error handling."""
        if pool_id in self._active_monitors:
            logger.warning(f"Pool {pool_id} is already being monitored")
            return

        try:
            # Acquire semaphore to limit concurrent monitors
            async with self._monitor_semaphore:
                # Get pool lock
                async with await self._get_pool_lock(pool_id):
                    # Initialize pool stats
                    self._pool_stats[pool_id] = {
                        'start_time': datetime.now(),
                        'initial_price': initial_price,
                        'last_price': initial_price,
                        'highest_price': initial_price,
                        'lowest_price': initial_price,
                        'price_updates': 0,
                        'last_update': datetime.now(),
                        'status': 'monitoring'
                    }

                    # Add to active monitors
                    self._active_monitors[pool_id] = {
                        'initial_price': initial_price,
                        'start_time': datetime.now(),
                        'last_update': datetime.now(),
                        'status': 'monitoring'
                    }

                    # Create monitoring task
                    self._monitor_tasks[pool_id] = asyncio.create_task(
                        self._monitor_pool(pool_id)
                    )

                    logger.info(f"""
🎯 STARTED MONITORING POOL
Pool: {pool_id}
Initial Price: {initial_price:.9f}
Active Monitors: {len(self._active_monitors)}/{self._max_concurrent_monitors}
""")

        except Exception as e:
            logger.error(f"Error starting pool monitoring for {pool_id}: {str(e)}")
            await self._stop_pool_monitoring(pool_id)

    async def _stop_pool_monitoring(self, pool_id: str) -> None:
        """Stop monitoring a pool and clean up resources."""
        try:
            async with await self._get_pool_lock(pool_id):
                # Cancel monitoring task
                if pool_id in self._monitor_tasks:
                    self._monitor_tasks[pool_id].cancel()
                    del self._monitor_tasks[pool_id]

                # Remove from active monitors
                if pool_id in self._active_monitors:
                    del self._active_monitors[pool_id]

                # Clean up pool stats
                if pool_id in self._pool_stats:
                    del self._pool_stats[pool_id]

                # Clean up pool lock
                if pool_id in self._pool_locks:
                    del self._pool_locks[pool_id]

                logger.info(f"""
🛑 STOPPED MONITORING POOL
Pool: {pool_id}
Active Monitors: {len(self._active_monitors)}/{self._max_concurrent_monitors}
""")

        except Exception as e:
            logger.error(f"Error stopping pool monitoring for {pool_id}: {str(e)}")

    async def _monitor_pool(self, pool_id: str) -> None:
        """Monitor a pool for exit conditions with improved error handling."""
        try:
            while not self._stop_event.is_set():
                if pool_id not in self._active_monitors:
                    break

                async with await self._get_pool_lock(pool_id):
                    pool_data = self._active_monitors[pool_id]
                    current_time = datetime.now()

                    # Check if monitoring time exceeded
                    if (current_time - pool_data['start_time']).total_seconds() > self.config.max_monitor_time:
                        logger.info(f"Monitoring time exceeded for pool {pool_id}")
                        await self._stop_pool_monitoring(pool_id)
                        break

                    # Update pool stats
                    if pool_id in self._pool_stats:
                        stats = self._pool_stats[pool_id]
                        stats['last_update'] = current_time

                    await asyncio.sleep(1)  # Check every second

        except asyncio.CancelledError:
            logger.info(f"Monitoring task cancelled for pool {pool_id}")
        except Exception as e:
            logger.error(f"Error in monitor task for pool {pool_id}: {str(e)}")
        finally:
            await self._stop_pool_monitoring(pool_id)

    async def _check_exit_conditions(self, pool_id: str, current_price: float) -> None:
        """Check exit conditions for a pool and execute sell if necessary."""
        try:
            pool_data = self._active_monitors[pool_id]
            entry_price = pool_data['initial_price']
            price_change = ((current_price - entry_price) / entry_price) * 100
            
            # Log price change for monitored pools
            logger.info(f"Pool {pool_id} price change: {price_change:.2f}% (Entry: {entry_price:.9f}, Current: {current_price:.9f})")
            
            # Check exit conditions
            if price_change >= self.config.exit_profit_threshold:
                logger.info(f"🎯 Profit target reached for pool {pool_id} ({price_change:.2f}%)")
                await self._execute_sell(pool_id, current_price)
            elif price_change <= self.config.stop_loss_threshold:
                logger.info(f"🛑 Stop loss triggered for pool {pool_id} ({price_change:.2f}%)")
                await self._execute_sell(pool_id, current_price)
            
        except Exception as e:
            logger.error(f"Error checking exit conditions for pool {pool_id}: {str(e)}")

    async def _execute_sell(self, pool_id: str, current_price: float) -> Dict[str, Any]:
        """Execute a sell trade with timing measurements."""
        try:
            sell_start = datetime.now()
            
            if self.config.live_trading:
                logger.info(f"Executing LIVE sell for pool {pool_id}...")
                trade_result = await execute_sell(pool_id, current_price)
            else:
                logger.info(f"Executing PAPER sell for pool {pool_id}...")
                trade_result = self.paper_trader.execute_sell(
                    pool_id=pool_id,
                    current_price=current_price
                )
            
            sell_end = datetime.now()
            
            # Log sell timing
            self._log_timing(pool_id, 'sell_execution', sell_start, sell_end)
            
            if pool_id in self._trade_timings and 'buy_end_time' in self._trade_timings[pool_id]:
                buy_end_time = self._trade_timings[pool_id]['buy_end_time']
                self._log_timing(pool_id, 'total_sell_latency', buy_end_time, sell_end)
            
            if trade_result['status'] == 'confirmed':
                # Record trade asynchronously
                asyncio.create_task(self._record_trade(pool_id, trade_result, 'sell'))
                
                # Remove from active monitors
                if pool_id in self._active_monitors:
                    del self._active_monitors[pool_id]
                
                # Log successful sell
                logger.info(f"""
💰 POSITION CLOSED

Pool: {pool_id}
Type: {'LIVE' if self.config.live_trading else 'PAPER'}
Exit Price: {current_price:.9f}
PnL: {trade_result.get('pnl', 0):.6f} SOL
PnL %: {trade_result.get('pnl_percentage', 0):.2f}%

Timing:
-------
Sell Execution: {(sell_end - sell_start).total_seconds() * 1000:.2f}ms
""")
            else:
                logger.error(f"❌ Sell trade failed for pool {pool_id}: {trade_result.get('error', 'Unknown error')}")
            
            return trade_result
            
        except Exception as e:
            logger.error(f"Error executing sell for pool {pool_id}: {str(e)}")
            return {
                'status': 'failed',
                'error': str(e),
                'pool_id': pool_id,
                'timestamp': int(datetime.now().timestamp() * 1000)
            }

    def _log_timing(self, pool_id: str, stage: str, start_time: datetime, end_time: datetime = None):
        """Log timing information for a specific stage."""
        if not self.config.enable_timing_logs:
            return
            
        if end_time is None:
            end_time = datetime.now()
            
        latency_ms = (end_time - start_time).total_seconds() * 1000
        
        if pool_id not in self._trade_timings:
            self._trade_timings[pool_id] = {}
            
        self._trade_timings[pool_id][stage] = latency_ms
        
        # Update statistics
        if stage in self._timing_stats:
            self._timing_stats[stage].append(latency_ms)
            
        timing_message = f"""
⏱️ TIMING UPDATE

Pool: {pool_id}
Stage: {stage}
Latency: {latency_ms:.2f}ms
"""
        log_trade_event(timing_message)

    async def _wait_for_valid_price(self, pool_id: str):
        """Wait for a valid price update before queuing trade."""
        try:
            start_time = datetime.now()
            timeout = 30  # Wait up to 30 seconds for a valid price
            
            while (datetime.now() - start_time).total_seconds() < timeout:
                if pool_id not in self._pending_pools:
                    return  # Pool was removed
                
                pool_data = self._pending_pools[pool_id]
                if pool_data.get('price_received', False):
                    # We got a valid price, queue the trade
                    qualification_time = datetime.now()
                    pool_data['qualification_time'] = qualification_time
                    self._log_timing(pool_id, 'detection_to_qualify', pool_data['detection_time'], qualification_time)
                    
                    try:
                        await self._trade_queue.put(pool_data)
                        queue_time = datetime.now()
                        self._log_timing(pool_id, 'qualify_to_queue', qualification_time, queue_time)
                        
                        trade_message = f"""
💫 TRADE QUEUED

Pool: {pool_id}
Queue Latency: {(queue_time - pool_data['detection_time']).total_seconds() * 1000:.2f}ms
"""
                        log_trade_event(trade_message)
                        
                    except Exception as e:
                        error_message = f"""
❌ TRADE QUEUE ERROR

Pool: {pool_id}
Error: {str(e)}
"""
                        log_trade_event(error_message, level='error')
                    
                    # Remove from pending pools
                    del self._pending_pools[pool_id]
                    return
                
                await asyncio.sleep(0.1)  # Check every 100ms
            
            # If we timeout, log a warning
            logger.warning(f"Timeout waiting for valid price for pool {pool_id}")
            if pool_id in self._pending_pools:
                del self._pending_pools[pool_id]
            
        except Exception as e:
            logger.error(f"Error waiting for valid price for pool {pool_id}: {str(e)}")
            if pool_id in self._pending_pools:
                del self._pending_pools[pool_id]

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