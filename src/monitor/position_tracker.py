import sqlite3
from datetime import datetime
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'pool_history.sqlite')

class PositionTracker:
    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            c = conn.cursor()
            c.execute('''
                CREATE TABLE IF NOT EXISTS positions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pool_address TEXT,
                    base_token_mint TEXT,
                    amount REAL,
                    buy_tx TEXT,
                    buy_time TEXT,
                    buy_value_sol REAL,
                    buy_price_usd REAL,
                    sell_tx TEXT,
                    sell_time TEXT,
                    amount_out REAL,
                    sell_price_usd REAL,
                    pnl_sol REAL,
                    pnl_usd REAL,
                    status TEXT
                )
            ''')
            conn.commit()

    def add_position(self, pool_address, base_token_mint, amount, buy_tx, buy_value_sol, buy_price_usd=None):
        with sqlite3.connect(self.db_path) as conn:
            c = conn.cursor()
            c.execute('''
                INSERT INTO positions (
                    pool_address, base_token_mint, amount, buy_tx, buy_time, buy_value_sol, buy_price_usd, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                pool_address,
                base_token_mint,
                amount,
                buy_tx,
                datetime.utcnow().isoformat(),
                buy_value_sol,
                buy_price_usd,
                "open"
            ))
            conn.commit()

    def close_position(self, pool_address, sell_tx, amount_out, sell_price_usd=None):
        with sqlite3.connect(self.db_path) as conn:
            c = conn.cursor()
            # Find the open position for this pool
            c.execute('''
                SELECT id, buy_value_sol, buy_price_usd FROM positions WHERE pool_address=? AND status="open" ORDER BY buy_time ASC LIMIT 1
            ''', (pool_address,))
            row = c.fetchone()
            if row:
                pos_id, buy_value_sol, buy_price_usd = row
                pnl_sol = amount_out - (buy_value_sol or 0)
                pnl_usd = None
                if buy_price_usd is not None and sell_price_usd is not None:
                    buy_usd = (buy_value_sol or 0) * buy_price_usd
                    sell_usd = amount_out * sell_price_usd
                    pnl_usd = sell_usd - buy_usd
                c.execute('''
                    UPDATE positions SET
                        sell_tx=?,
                        sell_time=?,
                        amount_out=?,
                        sell_price_usd=?,
                        pnl_sol=?,
                        pnl_usd=?,
                        status="closed"
                    WHERE id=?
                ''', (
                    sell_tx,
                    datetime.utcnow().isoformat(),
                    amount_out,
                    sell_price_usd,
                    pnl_sol,
                    pnl_usd,
                    pos_id
                ))
                conn.commit() 