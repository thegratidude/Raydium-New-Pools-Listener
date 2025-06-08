// Removed: import * as sqlite3 from 'sqlite3';
// Removed: const { Database } = sqlite3.default;
// Removed: type DatabaseType = InstanceType<typeof Database>;
import { TrendDirection } from './types.js';
import { getCurrentTimestamp } from './db-schema.js';
import { Logger } from '@nestjs/common';

type PoolState = 'pending' | 'exists' | 'ready' | 'failed';

export interface PoolSnapshot {
    pool_id: string;
    timestamp: number;
    base_reserve: number;
    quote_reserve: number;
    base_reserve_raw: string;
    quote_reserve_raw: string;
    price: number;
    price_change: number;
    tvl: number;
    volume_24h: number;
    volume_change: number;
    buy_pressure: number;
    sell_pressure: number;
    market_pressure: number;
    pressure_direction: TrendDirection;
    pressure_strength: number;
    pressure_severity: number;
    trade_count: number;
    trade_volume: number;
    liquidity_change: number;
    price_impact: number;
    suspicious: boolean;
    risk_score: number;
}

export interface PendingPool {
    pool_id: string;
    base_mint: string;
    quote_mint: string;
    base_decimals: number;
    quote_decimals: number;
    state: 'pending' | 'exists' | 'ready' | 'failed';
    first_seen: number;
    exists_since?: number;
    ready_since?: number;
    failed_at?: number;
    last_checked: number;
    last_readiness_check?: number;
    attempts: number;
    error?: string;
    initial_price?: number;
    created_at: number;
    updated_at: number;
}

export interface Trade {
    trade_id: string;
    pool_id: string;
    timestamp: number;
    trade_type: 'buy' | 'sell';
    base_amount: number;
    quote_amount: number;
    price: number;
    price_impact: number;
    status: 'pending' | 'confirmed' | 'failed';
    tx_signature?: string;
    error?: string;
}

export class DatabaseManager {
    private readonly logger = new Logger(DatabaseManager.name);
    private db: any;

    async init() {
        const sqlite3 = await import('sqlite3');
        this.db = new (sqlite3.default ? sqlite3.default.Database : sqlite3.Database)('trading_history.sqlite');
        this.initializeTables();
    }

    private initializeTables(): void {
        // Create tables if they don't exist
        this.db.serialize(() => {
            // Pending pools table
            this.db.run(`
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
                )
            `);

            // Pool snapshots table
            this.db.run(`
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
                )
            `);

            // Trades table
            this.db.run(`
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
                )
            `);

            // Create indexes
            this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_pools_state ON pending_pools(state)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_pools_first_seen ON pending_pools(first_seen)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_pool_snapshots_pool_timestamp ON pool_snapshots(pool_id, timestamp)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_pool_snapshots_timestamp ON pool_snapshots(timestamp)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_trades_pool_timestamp ON trades(pool_id, timestamp)');
            this.db.run('CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status)');
        });
    }

