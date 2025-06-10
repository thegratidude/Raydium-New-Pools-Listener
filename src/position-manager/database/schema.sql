-- Position Manager Database Schema
-- Enhanced schema for Status 6 pool detection and position management

-- Status 6 Pools table: Enhanced pool metadata from our detection system
CREATE TABLE IF NOT EXISTS status_6_pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT UNIQUE NOT NULL,
    
    -- Basic token information
    token_a_symbol TEXT,
    token_a_mint TEXT NOT NULL,
    token_b_symbol TEXT,
    token_b_mint TEXT NOT NULL,
    
    -- Pool timing
    pool_open_time INTEGER NOT NULL,
    detected_at INTEGER NOT NULL,
    pool_age_seconds INTEGER NOT NULL,
    
    -- Vault addresses for direct trading
    base_vault TEXT NOT NULL,
    quote_vault TEXT NOT NULL,
    
    -- Market information
    lp_mint TEXT,
    market_id TEXT,
    amm_open_orders TEXT,
    serum_program_id TEXT,
    amm_target_orders TEXT,
    pool_withdraw_queue TEXT,
    pool_temp_lp_token_account TEXT,
    amm_owner TEXT,
    pnl_owner TEXT,
    
    -- Fee structure
    trade_fee_numerator INTEGER,
    trade_fee_denominator INTEGER,
    swap_fee_numerator INTEGER,
    swap_fee_denominator INTEGER,
    pnl_numerator INTEGER,
    pnl_denominator INTEGER,
    
    -- Trading parameters
    min_size INTEGER,
    vol_max_cut_ratio REAL,
    amount_wave_ratio REAL,
    coin_lot_size INTEGER,
    pc_lot_size INTEGER,
    max_price_multiplier REAL,
    min_price_multiplier REAL,
    
    -- Pool configuration
    base_decimals INTEGER,
    quote_decimals INTEGER,
    nonce INTEGER,
    order_num INTEGER,
    depth INTEGER,
    state INTEGER,
    reset_flag INTEGER,
    system_decimals_value INTEGER,
    min_separate_numerator INTEGER,
    min_separate_denominator INTEGER,
    
    -- PnL and swap state
    need_take_pnl_coin INTEGER,
    need_take_pnl_pc INTEGER,
    total_pnl_pc REAL,
    total_pnl_coin REAL,
    punish_pc_amount REAL,
    punish_coin_amount REAL,
    orderbook_to_init_time INTEGER,
    
    -- Swap amounts (stored as strings for BigNumber compatibility)
    swap_coin_in_amount TEXT,
    swap_pc_out_amount TEXT,
    swap_coin_2_pc_fee INTEGER,
    swap_pc_in_amount TEXT,
    swap_coin_out_amount TEXT,
    swap_pc_2_coin_fee INTEGER,
    
    -- Analysis and tracking
    analysis_status TEXT DEFAULT 'pending', -- 'pending', 'analyzed', 'traded', 'ignored'
    risk_score REAL DEFAULT 0,
    opportunity_score REAL DEFAULT 0,
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Positions table: Track arbitrage positions
CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    position_type TEXT NOT NULL, -- 'arbitrage', 'scalp', 'swing'
    status TEXT NOT NULL DEFAULT 'open', -- 'open', 'closed', 'liquidated', 'cancelled'
    
    -- Entry information
    entry_price REAL,
    entry_amount REAL,
    entry_timestamp INTEGER,
    entry_tx_signature TEXT,
    
    -- Exit information
    exit_price REAL,
    exit_amount REAL,
    exit_timestamp INTEGER,
    exit_tx_signature TEXT,
    
    -- PnL tracking
    pnl_quote REAL, -- Profit/loss in quote token
    pnl_percentage REAL, -- Percentage gain/loss
    fees_paid REAL, -- Total fees paid
    
    -- Strategy information
    strategy_name TEXT,
    strategy_parameters TEXT, -- JSON string
    
    -- Risk management
    stop_loss_price REAL,
    take_profit_price REAL,
    max_position_size REAL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (pool_id) REFERENCES status_6_pools(pool_id)
);

-- Pool Snapshots table: Track pool state during position lifecycle
CREATE TABLE IF NOT EXISTS pool_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    position_id INTEGER,
    timestamp INTEGER NOT NULL,
    
    -- Price and liquidity data
    price REAL,
    base_reserve REAL,
    quote_reserve REAL,
    tvl REAL,
    
    -- Market metrics
    volume_24h REAL,
    price_change_24h REAL,
    liquidity_change REAL,
    
    -- Risk indicators
    rug_risk_score REAL,
    volatility_score REAL,
    liquidity_score REAL,
    
    -- Trade activity
    trade_count_24h INTEGER,
    unique_traders_24h INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (pool_id) REFERENCES status_6_pools(pool_id),
    FOREIGN KEY (position_id) REFERENCES positions(id)
);

-- Trade History table: Track all trades for analysis
CREATE TABLE IF NOT EXISTS trade_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id INTEGER,
    pool_id TEXT NOT NULL,
    tx_signature TEXT UNIQUE NOT NULL,
    trade_type TEXT NOT NULL, -- 'buy', 'sell', 'swap'
    
    -- Trade details
    base_amount REAL,
    quote_amount REAL,
    price REAL,
    fee_amount REAL,
    
    -- Transaction details
    block_time INTEGER,
    slot INTEGER,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (position_id) REFERENCES positions(id),
    FOREIGN KEY (pool_id) REFERENCES status_6_pools(pool_id)
);

-- Analysis Results table: Store analysis outcomes
CREATE TABLE IF NOT EXISTS analysis_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    analysis_type TEXT NOT NULL, -- 'initial', 'ongoing', 'final'
    
    -- Analysis metrics
    profitability_score REAL,
    risk_score REAL,
    liquidity_score REAL,
    volatility_score REAL,
    
    -- Recommendations
    recommended_action TEXT, -- 'trade', 'monitor', 'ignore'
    confidence_score REAL,
    reasoning TEXT,
    
    -- Analysis parameters
    analysis_parameters TEXT, -- JSON string
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (pool_id) REFERENCES status_6_pools(pool_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_status_6_pools_pool_id ON status_6_pools(pool_id);
CREATE INDEX IF NOT EXISTS idx_status_6_pools_detected_at ON status_6_pools(detected_at);
CREATE INDEX IF NOT EXISTS idx_status_6_pools_analysis_status ON status_6_pools(analysis_status);
CREATE INDEX IF NOT EXISTS idx_status_6_pools_opportunity_score ON status_6_pools(opportunity_score);

CREATE INDEX IF NOT EXISTS idx_positions_pool_id ON positions(pool_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_created_at ON positions(created_at);

CREATE INDEX IF NOT EXISTS idx_pool_snapshots_pool_id ON pool_snapshots(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_timestamp ON pool_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_position_id ON pool_snapshots(position_id);

CREATE INDEX IF NOT EXISTS idx_trade_history_pool_id ON trade_history(pool_id);
CREATE INDEX IF NOT EXISTS idx_trade_history_position_id ON trade_history(position_id);
CREATE INDEX IF NOT EXISTS idx_trade_history_tx_signature ON trade_history(tx_signature);

CREATE INDEX IF NOT EXISTS idx_analysis_results_pool_id ON analysis_results(pool_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_analysis_type ON analysis_results(analysis_type); 