from raydium.amm_v4 import sell
import sys

# Canonical Raydium SOL-USDC pool address (legacy, but most liquid)
SOL_USDC_POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"

if __name__ == "__main__":
    # Accept pair address from command line, or use default
    pair_address = sys.argv[1] if len(sys.argv) > 1 else SOL_USDC_POOL
    percentage = 100
    slippage = 5
    print(f"Testing sell: pair_address={pair_address}, percentage={percentage}, slippage={slippage}")
    sell(pair_address, percentage, slippage)