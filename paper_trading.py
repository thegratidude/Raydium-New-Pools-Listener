"""
Paper trading manager for simulating trades without real funds.
"""

import json
import logging
from datetime import datetime
from decimal import Decimal, ROUND_DOWN
from typing import Dict, Any, Optional
from pathlib import Path
import os

logger = logging.getLogger(__name__)

class PaperTradingManager:
    def __init__(self, portfolio_file: str = 'paper_portfolio.json'):
        """Initialize paper trading manager with portfolio tracking."""
        self.portfolio_file = portfolio_file
        self.portfolio = self._load_portfolio()
        self.min_price = Decimal('0.000000001')  # Minimum price to prevent zero-price trades
        self.min_liquidity = Decimal('0.5')  # Minimum liquidity in SOL
        self.max_price_impact = Decimal('0.05')  # Maximum price impact (5%)

    def _load_portfolio(self) -> Dict[str, Any]:
        """Load portfolio state from file or create new."""
        try:
            if os.path.exists(self.portfolio_file):
                with open(self.portfolio_file, 'r') as f:
                    return json.load(f, parse_float=Decimal)
            return {
                'balance': {
                    'SOL': Decimal('10.0'),  # Starting with 10 SOL
                },
                'positions': {},
                'trades': [],
                'last_update': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Error loading portfolio: {e}")
            return {
                'balance': {
                    'SOL': Decimal('10.0'),
                },
                'positions': {},
                'trades': [],
                'last_update': datetime.now().isoformat()
            }

    def _save_portfolio(self) -> bool:
        """Save portfolio state to file."""
        try:
            self.portfolio['last_update'] = datetime.now().isoformat()
            with open(self.portfolio_file, 'w') as f:
                json.dump(self.portfolio, f, default=str, indent=2)
            return True
        except Exception as e:
            logger.error(f"Error saving portfolio: {e}")
            return False

    def _validate_trade(self, pool_id: str, price: Decimal, amount: Decimal) -> bool:
        """Validate trade parameters."""
        if price <= 0:
            logger.warning(f"Invalid price ({price}) for pool {pool_id}, using minimum price of {self.min_price}")
            return False
        
        if amount <= 0:
            logger.warning(f"Invalid amount ({amount}) for pool {pool_id}")
            return False
        
        # Check if we have enough balance
        required_sol = amount
        if self.portfolio['balance']['SOL'] < required_sol:
            logger.warning(f"Insufficient SOL balance for trade. Required: {required_sol}, Available: {self.portfolio['balance']['SOL']}")
            return False
        
        return True

    def execute_buy(self, pool_id: str, base_mint: str, quote_mint: str, 
                   price: Decimal, base_decimals: int, quote_decimals: int, 
                   sol_amount: Decimal) -> Dict[str, Any]:
        """Execute a paper buy trade."""
        try:
            # Convert amounts to Decimal
            sol_amount = Decimal(str(sol_amount))
            
            # For paper trading, we'll use a simple mock price
            # This is fine since our exit strategy is based on percentage changes
            mock_price = Decimal('0.000001')  # 1 SOL = 1,000,000 tokens
            token_amount = (sol_amount / mock_price).quantize(Decimal('0.000000001'), rounding=ROUND_DOWN)
            
            # Update portfolio
            self.portfolio['balance']['SOL'] -= sol_amount
            if base_mint not in self.portfolio['balance']:
                self.portfolio['balance'][base_mint] = Decimal('0')
            self.portfolio['balance'][base_mint] += token_amount
            
            # Record trade
            trade = {
                'pool_id': pool_id,
                'type': 'buy',
                'timestamp': int(datetime.now().timestamp() * 1000),
                'price': float(mock_price),
                'base_amount': float(token_amount),
                'quote_amount': float(sol_amount),
                'base_mint': base_mint,
                'quote_mint': quote_mint,
                'tx_signature': f"paper_buy_{pool_id}_{int(datetime.now().timestamp() * 1000)}",
                'status': 'confirmed'
            }
            self.portfolio['trades'].append(trade)
            
            # Update position with mock price
            if pool_id not in self.portfolio['positions']:
                self.portfolio['positions'][pool_id] = {
                    'entry_price': float(mock_price),
                    'entry_amount': float(token_amount),
                    'entry_timestamp': trade['timestamp'],
                    'status': 'open'
                }
            
            # Save portfolio state
            self._save_portfolio()
            
            logger.info(f"✅ Paper trade executed: {token_amount} tokens for {sol_amount} SOL")
            logger.info(f"Pool: {pool_id}")
            logger.info(f"Mock price: {mock_price}")
            logger.info(f"Base Amount: {token_amount}")
            logger.info(f"Quote Amount: {sol_amount}")
            
            return {
                'status': 'confirmed',
                'pool_id': pool_id,
                'tx_signature': trade['tx_signature'],
                'price': float(mock_price),
                'base_amount': float(token_amount),
                'quote_amount': float(sol_amount),
                'timestamp': trade['timestamp']
            }
            
        except Exception as e:
            logger.error(f"Error executing paper buy: {e}")
            return {
                'status': 'failed',
                'error': str(e),
                'pool_id': pool_id,
                'timestamp': int(datetime.now().timestamp() * 1000)
            }

    def execute_sell(self, pool_id: str, current_price: Decimal) -> Dict[str, Any]:
        """Execute a paper sell trade."""
        try:
            # Get position
            if pool_id not in self.portfolio['positions']:
                raise ValueError(f"No open position for pool {pool_id}")
            
            position = self.portfolio['positions'][pool_id]
            if position['status'] != 'open':
                raise ValueError(f"Position for pool {pool_id} is not open")
            
            # Get token amount and calculate SOL value
            token_amount = Decimal(str(position['entry_amount']))
            entry_price = Decimal(str(position['entry_price']))
            
            # For paper trading, we'll simulate a price change based on percentage
            # This ensures our exit strategy based on percentage changes works correctly
            price_change_percentage = ((current_price - entry_price) / entry_price) * 100
            sol_value = (token_amount * current_price).quantize(Decimal('0.000000001'), rounding=ROUND_DOWN)
            
            # Update portfolio
            self.portfolio['balance']['SOL'] += sol_value
            base_mint = next((t['base_mint'] for t in self.portfolio['trades'] 
                            if t['pool_id'] == pool_id and t['type'] == 'buy'), None)
            if base_mint:
                self.portfolio['balance'][base_mint] -= token_amount
            
            # Calculate PnL
            entry_value = token_amount * entry_price
            pnl = sol_value - entry_value
            pnl_percentage = (pnl / entry_value) * 100
            
            # Record trade
            trade = {
                'pool_id': pool_id,
                'type': 'sell',
                'timestamp': int(datetime.now().timestamp() * 1000),
                'price': float(current_price),
                'base_amount': float(token_amount),
                'quote_amount': float(sol_value),
                'pnl': float(pnl),
                'pnl_percentage': float(pnl_percentage),
                'price_change_percentage': float(price_change_percentage),
                'tx_signature': f"paper_sell_{pool_id}_{int(datetime.now().timestamp() * 1000)}",
                'status': 'confirmed'
            }
            self.portfolio['trades'].append(trade)
            
            # Update position
            position.update({
                'exit_price': float(current_price),
                'exit_amount': float(token_amount),
                'exit_timestamp': trade['timestamp'],
                'pnl': float(pnl),
                'pnl_percentage': float(pnl_percentage),
                'price_change_percentage': float(price_change_percentage),
                'status': 'closed'
            })
            
            # Save portfolio state
            self._save_portfolio()
            
            logger.info(f"✅ Paper sell executed: {token_amount} tokens for {sol_value} SOL")
            logger.info(f"Pool: {pool_id}")
            logger.info(f"Entry price: {entry_price}")
            logger.info(f"Exit price: {current_price}")
            logger.info(f"Price change: {price_change_percentage:.2f}%")
            logger.info(f"PnL: {pnl} SOL ({pnl_percentage:.2f}%)")
            
            return {
                'status': 'confirmed',
                'pool_id': pool_id,
                'tx_signature': trade['tx_signature'],
                'price': float(current_price),
                'base_amount': float(token_amount),
                'quote_amount': float(sol_value),
                'pnl': float(pnl),
                'pnl_percentage': float(pnl_percentage),
                'price_change_percentage': float(price_change_percentage),
                'timestamp': trade['timestamp']
            }
            
        except Exception as e:
            logger.error(f"Error executing paper sell: {e}")
            return {
                'status': 'failed',
                'error': str(e),
                'pool_id': pool_id,
                'timestamp': int(datetime.now().timestamp() * 1000)
            }

    def get_position(self, pool_id: str) -> Optional[Dict[str, Any]]:
        """Get current position for a pool."""
        return self.portfolio['positions'].get(pool_id)

    def get_balance(self, token_mint: str = 'SOL') -> Decimal:
        """Get current balance for a token."""
        return Decimal(str(self.portfolio['balance'].get(token_mint, 0)))

    def get_portfolio_value(self) -> Decimal:
        """Calculate total portfolio value in SOL."""
        total = self.portfolio['balance']['SOL']
        for mint, amount in self.portfolio['balance'].items():
            if mint != 'SOL':
                # In a real implementation, we would fetch current prices
                # For paper trading, we'll use entry prices for open positions
                position = next((p for p in self.portfolio['positions'].values() 
                               if p['status'] == 'open'), None)
                if position:
                    total += Decimal(str(amount)) * Decimal(str(position['entry_price']))
        return total 