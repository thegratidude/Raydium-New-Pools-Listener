"""
Database manager for the Raydium pool trading system.
Handles all database operations including pool storage, trade recording, and position tracking.
"""

import sqlite3
import json
from datetime import datetime
from typing import Optional, Dict, Any, List
import logging

from db_schema import CREATE_TABLES_SQL

logger = logging.getLogger(__name__)

class DatabaseManager:
    def __init__(self, db_path: str):
        """Initialize database connection and create tables if they don't exist."""
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row  # Enable row factory for named access
        self.setup_database()

    def setup_database(self):
        """Create tables if they don't exist."""
        try:
            with self.conn:
                self.conn.executescript(CREATE_TABLES_SQL)
            logger.info("Database tables created successfully")
        except sqlite3.Error as e:
            logger.error(f"Error creating database tables: {e}")
            raise

    def store_pool(self, pool_data: Dict[str, Any]) -> bool:
        """Store a new pool in the database."""
        try:
            with self.conn:
                cursor = self.conn.execute("""
                    INSERT INTO pools (
                        pool_id, base_mint, quote_mint, base_decimals, quote_decimals,
                        discovery_timestamp, initial_price, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    pool_data['pool_id'],
                    pool_data['base_mint'],
                    pool_data['quote_mint'],
                    pool_data['base_decimals'],
                    pool_data['quote_decimals'],
                    datetime.fromtimestamp(pool_data['discovery_timestamp'] / 1000),  # Convert ms to datetime
                    pool_data.get('initial_price'),
                    'active'
                ))
                return cursor.rowcount > 0
        except sqlite3.Error as e:
            logger.error(f"Error storing pool {pool_data['pool_id']}: {e}")
            return False

    def store_pool_snapshot(self, snapshot_data: Dict[str, Any]) -> bool:
        """Store a pool snapshot with all available monitoring data."""
        try:
            with self.conn:
                cursor = self.conn.execute("""
                    INSERT INTO pool_snapshots (
                        pool_id, timestamp, slot,
                        base_reserve, quote_reserve, base_reserve_raw, quote_reserve_raw,
                        price, price_change,
                        tvl, market_cap, volume_24h, volume_change,
                        buy_pressure, sell_pressure, rug_risk,
                        trend, pressure_value, pressure_direction, pressure_strength,
                        trade_count, trade_volume,
                        liquidity_change, price_impact,
                        suspicious, risk_score
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    snapshot_data['pool_id'],
                    datetime.fromtimestamp(snapshot_data['timestamp'] / 1000),  # Convert ms to datetime
                    snapshot_data.get('slot', 0),
                    
                    # Reserve data
                    snapshot_data['base_reserve'],
                    snapshot_data['quote_reserve'],
                    str(snapshot_data.get('base_reserve_raw', '0')),  # Store raw amounts as strings
                    str(snapshot_data.get('quote_reserve_raw', '0')),
                    
                    # Price data
                    snapshot_data['price'],
                    snapshot_data.get('price_change', 0),
                    
                    # Market metrics
                    snapshot_data.get('tvl', 0),
                    snapshot_data.get('market_cap'),
                    snapshot_data.get('volume_24h'),
                    snapshot_data.get('volume_change', 0),
                    
                    # Market pressure
                    snapshot_data.get('buy_pressure'),
                    snapshot_data.get('sell_pressure'),
                    snapshot_data.get('rug_risk'),
                    snapshot_data.get('trend'),
                    snapshot_data.get('pressure_value'),
                    snapshot_data.get('pressure_direction'),
                    snapshot_data.get('pressure_strength'),
                    
                    # Trade activity
                    snapshot_data.get('trade_count'),
                    snapshot_data.get('trade_volume'),
                    
                    # Liquidity metrics
                    snapshot_data.get('liquidity_change'),
                    snapshot_data.get('price_impact'),
                    
                    # Risk indicators
                    snapshot_data.get('suspicious', False),
                    snapshot_data.get('risk_score')
                ))
                return cursor.rowcount > 0
        except sqlite3.Error as e:
            logger.error(f"Error storing snapshot for pool {snapshot_data['pool_id']}: {e}")
            return False

    def get_pool(self, pool_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a pool's data by ID."""
        try:
            cursor = self.conn.execute("SELECT * FROM pools WHERE pool_id = ?", (pool_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        except sqlite3.Error as e:
            logger.error(f"Error retrieving pool {pool_id}: {e}")
            return None

    def get_active_pools(self) -> List[Dict[str, Any]]:
        """Get all active pools."""
        try:
            cursor = self.conn.execute("SELECT * FROM pools WHERE status = 'active'")
            return [dict(row) for row in cursor.fetchall()]
        except sqlite3.Error as e:
            logger.error(f"Error retrieving active pools: {e}")
            return []

    def update_pool_status(self, pool_id: str, status: str) -> bool:
        """Update a pool's status."""
        try:
            with self.conn:
                cursor = self.conn.execute("""
                    UPDATE pools 
                    SET status = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE pool_id = ?
                """, (status, pool_id))
                return cursor.rowcount > 0
        except sqlite3.Error as e:
            logger.error(f"Error updating pool {pool_id} status: {e}")
            return False

    def get_latest_snapshot(self, pool_id: str) -> Optional[Dict[str, Any]]:
        """Get the most recent snapshot for a pool."""
        try:
            cursor = self.conn.execute("""
                SELECT * FROM pool_snapshots 
                WHERE pool_id = ? 
                ORDER BY timestamp DESC 
                LIMIT 1
            """, (pool_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        except sqlite3.Error as e:
            logger.error(f"Error retrieving latest snapshot for pool {pool_id}: {e}")
            return None

    def get_snapshots_in_range(self, pool_id: str, start_time: datetime, end_time: datetime) -> List[Dict[str, Any]]:
        """Get all snapshots for a pool within a time range."""
        try:
            cursor = self.conn.execute("""
                SELECT * FROM pool_snapshots 
                WHERE pool_id = ? AND timestamp BETWEEN ? AND ?
                ORDER BY timestamp ASC
            """, (pool_id, start_time, end_time))
            return [dict(row) for row in cursor.fetchall()]
        except sqlite3.Error as e:
            logger.error(f"Error retrieving snapshots for pool {pool_id}: {e}")
            return []

    def close(self):
        """Close the database connection."""
        if self.conn:
            self.conn.close()

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()

    def store_trade(self, trade_data: Dict[str, Any]) -> bool:
        """Store a trade in the database."""
        try:
            with self.conn:
                self.conn.execute("""
                    INSERT INTO trades (
                        trade_id, pool_id, trade_type, tx_signature,
                        base_amount, quote_amount, price, timestamp, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    trade_data['tx_signature'],  # Use tx signature as trade ID
                    trade_data['pool_id'],
                    'buy',  # For now, we only handle buys
                    trade_data['tx_signature'],
                    trade_data['base_amount'],
                    trade_data['quote_amount'],
                    trade_data['price'],
                    trade_data['timestamp'],
                    trade_data['status']
                ))
            return True
        except Exception as e:
            logger.error(f"Error storing trade: {str(e)}")
            return False

    def store_position(self, position_data: Dict[str, Any]) -> bool:
        """Store a trading position in the database."""
        try:
            with self.conn:
                self.conn.execute("""
                    INSERT INTO positions (
                        pool_id, entry_trade_id, entry_price,
                        entry_timestamp, status
                    ) VALUES (?, ?, ?, ?, ?)
                """, (
                    position_data['pool_id'],
                    position_data['entry_trade_id'],
                    position_data['entry_price'],
                    position_data['entry_timestamp'],
                    position_data['status']
                ))
            return True
        except Exception as e:
            logger.error(f"Error storing position: {str(e)}")
            return False 