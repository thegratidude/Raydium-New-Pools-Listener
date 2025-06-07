"""
Raydium AMM v4 swap module for executing sell trades.
This module provides both CLI and programmatic interfaces for executing trades.
"""

from swap.raydium.amm_v4 import sell
import sys
from typing import Dict, Any, Optional, Tuple
from datetime import datetime

# Canonical Raydium SOL-USDC pool address (legacy, but most liquid)
SOL_USDC_POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"

async def execute_sell(pool_id: str, sell_percentage: float = 1.0, slippage: float = 5) -> Dict[str, Any]:
    """
    Execute a sell trade on a Raydium pool.
    
    Args:
        pool_id: The Raydium pool address to trade on
        sell_percentage: Percentage of tokens to sell (0.0 to 1.0)
        slippage: Maximum allowed slippage percentage
        
    Returns:
        Dict containing trade details including:
        - tx_signature: Transaction signature
        - pool_id: Pool address
        - base_amount: Amount of base token sold
        - quote_amount: Amount of SOL received
        - price: Effective price of the trade
        - timestamp: Trade timestamp
        - status: Trade status ('pending', 'confirmed', 'failed')
    """
    try:
        # Convert percentage to integer (1-100)
        percentage = int(sell_percentage * 100)
        if not (1 <= percentage <= 100):
            raise ValueError("Sell percentage must be between 1 and 100")
        
        print(f"Executing sell: pool={pool_id}, percentage={percentage}%, slippage={slippage}%")
        
        # Execute the trade
        tx_sig, amount_out = sell(pool_id, percentage, int(slippage))
        
        if tx_sig and amount_out:
            # Extract trade details from the result
            trade_details = {
                'tx_signature': tx_sig,
                'pool_id': pool_id,
                'base_amount': None,  # TODO: Get actual base amount from transaction
                'quote_amount': amount_out,  # Amount of SOL received
                'price': None,  # TODO: Calculate effective price
                'timestamp': int(datetime.now().timestamp() * 1000),  # Convert to milliseconds
                'status': 'confirmed'
            }
            return trade_details
        else:
            return {
                'tx_signature': None,
                'pool_id': pool_id,
                'base_amount': 0,
                'quote_amount': 0,
                'price': 0,
                'timestamp': int(datetime.now().timestamp() * 1000),
                'status': 'failed',
                'error': 'Sell transaction failed'
            }
        
    except Exception as e:
        print(f"Error executing sell trade: {str(e)}")
        return {
            'tx_signature': None,
            'pool_id': pool_id,
            'base_amount': 0,
            'quote_amount': 0,
            'price': 0,
            'timestamp': int(datetime.now().timestamp() * 1000),
            'status': 'failed',
            'error': str(e)
        }

if __name__ == "__main__":
    # Accept pair address from command line, or use default
    pair_address = sys.argv[1] if len(sys.argv) > 1 else SOL_USDC_POOL
    percentage = 100
    slippage = 5
    print(f"Testing sell: pair_address={pair_address}, percentage={percentage}, slippage={slippage}")
    import asyncio
    result = asyncio.run(execute_sell(pair_address, percentage/100, slippage))
    print(f"Result: {result}")