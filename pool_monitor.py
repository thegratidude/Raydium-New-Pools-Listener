"""
Pool monitor for tracking and trading new Raydium pools.
"""

import logging
import time
import os
from datetime import datetime
from decimal import Decimal
from typing import Dict, Any, Optional, List
import asyncio
from solana.rpc.async_api import AsyncClient
from db_manager import DatabaseManager
from paper_trading import PaperTradingManager
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Trading constants from environment variables
MIN_LIQUIDITY_SOL = Decimal(os.getenv('MIN_LIQUIDITY', '0.5'))
MIN_PRICE = Decimal('0.000000001')  # Minimum price to prevent zero-price trades
MAX_PRICE_IMPACT = Decimal(os.getenv('MAX_PRICE_IMPACT', '0.05'))
TRADE_AMOUNT_SOL = Decimal(os.getenv('INITIAL_BUY', '0.005'))
MONITOR_INTERVAL = int(os.getenv('MONITOR_INTERVAL', '1'))  # seconds
PRICE_CHECK_INTERVAL = int(os.getenv('PRICE_CHECK_INTERVAL', '5'))  # seconds
MAX_MONITOR_TIME = int(os.getenv('MAX_MONITOR_TIME', '3600'))  # 1 hour in seconds
PROFIT_THRESHOLD = Decimal(os.getenv('EXIT_PROFIT_THRESHOLD', '0.1'))
STOP_LOSS_THRESHOLD = Decimal(os.getenv('STOP_LOSS_THRESHOLD', '-0.1'))

logger = logging.getLogger(__name__)

