import time
from solders.pubkey import Pubkey
from config import client, payer_keypair
from swap.raydium.amm_v4 import buy, sell

SOL_USDC_POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"

# Helper to get SOL balance
def get_sol_balance(pubkey):
    return client.get_balance(pubkey).value / 1e9

if __name__ == "__main__":
    my_pubkey = payer_keypair.pubkey()
    print(f"Testing roundtrip on Raydium SOL-USDC pool: {SOL_USDC_POOL}")
    sol_before = get_sol_balance(my_pubkey)
    print(f"SOL balance before: {sol_before}")

    # Run buy (0.05 SOL, 5% slippage)
    print("Running buy...")
    buy(SOL_USDC_POOL, sol_in=0.05, slippage=5)

    print("Waiting 10 seconds before selling...")
    time.sleep(10)

    # Run sell (100% of token, 5% slippage)
    print("Running sell...")
    sell(SOL_USDC_POOL, percentage=100, slippage=5)

    print("Waiting 30 seconds for wallet to update...")
    time.sleep(30)

    sol_after = get_sol_balance(my_pubkey)
    print(f"SOL balance after: {sol_after}")
    print(f"Net SOL change: {sol_after - sol_before}") 