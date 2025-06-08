import * as path from 'path';
import { promisify } from 'util';

const dbPath = path.join(process.cwd(), 'pool_history.sqlite');

// Helper functions for timestamps
export const getCurrentTimestamp = () => Math.floor(Date.now() / 1000);

export const toPSTTimestamp = (unixTimestamp: number): string => {
    const date = new Date(unixTimestamp * 1000);
    return date.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
};

export const fromPSTTimestamp = (pstTimestamp: string): number => {
    const date = new Date(pstTimestamp);
    return Math.floor(date.getTime() / 1000);
};

// Schema definition
const SCHEMA = `
-- Pending Pools Table (managed by PendingPoolManager)
CREATE TABLE IF NOT EXISTS pending_pools (
    pool_id TEXT PRIMARY KEY,
    base_mint TEXT NOT NULL,
    quote_mint TEXT NOT NULL,
    base_decimals INTEGER NOT NULL DEFAULT 9,
    quote_decimals INTEGER NOT NULL DEFAULT 6,
    state TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'exists', 'ready', 'failed'
    first_seen INTEGER NOT NULL,  -- Unix timestamp
    first_seen_pst TEXT NOT NULL, -- PST timestamp
    exists_since INTEGER,         -- Unix timestamp
    exists_since_pst TEXT,        -- PST timestamp
    ready_since INTEGER,          -- Unix timestamp
    ready_since_pst TEXT,         -- PST timestamp
    failed_at INTEGER,            -- Unix timestamp
    failed_at_pst TEXT,           -- PST timestamp
    error TEXT,
    attempts INTEGER DEFAULT 0,
    last_checked INTEGER,         -- Unix timestamp
    last_checked_pst TEXT,        -- PST timestamp
    last_readiness_check INTEGER, -- Unix timestamp
    last_readiness_check_pst TEXT, -- PST timestamp
    initial_price REAL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_at_pst TEXT NOT NULL DEFAULT (datetime('now', 'localtime', '-8 hours')),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at_pst TEXT NOT NULL DEFAULT (datetime('now', 'localtime', '-8 hours'))
);

-- Pool Snapshots Table (managed by PoolMonitorManager)
CREATE TABLE IF NOT EXISTS pool_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,  -- Unix timestamp
    timestamp_pst TEXT NOT NULL, -- PST timestamp
    
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
    volume_24h REAL DEFAULT 0,
    volume_change REAL DEFAULT 0,
    
    -- Market pressure
    buy_pressure REAL,
    sell_pressure REAL,
    market_pressure REAL,
    pressure_direction TEXT,  -- 'buy', 'sell', 'neutral'
    pressure_strength TEXT,   -- 'weak', 'moderate', 'strong'
    pressure_severity TEXT,   -- 'low', 'medium', 'high'
    
    -- Trade activity
    trade_count INTEGER DEFAULT 0,
    trade_volume REAL DEFAULT 0,
    
    -- Liquidity metrics
    liquidity_change REAL DEFAULT 0,
    price_impact REAL DEFAULT 0,
    
    -- Risk indicators
    suspicious BOOLEAN DEFAULT FALSE,
    risk_score REAL DEFAULT 0,
    
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_at_pst TEXT NOT NULL DEFAULT (datetime('now', 'localtime', '-8 hours')),
    FOREIGN KEY (pool_id) REFERENCES pending_pools(pool_id)
);

-- Trades Table (for both paper and live trading)
CREATE TABLE IF NOT EXISTS trades (
    trade_id TEXT PRIMARY KEY,  -- Transaction signature
    pool_id TEXT NOT NULL,
    trade_type TEXT NOT NULL,  -- 'buy' or 'sell'
    tx_signature TEXT NOT NULL,
    base_amount REAL NOT NULL,
    quote_amount REAL NOT NULL,
    price REAL NOT NULL,
    timestamp INTEGER NOT NULL,  -- Unix timestamp
    timestamp_pst TEXT NOT NULL, -- PST timestamp
    status TEXT NOT NULL,  -- 'pending', 'confirmed', 'failed'
    error TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_at_pst TEXT NOT NULL DEFAULT (datetime('now', 'localtime', '-8 hours')),
    FOREIGN KEY (pool_id) REFERENCES pending_pools(pool_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_pending_pools_state ON pending_pools(state);
CREATE INDEX IF NOT EXISTS idx_pending_pools_first_seen ON pending_pools(first_seen);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_pool_timestamp ON pool_snapshots(pool_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_timestamp ON pool_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_pool_timestamp ON trades(pool_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
`;

