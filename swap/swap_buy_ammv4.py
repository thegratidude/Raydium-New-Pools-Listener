from raydium.amm_v4 import buy
import sys

# Canonical Raydium SOL-USDC pool address (legacy, but most liquid)
SOL_USDC_POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"

def main():
    # Accept pair address from command line, or use default
    pair_address = sys.argv[1] if len(sys.argv) > 1 else SOL_USDC_POOL
    sol_in = 0.05
    slippage = 5
    print(f"Testing buy: pair_address={pair_address}, sol_in={sol_in}, slippage={slippage}")
    buy(pair_address, sol_in, slippage)

if __name__ == "__main__":
    main()