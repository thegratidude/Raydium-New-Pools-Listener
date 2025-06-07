"""
Paper trading manager for simulating trades without using real funds.
"""

import json
import os
from datetime import datetime
from typing import Dict, Any, Optional, List
import logging
from decimal import Decimal

logger = logging.getLogger(__name__)

class PaperTradingManager:
    def __init__(self, portfolio_file: str = 'paper_portfolio.json', 
                 strategies_file: str = 'exit_strategies.json'):
        """Initialize paper trading manager with portfolio and strategies files."""
        self.portfolio_file = portfolio_file
        self.strategies_file = strategies_file
        self.initial_balance = Decimal('10.0')  # Start with 10 SOL
        self.portfolio = self._load_portfolio()
        self.strategies = self._load_strategies()
        self.position_updates = {}  # Track consecutive updates for each position
    
    def _load_strategies(self) -> Dict[str, Any]:
        """Load exit strategies from JSON file."""
        if os.path.exists(self.strategies_file):
            try:
                with open(self.strategies_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error loading strategies file: {str(e)}")
        
        # Return default strategies if file doesn't exist
        return {
            "strategies": {},
            "active_strategies": []
        }
    
    def _load_portfolio(self) -> Dict[str, Any]:
        """Load portfolio from JSON file or create new one."""
        if os.path.exists(self.portfolio_file):
            try:
                with open(self.portfolio_file, 'r') as f:
                    data = json.load(f)
                    # Convert string numbers to Decimal for precise calculations
                    data['balance'] = Decimal(str(data['balance']))
                    for position in data['positions'].values():
                        position['entry_price'] = Decimal(str(position['entry_price']))
                        position['base_amount'] = Decimal(str(position['base_amount']))
                        position['quote_amount'] = Decimal(str(position['quote_amount']))
                    return data
            except Exception as e:
                logger.error(f"Error loading portfolio file: {str(e)}")
        
        # Create new portfolio
        return {
            'balance': self.initial_balance,
            'positions': {},
            'trades': [],
            'last_update': int(datetime.now().timestamp() * 1000)
        }
    
    def _save_portfolio(self):
        """Save portfolio to JSON file."""
        try:
            # Convert Decimal to string for JSON serialization
            data = self.portfolio.copy()
            data['balance'] = str(data['balance'])
            for position in data['positions'].values():
                position['entry_price'] = str(position['entry_price'])
                position['base_amount'] = str(position['base_amount'])
                position['quote_amount'] = str(position['quote_amount'])
            
            with open(self.portfolio_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving portfolio file: {str(e)}")
    
    def execute_buy(self, pool_id: str, base_mint: str, quote_mint: str, 
                   price: float, base_decimals: int, quote_decimals: int,
                   sol_amount: float) -> Dict[str, Any]:
        """
        Execute a simulated buy trade.
        
        Args:
            pool_id: Pool address
            base_mint: Base token mint address
            quote_mint: Quote token mint address
            price: Current price of base token in SOL
            base_decimals: Base token decimals
            quote_decimals: Quote token decimals
            sol_amount: Amount of SOL to spend
            
        Returns:
            Dict containing trade details
        """
        try:
            # Convert to Decimal for precise calculations
            sol_amount = Decimal(str(sol_amount))
            price = Decimal(str(price))
            
            # Check if we have enough balance
            if sol_amount > self.portfolio['balance']:
                raise ValueError(f"Insufficient balance. Required: {sol_amount} SOL, Available: {self.portfolio['balance']} SOL")
            
            # Calculate base token amount
            base_amount = (sol_amount / price).quantize(Decimal('0.000000001'))  # Round to 9 decimals
            
            # Generate simulated transaction signature
            tx_signature = f"paper_tx_{int(datetime.now().timestamp() * 1000)}"
            
            # Create trade record
            trade = {
                'tx_signature': tx_signature,
                'pool_id': pool_id,
                'trade_type': 'buy',
                'base_amount': float(base_amount),
                'quote_amount': float(sol_amount),
                'price': float(price),
                'timestamp': int(datetime.now().timestamp() * 1000),
                'status': 'confirmed'
            }
            
            # Update portfolio
            self.portfolio['balance'] -= sol_amount
            self.portfolio['trades'].append(trade)
            
            # Create or update position
            position = {
                'pool_id': pool_id,
                'base_mint': base_mint,
                'quote_mint': quote_mint,
                'base_decimals': base_decimals,
                'quote_decimals': quote_decimals,
                'entry_trade_id': tx_signature,
                'entry_price': price,
                'base_amount': base_amount,
                'quote_amount': sol_amount,
                'entry_timestamp': trade['timestamp'],
                'status': 'open',
                'last_price': price,  # Track last known price
                'consecutive_profit_updates': 0  # Track consecutive profitable updates
            }
            self.portfolio['positions'][pool_id] = position
            
            # Initialize position updates tracking
            self.position_updates[pool_id] = {
                'consecutive_profit_updates': 0,
                'last_update_time': trade['timestamp']
            }
            
            # Update last update timestamp
            self.portfolio['last_update'] = trade['timestamp']
            
            # Save portfolio
            self._save_portfolio()
            
            logger.info(f"Paper trade executed: {base_amount} tokens for {sol_amount} SOL")
            return trade
            
        except Exception as e:
            logger.error(f"Error executing paper trade: {str(e)}")
            return {
                'tx_signature': None,
                'pool_id': pool_id,
                'base_amount': 0,
                'quote_amount': float(sol_amount),
                'price': float(price),
                'timestamp': int(datetime.now().timestamp() * 1000),
                'status': 'failed',
                'error': str(e)
            }
    
    def execute_sell(self, pool_id: str, price: float, percentage: float = 1.0) -> Optional[Dict[str, Any]]:
        """Execute a simulated sell trade."""
        try:
            position = self.portfolio['positions'].get(pool_id)
            if not position or position['status'] != 'open':
                logger.warning(f"No open position found for pool {pool_id}")
                return None
            
            # Convert to Decimal for precise calculations
            price = Decimal(str(price))
            percentage = Decimal(str(percentage))
            base_amount = position['base_amount'] * percentage
            quote_amount = (base_amount * price).quantize(Decimal('0.000000001'))
            
            # Generate simulated transaction signature
            tx_signature = f"paper_tx_{int(datetime.now().timestamp() * 1000)}"
            
            # Create trade record
            trade = {
                'tx_signature': tx_signature,
                'pool_id': pool_id,
                'trade_type': 'sell',
                'base_amount': float(base_amount),
                'quote_amount': float(quote_amount),
                'price': float(price),
                'timestamp': int(datetime.now().timestamp() * 1000),
                'status': 'confirmed'
            }
            
            # Update portfolio
            self.portfolio['balance'] += quote_amount
            self.portfolio['trades'].append(trade)
            
            # Update position
            if percentage == Decimal('1.0'):
                position['status'] = 'closed'
                position['exit_trade_id'] = tx_signature
                position['exit_price'] = price
                position['exit_timestamp'] = trade['timestamp']
                position['pnl'] = float(quote_amount - position['quote_amount'])
                # Remove from active positions
                del self.portfolio['positions'][pool_id]
                del self.position_updates[pool_id]
            else:
                position['base_amount'] -= base_amount
                position['quote_amount'] = position['quote_amount'] * (Decimal('1.0') - percentage)
            
            # Update last update timestamp
            self.portfolio['last_update'] = trade['timestamp']
            
            # Save portfolio
            self._save_portfolio()
            
            logger.info(f"Paper sell executed: {base_amount} tokens for {quote_amount} SOL")
            return trade
            
        except Exception as e:
            logger.error(f"Error executing paper sell: {str(e)}")
            return None
    
    def update_position_price(self, pool_id: str, current_price: float) -> Optional[Dict[str, Any]]:
        """Update position price and check exit strategies."""
        try:
            position = self.portfolio['positions'].get(pool_id)
            if not position or position['status'] != 'open':
                return None
            
            # Convert to Decimal for precise calculations
            current_price = Decimal(str(current_price))
            entry_price = position['entry_price']
            
            # Calculate profit percentage
            profit_pct = (current_price - entry_price) / entry_price
            
            # Check stop loss (sell 100% if price drops > 10% from entry)
            if profit_pct <= Decimal('-0.10'):  # -10% threshold
                logger.info(f"Stop loss triggered for pool {pool_id}: Price dropped {float(profit_pct * 100):.2f}% from entry")
                return self.execute_sell(pool_id, float(current_price), 1.0)  # Sell 100%
            
            # Update position tracking
            updates = self.position_updates[pool_id]
            if profit_pct >= Decimal('0.10'):  # 10% profit threshold
                updates['consecutive_profit_updates'] += 1
            else:
                updates['consecutive_profit_updates'] = 0
            
            # Update position
            position['last_price'] = current_price
            
            # Check other exit strategies
            for strategy_id in self.strategies['active_strategies']:
                strategy = self.strategies['strategies'].get(strategy_id)
                if not strategy or not strategy['enabled']:
                    continue
                
                if strategy['type'] == 'profit_based':
                    params = strategy['parameters']
                    if (updates['consecutive_profit_updates'] >= params['consecutive_updates'] and 
                        profit_pct >= Decimal(str(params['profit_threshold']))):
                        logger.info(f"Exit strategy {strategy_id} triggered for pool {pool_id}")
                        return self.execute_sell(pool_id, float(current_price), params['sell_percentage'])
            
            # Save updates
            self._save_portfolio()
            return None
            
        except Exception as e:
            logger.error(f"Error updating position price: {str(e)}")
            return None
    
    def get_portfolio_summary(self) -> Dict[str, Any]:
        """Get summary of current portfolio status."""
        try:
            total_value = self.portfolio['balance']
            open_positions = len(self.portfolio['positions'])
            total_trades = len(self.portfolio['trades'])
            
            # Calculate unrealized P&L
            unrealized_pnl = Decimal('0')
            for position in self.portfolio['positions'].values():
                if position['status'] == 'open' and 'last_price' in position:
                    current_value = position['base_amount'] * Decimal(str(position['last_price']))
                    unrealized_pnl += current_value - position['quote_amount']
            
            return {
                'balance': float(self.portfolio['balance']),
                'open_positions': open_positions,
                'total_trades': total_trades,
                'unrealized_pnl': float(unrealized_pnl),
                'last_update': self.portfolio['last_update']
            }
        except Exception as e:
            logger.error(f"Error getting portfolio summary: {str(e)}")
            return {
                'balance': 0.0,
                'open_positions': 0,
                'total_trades': 0,
                'unrealized_pnl': 0.0,
                'last_update': 0
            }
    
    def get_position(self, pool_id: str) -> Optional[Dict[str, Any]]:
        """Get details of a specific position."""
        position = self.portfolio['positions'].get(pool_id)
        if position:
            # Convert Decimal to float for JSON serialization
            return {
                **position,
                'entry_price': float(position['entry_price']),
                'base_amount': float(position['base_amount']),
                'quote_amount': float(position['quote_amount']),
                'last_price': float(position.get('last_price', position['entry_price'])),
                'profit_pct': float((position.get('last_price', position['entry_price']) - position['entry_price']) / position['entry_price'] * 100)
            }
        return None 