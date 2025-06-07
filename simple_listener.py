"""
Minimal Socket.IO client for listening to Raydium new pool events and executing a buy (paper trading) function.
"""

import socketio
import asyncio
import logging
import os
import sqlite3
from dotenv import load_dotenv
from config import SERVER_CONFIG, EVENT_TYPES, DISPLAY_CONFIG

# --- Minimal DBManager (for writing new pools and trades in live trading mode) ---

class DBManager:
    def __init__(self, db_file="trading_history.sqlite"):
        self.db_file = db_file
        self.conn = sqlite3.connect(db_file, check_same_thread=False)
        self.cursor = self.conn.cursor()
        self.cursor.execute("CREATE TABLE IF NOT EXISTS new_pools (pool_id TEXT, base_mint TEXT, quote_mint TEXT, base_decimals INTEGER, quote_decimals INTEGER, initial_price REAL, discovery_timestamp INTEGER, status TEXT DEFAULT 'active')")
        self.cursor.execute("CREATE TABLE IF NOT EXISTS trades (tx_signature TEXT, pool_id TEXT, base_amount REAL, quote_amount REAL, price REAL, timestamp INTEGER, status TEXT, error TEXT)")
        self.conn.commit()

    def store_new_pool(self, pool_data):
        try:
            self.cursor.execute("INSERT INTO new_pools (pool_id, base_mint, quote_mint, base_decimals, quote_decimals, initial_price, discovery_timestamp, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               (pool_data["pool_id"], pool_data["base_mint"], pool_data["quote_mint"], pool_data["base_decimals"], pool_data["quote_decimals"], pool_data["initial_price"], pool_data["discovery_timestamp"], pool_data.get("status", "active")))
            self.conn.commit()
            return True
        except Exception as e:
            logging.error(f"DB error (store_new_pool): {e}")
            return False

    def store_trade(self, trade_data):
        try:
            self.cursor.execute("INSERT INTO trades (tx_signature, pool_id, base_amount, quote_amount, price, timestamp, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               (trade_data.get("tx_signature", ""), trade_data["pool_id"], trade_data.get("base_amount", 0), trade_data.get("quote_amount", 0), trade_data.get("price", 0), trade_data.get("timestamp", 0), trade_data.get("status", "unknown"), trade_data.get("error", "")))
            self.conn.commit()
            return True
        except Exception as e:
            logging.error(f"DB error (store_trade): {e}")
            return False

    def __del__(self):
         self.conn.close()

# --- End DBManager ---

# Load environment variables (e.g. INITIAL_BUY, LIVE_TRADING, etc.)
load_dotenv()

# Configure logging for user-friendly output
logging.basicConfig(
    format='%(asctime)s | %(message)s',
    level=logging.INFO,
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Initialize Socket.IO client (using default polling upgrade to websocket)
sio = socketio.AsyncClient(
    logger=False,
    engineio_logger=False,
    transports=['websocket', 'polling'],
    engineio_path='/socket.io/',
    reconnection=True,
    reconnection_attempts=5,
    reconnection_delay=1000,
    reconnection_delay_max=5000,
    randomization_factor=0.5,
    engineio_opts={'eio': 3}  # Force Engine.IO v3 to match server
)

# --- Minimal (mock) paper trading model ---
class MockPaperTradingManager:
    def execute_buy(self, pool_id, base_mint, quote_mint, initial_price, base_decimals, quote_decimals, sol_amount):
        # Simulate a "mock" paper trade (for example, print a "mock" trade result) so that a novice can see that a "paper" trade is "executed" (even if no real trade is performed).
        mock_result = { "tx_signature": "mock_tx_signature", "pool_id": pool_id, "base_amount": 0.0, "quote_amount": sol_amount, "price": initial_price, "timestamp": int(asyncio.get_event_loop().time() * 1000), "status": "confirmed", "error": "" }
        return mock_result

    def update_position_price(self, pool_id, current_price):
        # Implementation of update_position_price method
        pass
# --- End mock paper trading model ---

# Initialize paper trading (or live trading if LIVE_TRADING is set to 1)
LIVE_TRADING = os.getenv("LIVE_TRADING", "0") == "1"
if LIVE_TRADING:
    logger.info("[MODE] Live trading mode enabled (not implemented in this minimal version).")
    buy_func = None  # (Replace with your live buy function if needed)
    db_manager = DBManager("trading_history.sqlite")
else:
    logger.info("[MODE] Paper trading mode enabled (using a minimal mock paper trading model).")
    paper_trader = MockPaperTradingManager()
    buy_func = paper_trader.execute_buy
    db_manager = None

# --- Event Handlers ---

@sio.event
async def connect():
    """Handle successful connection to the server."""
    logger.info("✅ Connected to the Raydium server!")
    logger.info("Waiting for new pool events...")

@sio.event
async def connect_error(data):
    """Handle connection errors."""
    logger.error("❌ Could not connect to the server. Please check your connection and try again.")

@sio.event
async def disconnect():
    """Handle disconnection from the server."""
    logger.warning("⚠️ Disconnected from the server. Trying to reconnect...")

@sio.on(EVENT_TYPES["NEW_POOL"])
async def on_new_pool(data):
    # Nicely formatted output for new pool discovery
    pool_id = data.get("poolId")
    base_mint = data.get("baseMint")
    quote_mint = data.get("quoteMint")
    base_decimals = int(data.get("baseDecimals", 9))
    quote_decimals = int(data.get("quoteDecimals", 6))
    initial_price = data.get("initialPrice", 0.0)
    discovery_timestamp = data.get("timestamp", 0) or int(asyncio.get_event_loop().time() * 1000)
    logger.info("\n==============================")
    logger.info("🚀 NEW POOL DISCOVERED!")
    logger.info(f"Pool ID:        {pool_id}")
    logger.info(f"Base Token:     {base_mint} (decimals: {base_decimals})")
    logger.info(f"Quote Token:    {quote_mint} (decimals: {quote_decimals})")
    logger.info(f"Initial Price:  {initial_price}")
    logger.info("==============================\n")

    if LIVE_TRADING and db_manager:
         pool_data = { "pool_id": pool_id, "base_mint": base_mint, "quote_mint": quote_mint, "base_decimals": base_decimals, "quote_decimals": quote_decimals, "initial_price": initial_price, "discovery_timestamp": discovery_timestamp, "status": "active" }
         if db_manager.store_new_pool(pool_data):
             logger.info("[DB] New pool written to database.")
         else:
             logger.error("[DB ERROR] Failed to write new pool to database.")

    if buy_func:
         try:
             result = buy_func(pool_id, base_mint, quote_mint, initial_price, base_decimals, quote_decimals, sol_amount=float(os.getenv("INITIAL_BUY", "0.005")))
             logger.info(f"[TRADE] Paper trade executed. Result: {result}")
             if LIVE_TRADING and db_manager:
                 if db_manager.store_trade(result):
                     logger.info("[DB] Trade written to database.")
                 else:
                     logger.error("[DB ERROR] Failed to write trade to database.")
         except Exception as e:
             logger.error(f"[TRADE ERROR] Could not execute paper trade: {e}")

@sio.on(EVENT_TYPES["HEALTH"])
async def on_health(data):
    logger.info(f"[HEALTH CHECK] Server says: {data}")

@sio.on(EVENT_TYPES["POOL_UPDATE"])
async def on_pool_update(data):
    pool_id = data.get("poolId")
    current_price = data.get("price")
    if pool_id and current_price and not LIVE_TRADING:
         paper_trader.update_position_price(pool_id, current_price)
         # (update_position_price logs internally if an exit is triggered, so we do not assign its result.)

# --- Main entry point ---

async def main():
    try:
        sio.on("connect", connect)
        sio.on("connect_error", connect_error)
        sio.on("disconnect", disconnect)
        sio.on(EVENT_TYPES["NEW_POOL"], on_new_pool)
        sio.on(EVENT_TYPES["HEALTH"], on_health)
        sio.on(EVENT_TYPES["POOL_UPDATE"], on_pool_update)
        logger.info("Connecting to Raydium server (using polling transport)...")
        await sio.connect(f"http://{SERVER_CONFIG['host']}:{SERVER_CONFIG['port']}", transports=["polling"], wait_timeout=10)
        logger.info("Connection established. Listening for events (including real-time price updates)…")
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        logger.info("👋 Shutdown requested by user. Exiting...")
    except Exception as e:
        logger.error(f"[FATAL ERROR] {e}")
    finally:
        if sio.connected:
            await sio.disconnect()
        logger.info("Client shutdown complete.")

if __name__ == "__main__":
    asyncio.run(main()) 