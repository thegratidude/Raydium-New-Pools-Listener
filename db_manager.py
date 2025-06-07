"""
Database manager for the Raydium pool trading system.
Handles all database operations including pool storage, trade recording, and position tracking.
"""

import sqlite3
import json
from datetime import datetime
from typing import Optional, Dict, Any, List
import logging
from decimal import Decimal
import time

from db_schema import CREATE_TABLES_SQL

logger = logging.getLogger(__name__)

class DecimalEncoder(json.JSONEncoder):
    """Custom JSON encoder for Decimal types."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return str(obj)
        return super().default(obj)

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

    def _convert_timestamp(self, timestamp: Any) -> int:
        """Convert various timestamp formats to integer milliseconds."""
        if isinstance(timestamp, datetime):
            return int(timestamp.timestamp() * 1000)
        elif isinstance(timestamp, (int, float)):
            return int(timestamp)
        elif isinstance(timestamp, str):
            try:
                dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                return int(dt.timestamp() * 1000)
            except ValueError:
                logger.error(f"Invalid timestamp format: {timestamp}")
                return int(time.time() * 1000)
        else:
            logger.error(f"Unexpected timestamp type: {type(timestamp)}")
            return int(time.time() * 1000)

    def store_pool(self, pool_data: Dict[str, Any]) -> bool:
        """Store a new pool in the database."""
        try:
            timestamp = self._convert_timestamp(pool_data.get('timestamp', time.time()))
            
            with self.conn:
                # First check if pool already exists
                cursor = self.conn.execute("SELECT pool_id FROM pools WHERE pool_id = ?", (pool_data['pool_id'],))
                if cursor.fetchone():
                    # Pool exists, update initial price if it's not set and we have a new price
                    if pool_data.get('initial_price', 0.0) > 0:
                        cursor = self.conn.execute("""
                            UPDATE pools 
                            SET initial_price = ?, updated_at = CURRENT_TIMESTAMP
                            WHERE pool_id = ? AND (initial_price = 0 OR initial_price IS NULL)
                        """, (float(pool_data['initial_price']), pool_data['pool_id']))
                        return cursor.rowcount > 0
                    return True
                
                # Insert new pool
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
                    timestamp,
                    float(pool_data.get('initial_price', 0.0)),
                    'active'
                ))
                return cursor.rowcount > 0
        except sqlite3.Error as e:
            logger.error(f"Error storing pool {pool_data['pool_id']}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error storing pool {pool_data['pool_id']}: {e}")
            return False

    def store_pool_snapshot(self, snapshot_data: Dict[str, Any]) -> bool:
        """Store a pool snapshot with all available monitoring data."""
        try:
            timestamp = self._convert_timestamp(snapshot_data.get('timestamp', time.time()))
            
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
                    timestamp,
                    snapshot_data.get('slot', 0),
                    
                    # Reserve data
                    float(snapshot_data.get('base_reserve', 0)),
                    float(snapshot_data.get('quote_reserve', 0)),
                    str(snapshot_data.get('base_reserve_raw', '0')),
                    str(snapshot_data.get('quote_reserve_raw', '0')),
                    
                    # Price data
                    float(snapshot_data.get('price', 0)),
                    float(snapshot_data.get('price_change', 0)),
                    
                    # Market metrics
                    float(snapshot_data.get('tvl', 0)),
                    float(snapshot_data.get('market_cap', 0)) if snapshot_data.get('market_cap') is not None else None,
                    float(snapshot_data.get('volume_24h', 0)) if snapshot_data.get('volume_24h') is not None else None,
                    float(snapshot_data.get('volume_change', 0)),
                    
                    # Market pressure
                    float(snapshot_data.get('buy_pressure', 0)) if snapshot_data.get('buy_pressure') is not None else None,
                    float(snapshot_data.get('sell_pressure', 0)) if snapshot_data.get('sell_pressure') is not None else None,
                    float(snapshot_data.get('rug_risk', 0)) if snapshot_data.get('rug_risk') is not None else None,
                    snapshot_data.get('trend'),
                    float(snapshot_data.get('pressure_value', 0)) if snapshot_data.get('pressure_value') is not None else None,
                    snapshot_data.get('pressure_direction'),
                    float(snapshot_data.get('pressure_strength', 0)) if snapshot_data.get('pressure_strength') is not None else None,
                    
                    # Trade activity
                    int(snapshot_data.get('trade_count', 0)) if snapshot_data.get('trade_count') is not None else None,
                    float(snapshot_data.get('trade_volume', 0)) if snapshot_data.get('trade_volume') is not None else None,
                    
                    # Liquidity metrics
                    float(snapshot_data.get('liquidity_change', 0)) if snapshot_data.get('liquidity_change') is not None else None,
                    float(snapshot_data.get('price_impact', 0)) if snapshot_data.get('price_impact') is not None else None,
                    
                    # Risk indicators
                    bool(snapshot_data.get('suspicious', False)),
                    float(snapshot_data.get('risk_score', 0)) if snapshot_data.get('risk_score') is not None else None
                ))
                return cursor.rowcount > 0
        except sqlite3.Error as e:
            logger.error(f"Error storing snapshot for pool {snapshot_data['pool_id']}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error storing snapshot: {e}")
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
            timestamp = self._convert_timestamp(trade_data.get('timestamp', time.time()))
            
            with self.conn:
                self.conn.execute("""
                    INSERT INTO trades (
                        trade_id, pool_id, trade_type, tx_signature,
                        base_amount, quote_amount, price, timestamp, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    trade_data['tx_signature'],  # Use tx signature as trade ID
                    trade_data['pool_id'],
                    trade_data.get('trade_type', 'buy'),
                    trade_data['tx_signature'],
                    float(trade_data['base_amount']),
                    float(trade_data['quote_amount']),
                    float(trade_data['price']),
                    timestamp,
                    trade_data.get('status', 'confirmed')
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
                        base_amount, quote_amount, status, opened_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    position_data['pool_id'],
                    position_data['entry_trade_id'],
                    float(position_data['entry_price']),
                    float(position_data['base_amount']),
                    float(position_data['quote_amount']),
                    position_data.get('status', 'open'),
                    position_data['opened_at']
                ))
            return True
        except Exception as e:
            logger.error(f"Error storing position: {str(e)}")
            return False

    def update_position(self, position_data: Dict[str, Any]) -> bool:
        """Update an existing position with exit information."""
        try:
            with self.conn:
                self.conn.execute("""
                    UPDATE positions 
                    SET exit_trade_id = ?,
                        exit_price = ?,
                        pnl = ?,
                        pnl_percentage = ?,
                        status = ?,
                        closed_at = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE pool_id = ? AND status = 'open'
                """, (
                    position_data.get('exit_trade_id'),
                    float(position_data.get('exit_price', 0.0)),
                    float(position_data.get('pnl', 0.0)),
                    float(position_data.get('pnl_percentage', 0.0)),
                    position_data.get('status', 'closed'),
                    position_data.get('closed_at', datetime.now().isoformat()),
                    position_data['pool_id']
                ))
            return True
        except Exception as e:
            logger.error(f"Error updating position: {str(e)}")
            return False

    def save_portfolio_state(self, portfolio_data: Dict[str, Any], file_path: str) -> bool:
        """Save portfolio state to a JSON file with proper Decimal handling."""
        try:
            with open(file_path, 'w') as f:
                json.dump(portfolio_data, f, cls=DecimalEncoder, indent=2)
            return True
        except Exception as e:
            logger.error(f"Error saving portfolio state: {e}")
            return False

    def get_active_positions(self) -> List[Dict[str, Any]]:
        """Get all open positions."""
        try:
            cursor = self.conn.execute("""
                SELECT p.*, t.price as entry_price, t.timestamp as entry_timestamp
                FROM positions p
                JOIN trades t ON p.entry_trade_id = t.trade_id
                WHERE p.status = 'open'
            """)
            return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error retrieving active positions: {e}")
            return []

    def get_pool_history(self, pool_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Get recent history for a pool including trades and snapshots."""
        try:
            cursor = self.conn.execute("""
                SELECT 
                    s.timestamp,
                    s.price,
                    s.price_change,
                    s.tvl,
                    s.volume_24h,
                    s.buy_pressure,
                    s.sell_pressure,
                    s.rug_risk,
                    s.risk_score
                FROM pool_snapshots s
                WHERE s.pool_id = ?
                ORDER BY s.timestamp DESC
                LIMIT ?
            """, (pool_id, limit))
            return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error retrieving pool history: {e}")
            return [] 