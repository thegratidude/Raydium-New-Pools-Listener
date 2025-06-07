"""
SQL schema for the Raydium pool trading system database.
This schema defines the structure for storing pool data, trades, positions, and monitoring information.
"""

# SQL commands to create tables
CREATE_TABLES_SQL = """
-- Pools table: Core pool information
CREATE TABLE IF NOT EXISTS pools (
    pool_id TEXT PRIMARY KEY,
    base_mint TEXT NOT NULL,
    quote_mint TEXT NOT NULL,
    base_decimals INTEGER NOT NULL DEFAULT 9,
    quote_decimals INTEGER NOT NULL DEFAULT 6,
    initial_price REAL,
    discovery_timestamp INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trades table: Individual trade records
CREATE TABLE IF NOT EXISTS trades (
    trade_id TEXT PRIMARY KEY,  -- Transaction signature
    pool_id TEXT NOT NULL,
    trade_type TEXT NOT NULL,  -- 'buy' or 'sell'
    tx_signature TEXT NOT NULL,
    base_amount REAL NOT NULL,
    quote_amount REAL NOT NULL,
    price REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL,  -- 'pending', 'confirmed', 'failed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pool_id) REFERENCES pools(pool_id)
);

-- Positions table: Tracks open and closed positions
CREATE TABLE IF NOT EXISTS positions (
    position_id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    entry_trade_id TEXT NOT NULL,
    exit_trade_id TEXT,
    entry_price REAL NOT NULL,
    exit_price REAL,
    entry_timestamp INTEGER NOT NULL,
    exit_timestamp INTEGER,
    pnl REAL,  -- Profit/loss in quote token
    status TEXT NOT NULL,  -- 'open', 'closed', 'liquidated'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pool_id) REFERENCES pools(pool_id),
    FOREIGN KEY (entry_trade_id) REFERENCES trades(trade_id),
    FOREIGN KEY (exit_trade_id) REFERENCES trades(trade_id)
);

-- Pool Snapshots table: Historical data for price and reserves
CREATE TABLE IF NOT EXISTS pool_snapshots (
    snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    slot INTEGER NOT NULL DEFAULT 0,
    
    -- Reserve data
    base_reserve REAL NOT NULL,
    quote_reserve REAL NOT NULL,
    base_reserve_raw TEXT NOT NULL,
    quote_reserve_raw TEXT NOT NULL,
    
    -- Price data
    price REAL NOT NULL,
    price_change REAL DEFAULT 0,
    
    -- Market metrics
    tvl REAL DEFAULT 0,
    market_cap REAL,
    volume_24h REAL,
    volume_change REAL DEFAULT 0,
    
    -- Market pressure
    buy_pressure REAL,
    sell_pressure REAL,
    rug_risk REAL,
    trend TEXT,
    pressure_value REAL,
    pressure_direction TEXT,
    pressure_strength REAL,
    
    -- Trade activity
    trade_count INTEGER,
    trade_volume REAL,
    
    -- Liquidity metrics
    liquidity_change REAL,
    price_impact REAL,
    
    -- Risk indicators
    suspicious BOOLEAN DEFAULT FALSE,
    risk_score REAL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pool_id) REFERENCES pools(pool_id)
);

-- Exit Strategies table: Different exit strategies
CREATE TABLE IF NOT EXISTS exit_strategies (
    strategy_id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    parameters TEXT,  -- JSON string of strategy parameters
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pool_id) REFERENCES pools(pool_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_pools_status ON pools(status);
CREATE INDEX IF NOT EXISTS idx_pools_discovery ON pools(discovery_timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_pool_timestamp ON trades(pool_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_pool ON positions(pool_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_pool_timestamp ON pool_snapshots(pool_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON pool_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_exit_strategies_pool ON exit_strategies(pool_id);
""" 