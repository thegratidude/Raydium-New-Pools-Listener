from raydium.amm_v4 import buy
import sys
import os

# Canonical Raydium SOL-USDC pool address (legacy, but most liquid)
SOL_USDC_POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"

def main():
    # Accept pair address from command line, or use default
    pair_address = sys.argv[1] if len(sys.argv) > 1 else SOL_USDC_POOL
    sol_in = float(sys.argv[2]) if len(sys.argv) > 2 else float(os.getenv("INITIAL_BUY", "0.05"))
    slippage = int(sys.argv[3]) if len(sys.argv) > 3 else int(os.getenv("SLIPPAGE", "5"))
    print(f"🚀 Executing buy transaction:
   Pool Address: {pair_address}
   SOL Amount: {sol_in}
   Slippage: {slippage}%
   Environment INITIAL_BUY: {os.getenv("INITIAL_BUY", "Not set")}
   Environment SLIPPAGE: {os.getenv("SLIPPAGE", "Not set")}")
    success = buy(pair_address, sol_in, slippage)
    if success:
        print(f"✅ Buy transaction completed successfully!")
    else:
        print(f"❌ Buy transaction failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()