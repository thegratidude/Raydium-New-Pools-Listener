"""
Raydium AMM v4 swap module for executing trades on new pools.
This module provides both CLI and programmatic interfaces for executing trades.
"""

from swap.raydium.amm_v4 import buy
import sys
import os
from typing import Dict, Any, Optional
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Canonical Raydium SOL-USDC pool address (legacy, but most liquid)
SOL_USDC_POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"

async def execute_buy(pool_id: str, sol_amount: Optional[float] = None, slippage: float = 5) -> Dict[str, Any]:
    """
    Execute a buy trade on a Raydium pool.
    
    Args:
        pool_id: The Raydium pool address to trade on
        sol_amount: Amount of SOL to trade (uses INITIAL_BUY from .env if None)
        slippage: Maximum allowed slippage percentage
        
    Returns:
        Dict containing trade details including:
        - tx_signature: Transaction signature
        - pool_id: Pool address
        - base_amount: Amount of base token received
        - quote_amount: Amount of SOL spent
        - price: Effective price of the trade
        - timestamp: Trade timestamp
        - status: Trade status ('pending', 'confirmed', 'failed')
    """
    try:
        # Get INITIAL_BUY from environment if not specified
        if sol_amount is None:
            try:
                sol_amount = float(os.getenv('INITIAL_BUY', '0.005'))
            except ValueError:
                print("Warning: INITIAL_BUY in .env is not a valid number, using default 0.005")
                sol_amount = 0.005
        
        print(f"Executing buy: pool={pool_id}, sol_in={sol_amount}, slippage={slippage}%")
        
        # Execute the trade
        tx_result = buy(pool_id, sol_amount, slippage)
        
        # Extract trade details from the result
        trade_details = {
            'tx_signature': tx_result.get('signature'),
            'pool_id': pool_id,
            'base_amount': tx_result.get('base_amount'),
            'quote_amount': sol_amount,  # Amount of SOL spent
            'price': tx_result.get('price'),
            'timestamp': datetime.now().timestamp() * 1000,  # Convert to milliseconds
            'status': 'confirmed' if tx_result.get('success') else 'failed'
        }
        
        return trade_details
        
    except Exception as e:
        print(f"Error executing buy trade: {str(e)}")
        return {
            'tx_signature': None,
            'pool_id': pool_id,
            'base_amount': 0,
            'quote_amount': sol_amount,
            'price': 0,
            'timestamp': datetime.now().timestamp() * 1000,
            'status': 'failed',
            'error': str(e)
        }

def main():
    """CLI entry point for executing trades."""
    # Accept pair address from command line, or use default
    pair_address = sys.argv[1] if len(sys.argv) > 1 else SOL_USDC_POOL
    
    # Execute the trade
    import asyncio
    result = asyncio.run(execute_buy(pair_address))
    
    # Print result
    if result['status'] == 'confirmed':
        print(f"✅ Trade successful!")
        print(f"Transaction: {result['tx_signature']}")
        print(f"Base amount: {result['base_amount']}")
        print(f"Quote amount: {result['quote_amount']} SOL")
        print(f"Price: {result['price']}")
    else:
        print(f"❌ Trade failed: {result.get('error', 'Unknown error')}")

if __name__ == "__main__":
    main()