// Migration to add PST timestamp columns and convert existing data
const MIGRATION = `
-- Add PST timestamp columns to pending_pools
ALTER TABLE pending_pools ADD COLUMN first_seen_pst TEXT;
ALTER TABLE pending_pools ADD COLUMN exists_since_pst TEXT;
ALTER TABLE pending_pools ADD COLUMN ready_since_pst TEXT;
ALTER TABLE pending_pools ADD COLUMN failed_at_pst TEXT;
ALTER TABLE pending_pools ADD COLUMN last_checked_pst TEXT;
ALTER TABLE pending_pools ADD COLUMN last_readiness_check_pst TEXT;
ALTER TABLE pending_pools ADD COLUMN created_at_pst TEXT;
ALTER TABLE pending_pools ADD COLUMN updated_at_pst TEXT;

-- Add PST timestamp columns to pool_snapshots
ALTER TABLE pool_snapshots ADD COLUMN timestamp_pst TEXT;
ALTER TABLE pool_snapshots ADD COLUMN created_at_pst TEXT;

-- Add PST timestamp columns to trades
ALTER TABLE trades ADD COLUMN timestamp_pst TEXT;
ALTER TABLE trades ADD COLUMN created_at_pst TEXT;

-- Update existing records with PST timestamps
UPDATE pending_pools SET
    first_seen_pst = datetime(first_seen, 'unixepoch', 'localtime', '-8 hours'),
    exists_since_pst = CASE WHEN exists_since IS NOT NULL THEN datetime(exists_since, 'unixepoch', 'localtime', '-8 hours') ELSE NULL END,
    ready_since_pst = CASE WHEN ready_since IS NOT NULL THEN datetime(ready_since, 'unixepoch', 'localtime', '-8 hours') ELSE NULL END,
    failed_at_pst = CASE WHEN failed_at IS NOT NULL THEN datetime(failed_at, 'unixepoch', 'localtime', '-8 hours') ELSE NULL END,
    last_checked_pst = CASE WHEN last_checked IS NOT NULL THEN datetime(last_checked, 'unixepoch', 'localtime', '-8 hours') ELSE NULL END,
    last_readiness_check_pst = CASE WHEN last_readiness_check IS NOT NULL THEN datetime(last_readiness_check, 'unixepoch', 'localtime', '-8 hours') ELSE NULL END,
    created_at_pst = datetime(created_at, 'unixepoch', 'localtime', '-8 hours'),
    updated_at_pst = datetime(updated_at, 'unixepoch', 'localtime', '-8 hours');

UPDATE pool_snapshots SET
    timestamp_pst = datetime(timestamp, 'unixepoch', 'localtime', '-8 hours'),
    created_at_pst = datetime(created_at, 'unixepoch', 'localtime', '-8 hours');

UPDATE trades SET
    timestamp_pst = datetime(timestamp, 'unixepoch', 'localtime', '-8 hours'),
    created_at_pst = datetime(created_at, 'unixepoch', 'localtime', '-8 hours');
`;

// Initialize database using dynamic import
async function initDatabase() {
  const sqlite3 = await import('sqlite3');
  const db = new sqlite3.default.Database(dbPath);
  
  // Enable foreign keys
  await dbRun('PRAGMA foreign_keys = ON');
  
  try {
    // Create tables
    await dbExec(SCHEMA);
    
    // Run migration to add PST timestamps
    await dbExec(MIGRATION);
    
    console.log('Database initialized successfully with PST timestamps');
  } catch (err) {
    console.error('Error initializing database:', err);
    throw err;
  }
  
  return db;
}

// Export an async function to get the database instance
let dbInstance: any = null;
export async function getDb() {
  if (!dbInstance) {
    dbInstance = await initDatabase();
  }
  return dbInstance;
}

// Promisify common database operations
export async function dbRun(sql: string, params: any[] = []) {
  const db = await getDb();
  return promisify(db.run.bind(db))(sql, params);
}

export async function dbGet(sql: string, params: any[] = []) {
  const db = await getDb();
  return promisify(db.get.bind(db))(sql, params);
}

export async function dbAll(sql: string, params: any[] = []) {
  const db = await getDb();
  return promisify(db.all.bind(db))(sql, params);
}

export async function dbExec(sql: string) {
  const db = await getDb();
  return promisify(db.exec.bind(db))(sql);
}

// Export types for TypeScript
export interface PendingPool {
    pool_id: string;
    base_mint: string;
    quote_mint: string;
    base_decimals: number;
    quote_decimals: number;
    state: 'pending' | 'exists' | 'ready' | 'failed';
    first_seen: number;
    first_seen_pst: string;
    exists_since?: number;
    exists_since_pst?: string;
    ready_since?: number;
    ready_since_pst?: string;
    failed_at?: number;
    failed_at_pst?: string;
    error?: string;
    attempts: number;
    last_checked?: number;
    last_checked_pst?: string;
    last_readiness_check?: number;
    last_readiness_check_pst?: string;
    initial_price?: number;
    created_at: number;
    created_at_pst: string;
    updated_at: number;
    updated_at_pst: string;
}

export interface PoolSnapshot {
    id?: number;
    pool_id: string;
    timestamp: number;
    timestamp_pst: string;
    base_reserve: number;
    quote_reserve: number;
    base_reserve_raw: string;
    quote_reserve_raw: string;
    price: number;
    price_change?: number;
    tvl?: number;
    volume_24h?: number;
    volume_change?: number;
    buy_pressure?: number;
    sell_pressure?: number;
    market_pressure?: number;
    pressure_direction?: 'buy' | 'sell' | 'neutral';
    pressure_strength?: 'weak' | 'moderate' | 'strong';
    pressure_severity?: 'low' | 'medium' | 'high';
    trade_count?: number;
    trade_volume?: number;
    liquidity_change?: number;
    price_impact?: number;
    suspicious?: boolean;
    risk_score?: number;
    created_at: number;
    created_at_pst: string;
}

export interface Trade {
    trade_id: string;
    pool_id: string;
    trade_type: 'buy' | 'sell';
    tx_signature: string;
    base_amount: number;
    quote_amount: number;
    price: number;
    timestamp: number;
    timestamp_pst: string;
    status: 'pending' | 'confirmed' | 'failed';
    error?: string;
    created_at: number;
    created_at_pst: string;
} 