    // Pending Pool Methods
    public async addPendingPool(pool: PendingPool): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO pending_pools (
                    pool_id, base_mint, quote_mint, state, first_seen, last_checked,
                    created_at, updated_at, first_seen_pst, created_at_pst, updated_at_pst
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch', 'localtime', '-8 hours'), datetime(?, 'unixepoch', 'localtime', '-8 hours'), datetime(?, 'unixepoch', 'localtime', '-8 hours'))`,
                [
                    pool.pool_id, pool.base_mint, pool.quote_mint, pool.state, pool.first_seen, pool.last_checked,
                    pool.created_at, pool.updated_at, pool.first_seen, pool.created_at, pool.updated_at
                ],
                (err) => {
                    if (err) {
                        console.error('Error adding pending pool:', err);
                        reject(err);
                        return;
                    }
                    resolve(true);
                }
            );
        });
    }

    public async updatePendingPool(poolId: string, updates: Partial<PendingPool>): Promise<void> {
        return new Promise((resolve, reject) => {
            const setClause = Object.keys(updates)
                .map(key => `${key} = ?`)
                .join(', ');
            const values = [...Object.values(updates), poolId];

            this.db.run(
                `UPDATE pending_pools SET ${setClause} WHERE pool_id = ?`,
                values,
                (err) => {
                    if (err) {
                        console.error('Error updating pending pool:', err);
                        reject(err);
                        return;
                    }
                    resolve();
                }
            );
        });
    }

    public async getAllPendingPools(): Promise<PendingPool[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM pending_pools 
                 WHERE state IN ('pending', 'exists')
                 ORDER BY first_seen ASC`,
                [],
                (err, rows) => {
                    if (err) {
                        console.error('Error getting all pending pools:', err);
                        reject(err);
                        return;
                    }
                    resolve(rows as PendingPool[]);
                }
            );
        });
    }

    public async getPendingPool(poolIdOrState: string): Promise<PendingPool | null> {
        return new Promise((resolve, reject) => {
            // If it's a pool ID (longer than 10 chars), get by ID
            if (poolIdOrState.length > 10) {
                this.db.get(
                    'SELECT * FROM pending_pools WHERE pool_id = ?',
                    [poolIdOrState],
                    (err, row) => {
                        if (err) {
                            console.error('Error getting pending pool by ID:', err);
                            reject(err);
                            return;
                        }
                        resolve(row as PendingPool || null);
                    }
                );
            } else {
                // Otherwise get by state
                this.db.get(
                    'SELECT * FROM pending_pools WHERE state = ? ORDER BY first_seen ASC LIMIT 1',
                    [poolIdOrState],
                    (err, row) => {
                        if (err) {
                            console.error('Error getting pending pool by state:', err);
                            reject(err);
                            return;
                        }
                        resolve(row as PendingPool || null);
                    }
                );
            }
        });
    }

    public async getPendingPoolsByState(state: string): Promise<PendingPool[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM pending_pools WHERE state = ?',
                [state],
                (err, rows) => {
                    if (err) {
                        console.error('Error getting pending pools by state:', err);
                        reject(err);
                        return;
                    }
                    resolve(rows as PendingPool[]);
                }
            );
        });
    }

    public async getOldPools(cutoffTime: number): Promise<PendingPool[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM pending_pools 
                 WHERE first_seen < ? 
                 AND state = 'pending'
                 ORDER BY first_seen ASC`,
                [cutoffTime],
                (err, rows) => {
                    if (err) {
                        console.error('Error getting old pending pools:', err);
                        reject(err);
                        return;
                    }
                    resolve(rows as PendingPool[]);
                }
            );
        });
    }

    // Pool Snapshot Methods
    public async addPoolSnapshot(snapshot: PoolSnapshot): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO pool_snapshots (
                    pool_id, timestamp, base_reserve, quote_reserve, base_reserve_raw,
                    quote_reserve_raw, price, price_change, tvl, volume_24h,
                    volume_change, buy_pressure, sell_pressure, market_pressure,
                    pressure_direction, pressure_strength, pressure_severity,
                    trade_count, trade_volume, liquidity_change, price_impact,
                    suspicious, risk_score
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    snapshot.pool_id,
                    snapshot.timestamp,
                    snapshot.base_reserve,
                    snapshot.quote_reserve,
                    snapshot.base_reserve_raw,
                    snapshot.quote_reserve_raw,
                    snapshot.price,
                    snapshot.price_change,
                    snapshot.tvl,
                    snapshot.volume_24h,
                    snapshot.volume_change,
                    snapshot.buy_pressure,
                    snapshot.sell_pressure,
                    snapshot.market_pressure,
                    snapshot.pressure_direction,
                    snapshot.pressure_strength,
                    snapshot.pressure_severity,
                    snapshot.trade_count,
                    snapshot.trade_volume,
                    snapshot.liquidity_change,
                    snapshot.price_impact,
                    snapshot.suspicious ? 1 : 0,
                    snapshot.risk_score
                ],
                (err) => {
                    if (err) {
                        console.error('Error adding pool snapshot:', err);
                        reject(err);
                        return;
                    }
                    resolve(true);
                }
            );
        });
    }

    public async getPoolSnapshots(
        poolId: string,
        startTime?: number,
        endTime?: number,
        limit: number = 100
    ): Promise<PoolSnapshot[]> {
        return new Promise((resolve, reject) => {
            let query = 'SELECT * FROM pool_snapshots WHERE pool_id = ?';
            const params: any[] = [poolId];

            if (startTime) {
                query += ' AND timestamp >= ?';
                params.push(startTime);
            }
            if (endTime) {
                query += ' AND timestamp <= ?';
                params.push(endTime);
            }

            query += ' ORDER BY timestamp DESC LIMIT ?';
            params.push(limit);

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('Error getting pool snapshots:', err);
                    reject(err);
                    return;
                }
                resolve(rows.map(row => {
                    const typedRow = row as {
                        pool_id: string;
                        timestamp: number;
                        base_reserve: number;
                        quote_reserve: number;
                        base_reserve_raw: string;
                        quote_reserve_raw: string;
                        price: number;
                        price_change: number;
                        tvl: number;
                        volume_24h: number;
                        volume_change: number;
                        buy_pressure: number;
                        sell_pressure: number;
                        market_pressure: number;
                        pressure_direction: string;
                        pressure_strength: number;
                        pressure_severity: number;
                        trade_count: number;
                        trade_volume: number;
                        liquidity_change: number;
                        price_impact: number;
                        suspicious: number;
                        risk_score: number;
                    };
                    return {
                        pool_id: typedRow.pool_id,
                        timestamp: typedRow.timestamp,
                        base_reserve: typedRow.base_reserve,
                        quote_reserve: typedRow.quote_reserve,
                        base_reserve_raw: typedRow.base_reserve_raw,
                        quote_reserve_raw: typedRow.quote_reserve_raw,
                        price: typedRow.price,
                        price_change: typedRow.price_change,
                        tvl: typedRow.tvl,
                        volume_24h: typedRow.volume_24h,
                        volume_change: typedRow.volume_change,
                        buy_pressure: typedRow.buy_pressure,
                        sell_pressure: typedRow.sell_pressure,
                        market_pressure: typedRow.market_pressure,
                        pressure_direction: typedRow.pressure_direction as TrendDirection,
                        pressure_strength: typedRow.pressure_strength,
                        pressure_severity: typedRow.pressure_severity,
                        trade_count: typedRow.trade_count,
                        trade_volume: typedRow.trade_volume,
                        liquidity_change: typedRow.liquidity_change,
                        price_impact: typedRow.price_impact,
                        suspicious: Boolean(typedRow.suspicious),
                        risk_score: typedRow.risk_score
                    };
                }));
            });
        });
    }

    // Trade Methods
    public async addTrade(trade: Trade): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO trades (
                    trade_id, pool_id, timestamp, trade_type, base_amount,
                    quote_amount, price, price_impact, status, tx_signature, error
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    trade.trade_id,
                    trade.pool_id,
                    trade.timestamp,
                    trade.trade_type,
                    trade.base_amount,
                    trade.quote_amount,
                    trade.price,
                    trade.price_impact,
                    trade.status,
                    trade.tx_signature,
                    trade.error
                ],
                (err) => {
                    if (err) {
                        this.logger.error('Error adding trade:', err);
                        reject(err);
                        return;
                    }
                    resolve(true);
                }
            );
        });
    }

    public async updateTradeStatus(
        tradeId: string,
        status: 'confirmed' | 'failed',
        txSignature?: string,
        error?: string
    ): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE trades SET
                    status = ?,
                    tx_signature = ?,
                    error = ?
                WHERE trade_id = ?`,
                [status, txSignature, error, tradeId],
                (err) => {
                    if (err) {
                        console.error('Error updating trade status:', err);
                        reject(err);
                        return;
                    }
                    resolve(true);
                }
            );
        });
    }

    public async getPoolTrades(
        poolId: string,
        startTime?: number,
        endTime?: number,
        limit: number = 100
    ): Promise<Trade[]> {
        return new Promise((resolve, reject) => {
            let query = 'SELECT * FROM trades WHERE pool_id = ?';
            const params: any[] = [poolId];

            if (startTime) {
                query += ' AND timestamp >= ?';
                params.push(startTime);
            }
            if (endTime) {
                query += ' AND timestamp <= ?';
                params.push(endTime);
            }

            query += ' ORDER BY timestamp DESC LIMIT ?';
            params.push(limit);

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('Error getting pool trades:', err);
                    reject(err);
                    return;
                }
                resolve(rows as Trade[]);
            });
        });
    }

    // Utility Methods
    public async getPoolStats(poolId: string): Promise<any> {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT
                    p.*,
                    COUNT(DISTINCT t.trade_id) as total_trades,
                    SUM(CASE WHEN t.trade_type = 'buy' THEN t.base_amount ELSE 0 END) as total_buy_volume,
                    SUM(CASE WHEN t.trade_type = 'sell' THEN t.base_amount ELSE 0 END) as total_sell_volume,
                    AVG(s.price) as avg_price,
                    MIN(s.price) as min_price,
                    MAX(s.price) as max_price,
                    AVG(s.tvl) as avg_tvl,
                    MAX(s.tvl) as max_tvl
                FROM pending_pools p
                LEFT JOIN trades t ON p.pool_id = t.pool_id
                LEFT JOIN pool_snapshots s ON p.pool_id = s.pool_id
                WHERE p.pool_id = ?
                GROUP BY p.pool_id`,
                [poolId],
                (err, row) => {
                    if (err) {
                        console.error('Error getting pool stats:', err);
                        reject(err);
                        return;
                    }
                    resolve(row);
                }
            );
        });
    }

    public close(): void {
        this.db.close();
    }
} 