class PoolMonitor:
    def __init__(self, db_manager: DatabaseManager, paper_trading: PaperTradingManager,
                 rpc_client: AsyncClient):
        """Initialize pool monitor with database and trading managers."""
        self.db = db_manager
        self.paper_trading = paper_trading
        self.rpc_client = rpc_client
        self.active_pools: Dict[str, Dict[str, Any]] = {}
        self.monitor_tasks: Dict[str, asyncio.Task] = {}
        self.stop_event = asyncio.Event()

    async def start_monitoring(self, pool_id: str, pool_data: Dict[str, Any]) -> None:
        """Start monitoring a new pool."""
        if pool_id in self.active_pools:
            logger.warning(f"Pool {pool_id} is already being monitored")
            return

        try:
            # Validate pool data
            if not self._validate_pool_data(pool_id, pool_data):
                logger.error(f"Invalid pool data for {pool_id}")
                return

            # Store pool in database
            if not await self._store_pool(pool_id, pool_data):
                logger.error(f"Failed to store pool {pool_id} in database")
                return

            # Add to active pools
            self.active_pools[pool_id] = {
                'data': pool_data,
                'start_time': int(time.time() * 1000),
                'last_price_check': int(time.time() * 1000),
                'consecutive_profit_updates': 0,
                'status': 'monitoring'
            }

            # Start monitoring task
            self.monitor_tasks[pool_id] = asyncio.create_task(
                self._monitor_pool(pool_id)
            )

            logger.info(f"Started monitoring pool {pool_id}")
            logger.info(f"Base Token: {pool_data['base_mint']}")
            logger.info(f"Quote Token: {pool_data['quote_mint']}")
            logger.info(f"Initial Price: {pool_data['price']}")

        except Exception as e:
            logger.error(f"Error starting pool monitoring: {e}")
            if pool_id in self.active_pools:
                del self.active_pools[pool_id]

    def _validate_pool_data(self, pool_id: str, pool_data: Dict[str, Any]) -> bool:
        """Validate pool data before monitoring."""
        try:
            required_fields = ['base_mint', 'quote_mint', 'price', 'liquidity', 'timestamp']
            if not all(field in pool_data for field in required_fields):
                logger.error(f"Missing required fields in pool data for {pool_id}")
                return False

            # Convert to Decimal for validation
            price = Decimal(str(pool_data['price']))
            liquidity = Decimal(str(pool_data['liquidity']))

            if price <= 0:
                logger.warning(f"Invalid price ({price}) for pool {pool_id}")
                return False

            if liquidity < MIN_LIQUIDITY_SOL:
                logger.warning(f"Insufficient liquidity ({liquidity} SOL) for pool {pool_id}")
                return False

            return True

        except Exception as e:
            logger.error(f"Error validating pool data: {e}")
            return False

    async def _store_pool(self, pool_id: str, pool_data: Dict[str, Any]) -> bool:
        """Store pool data in database."""
        try:
            # Convert numeric values to proper types
            data = {
                'pool_id': pool_id,
                'base_mint': pool_data['base_mint'],
                'quote_mint': pool_data['quote_mint'],
                'price': float(pool_data['price']),
                'liquidity': float(pool_data['liquidity']),
                'discovery_timestamp': pool_data['timestamp'],
                'status': 'active'
            }
            
            return await self.db.store_pool(data)

        except Exception as e:
            logger.error(f"Error storing pool data: {e}")
            return False

    async def _monitor_pool(self, pool_id: str) -> None:
        """Monitor pool for trading opportunities."""
        try:
            pool_info = self.active_pools[pool_id]
            start_time = pool_info['start_time']
            
            while not self.stop_event.is_set():
                current_time = int(time.time() * 1000)
                
                # Check if monitoring time exceeded
                if current_time - start_time > MAX_MONITOR_TIME:
                    logger.info(f"Monitoring time exceeded for pool {pool_id}")
                    await self._stop_monitoring(pool_id)
                    break

                # Check if it's time for price check
                if current_time - pool_info['last_price_check'] >= PRICE_CHECK_INTERVAL:
                    await self._check_pool_price(pool_id)
                    pool_info['last_price_check'] = current_time

                # Check if we should enter a position
                if pool_info['status'] == 'monitoring':
                    await self._check_entry_conditions(pool_id)

                # Check if we should exit a position
                elif pool_info['status'] == 'trading':
                    await self._check_exit_conditions(pool_id)

                await asyncio.sleep(MONITOR_INTERVAL)

        except Exception as e:
            logger.error(f"Error monitoring pool {pool_id}: {e}")
            await self._stop_monitoring(pool_id)

    async def _check_pool_price(self, pool_id: str) -> None:
        """Check current pool price and update status."""
        try:
            pool_info = self.active_pools[pool_id]
            current_price = await self._get_current_price(pool_id)
            
            if current_price is None:
                logger.warning(f"Could not get current price for pool {pool_id}")
                return

            # Convert to Decimal for calculations
            current_price = Decimal(str(current_price))
            entry_price = Decimal(str(pool_info.get('entry_price', current_price)))
            
            # Calculate profit percentage
            profit_pct = (current_price - entry_price) / entry_price
            
            # Update consecutive profit updates
            if profit_pct >= PROFIT_THRESHOLD:
                pool_info['consecutive_profit_updates'] += 1
            else:
                pool_info['consecutive_profit_updates'] = 0

            # Update pool info
            pool_info['current_price'] = float(current_price)
            pool_info['profit_pct'] = float(profit_pct)

            # Log price update
            logger.info(f"Pool {pool_id} price update:")
            logger.info(f"Current Price: {current_price}")
            logger.info(f"Profit: {float(profit_pct * 100):.2f}%")
            logger.info(f"Consecutive Profit Updates: {pool_info['consecutive_profit_updates']}")

        except Exception as e:
            logger.error(f"Error checking pool price: {e}")

    async def _check_entry_conditions(self, pool_id: str) -> None:
        """Check if we should enter a position."""
        try:
            pool_info = self.active_pools[pool_id]
            current_price = Decimal(str(pool_info['current_price']))
            
            # Check if price is stable
            if pool_info['consecutive_profit_updates'] >= 3:  # 3 consecutive profitable updates
                # Execute buy
                trade_result = await self._execute_buy(pool_id, current_price)
                if trade_result and trade_result['status'] == 'confirmed':
                    pool_info['status'] = 'trading'
                    pool_info['entry_price'] = float(current_price)
                    pool_info['entry_timestamp'] = trade_result['timestamp']
                    logger.info(f"Entered position for pool {pool_id}")
                    logger.info(f"Entry Price: {current_price}")
                    logger.info(f"Amount: {trade_result['base_amount']}")

        except Exception as e:
            logger.error(f"Error checking entry conditions: {e}")

    async def _check_exit_conditions(self, pool_id: str) -> None:
        """Check if we should exit a position."""
        try:
            pool_info = self.active_pools[pool_id]
            current_price = Decimal(str(pool_info['current_price']))
            entry_price = Decimal(str(pool_info['entry_price']))
            
            # Calculate profit percentage
            profit_pct = (current_price - entry_price) / entry_price
            
            # Check stop loss
            if profit_pct <= STOP_LOSS_THRESHOLD:
                logger.info(f"Stop loss triggered for pool {pool_id}")
                await self._execute_sell(pool_id, current_price)
                return

            # Check take profit
            if profit_pct >= PROFIT_THRESHOLD and pool_info['consecutive_profit_updates'] >= 3:
                logger.info(f"Take profit triggered for pool {pool_id}")
                await self._execute_sell(pool_id, current_price)
                return

        except Exception as e:
            logger.error(f"Error checking exit conditions: {e}")

    async def _execute_buy(self, pool_id: str, price: Decimal) -> Optional[Dict[str, Any]]:
        """Execute a buy trade."""
        try:
            pool_info = self.active_pools[pool_id]
            pool_data = pool_info['data']
            
            # Execute paper trade
            trade_result = self.paper_trading.execute_buy(
                pool_id=pool_id,
                base_mint=pool_data['base_mint'],
                quote_mint=pool_data['quote_mint'],
                price=price,
                base_decimals=pool_data.get('base_decimals', 9),
                quote_decimals=pool_data.get('quote_decimals', 9),
                sol_amount=Decimal(str(TRADE_AMOUNT_SOL))
            )
            
            if trade_result['status'] == 'confirmed':
                # Store trade in database
                await self.db.store_trade({
                    'pool_id': pool_id,
                    'trade_type': 'buy',
                    'price': float(price),
                    'base_amount': trade_result['base_amount'],
                    'quote_amount': trade_result['quote_amount'],
                    'timestamp': trade_result['timestamp'],
                    'tx_signature': trade_result['tx_signature']
                })
                
                # Store position
                await self.db.store_position({
                    'pool_id': pool_id,
                    'entry_price': float(price),
                    'entry_amount': trade_result['base_amount'],
                    'entry_timestamp': trade_result['timestamp'],
                    'status': 'open'
                })
            
            return trade_result

        except Exception as e:
            logger.error(f"Error executing buy for pool {pool_id}: {e}")
            return None

    async def _execute_sell(self, pool_id: str, price: Decimal) -> Optional[Dict[str, Any]]:
        """Execute a sell trade."""
        try:
            # Execute paper trade
            trade_result = self.paper_trading.execute_sell(pool_id, price)
            
            if trade_result['status'] == 'confirmed':
                # Store trade in database
                await self.db.store_trade({
                    'pool_id': pool_id,
                    'trade_type': 'sell',
                    'price': float(price),
                    'base_amount': trade_result['base_amount'],
                    'quote_amount': trade_result['quote_amount'],
                    'pnl': trade_result['pnl'],
                    'timestamp': trade_result['timestamp'],
                    'tx_signature': trade_result['tx_signature']
                })
                
                # Update position status
                await self.db.update_position_status(pool_id, 'closed')
                
                # Stop monitoring
                await self._stop_monitoring(pool_id)
            
            return trade_result

        except Exception as e:
            logger.error(f"Error executing sell for pool {pool_id}: {e}")
            return None

    async def _get_current_price(self, pool_id: str) -> Optional[Decimal]:
        """Get current pool price from RPC."""
        try:
            # TODO: Implement actual price fetching from RPC
            # For now, return the last known price
            pool_info = self.active_pools[pool_id]
            return Decimal(str(pool_info.get('current_price', pool_info['data']['price'])))

        except Exception as e:
            logger.error(f"Error getting current price for pool {pool_id}: {e}")
            return None

    async def _stop_monitoring(self, pool_id: str) -> None:
        """Stop monitoring a pool."""
        try:
            if pool_id in self.monitor_tasks:
                self.monitor_tasks[pool_id].cancel()
                del self.monitor_tasks[pool_id]
            
            if pool_id in self.active_pools:
                del self.active_pools[pool_id]
            
            logger.info(f"Stopped monitoring pool {pool_id}")

        except Exception as e:
            logger.error(f"Error stopping pool monitoring: {e}")

    async def stop_all(self) -> None:
        """Stop monitoring all pools."""
        self.stop_event.set()
        for pool_id in list(self.active_pools.keys()):
            await self._stop_monitoring(pool_id)
        logger.info("Stopped monitoring all pools") 