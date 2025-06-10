import * as sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import * as path from 'path';
import * as fs from 'fs';
import { Injectable } from '@nestjs/common';

// Simplified types for our database entities
export interface Status6Pool {
  id?: number;
  pool_id: string;
  token_a_mint: string;
  token_b_mint: string;
  base_vault: string;
  quote_vault: string;
  lp_mint: string;
  market_id: string;
  amm_open_orders: string;
  trade_fee: number;
  swap_fee: number;
  min_size: number;
  price_range_min: number;
  price_range_max: number;
  decimals_a: number;
  decimals_b: number;
  order_book_depth: number;
  pool_open_time: number;
  detected_at: number;
  analysis_status?: 'pending' | 'analyzed' | 'traded' | 'ignored';
  created_at?: string;
}

export interface PoolSnapshot {
  id?: number;
  pool_id: string;
  timestamp: number;
  price?: number;
  base_reserve?: number;
  quote_reserve?: number;
  volume_24h?: number;
  created_at?: string;
}

export interface TradeHistory {
  id?: number;
  pool_id: string;
  tx_signature: string;
  trade_type: 'buy' | 'sell' | 'swap';
  base_amount?: number;
  quote_amount?: number;
  price?: number;
  block_time?: number;
  created_at?: string;
}

@Injectable()
export class PositionManagerDB {
  private db: Database | null = null;
  private dbPath: string;

  constructor() {
    this.dbPath = path.join(process.cwd(), 'position_manager.sqlite');
  }

  async initialize(): Promise<void> {
    try {
      // Ensure the database directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Open the database
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      // Simple schema with just essential fields
      const schema = `
-- Simple Position Manager Database Schema
-- Just the essential fields for basic trading and pool state tracking

-- Status 6 Pools table: Basic pool metadata
CREATE TABLE IF NOT EXISTS status_6_pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT UNIQUE NOT NULL,
    token_a_mint TEXT NOT NULL,
    token_b_mint TEXT NOT NULL,
    base_vault TEXT NOT NULL,
    quote_vault TEXT NOT NULL,
    lp_mint TEXT NOT NULL,
    market_id TEXT NOT NULL,
    amm_open_orders TEXT NOT NULL,
    trade_fee REAL NOT NULL,
    swap_fee REAL NOT NULL,
    min_size REAL NOT NULL,
    price_range_min REAL NOT NULL,
    price_range_max REAL NOT NULL,
    decimals_a INTEGER NOT NULL,
    decimals_b INTEGER NOT NULL,
    order_book_depth INTEGER NOT NULL,
    pool_open_time INTEGER NOT NULL,
    detected_at INTEGER NOT NULL,
    analysis_status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pool Snapshots table: Track pool state over time
CREATE TABLE IF NOT EXISTS pool_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    price REAL,
    base_reserve REAL,
    quote_reserve REAL,
    volume_24h REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pool_id) REFERENCES status_6_pools(pool_id)
);

-- Trade History table: Track trades for analysis
CREATE TABLE IF NOT EXISTS trade_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    tx_signature TEXT UNIQUE NOT NULL,
    trade_type TEXT NOT NULL,
    base_amount REAL,
    quote_amount REAL,
    price REAL,
    block_time INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pool_id) REFERENCES status_6_pools(pool_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_status_6_pools_pool_id ON status_6_pools(pool_id);
CREATE INDEX IF NOT EXISTS idx_status_6_pools_detected_at ON status_6_pools(detected_at);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_pool_id ON pool_snapshots(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_timestamp ON pool_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_trade_history_pool_id ON trade_history(pool_id);
CREATE INDEX IF NOT EXISTS idx_trade_history_tx_signature ON trade_history(tx_signature);
      `;

      // Execute the schema
      await this.db.exec(schema);

      console.log(`✅ Position Manager Database initialized at: ${this.dbPath}`);
    } catch (error) {
      console.error('❌ Failed to initialize Position Manager Database:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  // Status 6 Pools methods
  async insertStatus6Pool(pool: Status6Pool): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(`
      INSERT INTO status_6_pools (
        pool_id, token_a_mint, token_b_mint, base_vault, quote_vault, lp_mint, market_id,
        amm_open_orders, trade_fee, swap_fee, min_size, price_range_min, price_range_max,
        decimals_a, decimals_b, order_book_depth, pool_open_time, detected_at, analysis_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      pool.pool_id, pool.token_a_mint, pool.token_b_mint, pool.base_vault, pool.quote_vault,
      pool.lp_mint, pool.market_id, pool.amm_open_orders, pool.trade_fee, pool.swap_fee,
      pool.min_size, pool.price_range_min, pool.price_range_max, pool.decimals_a, pool.decimals_b,
      pool.order_book_depth, pool.pool_open_time, pool.detected_at, pool.analysis_status || 'pending'
    ]);

    return result.lastID!;
  }

  async getStatus6Pool(poolId: string): Promise<Status6Pool | null> {
    if (!this.db) throw new Error('Database not initialized');

    const pool = await this.db.get('SELECT * FROM status_6_pools WHERE pool_id = ?', [poolId]);
    return pool || null;
  }

  async updateStatus6Pool(poolId: string, updates: Partial<Status6Pool>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const setClause = Object.keys(updates)
      .filter(key => key !== 'id' && key !== 'pool_id' && key !== 'created_at')
      .map(key => `${key} = ?`)
      .join(', ');

    const values = Object.keys(updates)
      .filter(key => key !== 'id' && key !== 'pool_id' && key !== 'created_at')
      .map(key => (updates as any)[key]);

    if (setClause) {
      await this.db.run(
        `UPDATE status_6_pools SET ${setClause} WHERE pool_id = ?`,
        [...values, poolId]
      );
    }
  }

  async getPendingPools(): Promise<Status6Pool[]> {
    if (!this.db) throw new Error('Database not initialized');

    return await this.db.all(
      'SELECT * FROM status_6_pools WHERE analysis_status = "pending" ORDER BY detected_at DESC'
    );
  }

  async getRecentPools(limit: number = 50): Promise<Status6Pool[]> {
    if (!this.db) throw new Error('Database not initialized');

    return await this.db.all(
      'SELECT * FROM status_6_pools ORDER BY detected_at DESC LIMIT ?',
      [limit]
    );
  }

  // Pool Snapshot methods
  async insertPoolSnapshot(snapshot: PoolSnapshot): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(`
      INSERT INTO pool_snapshots (
        pool_id, timestamp, price, base_reserve, quote_reserve, volume_24h
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      snapshot.pool_id, snapshot.timestamp, snapshot.price,
      snapshot.base_reserve, snapshot.quote_reserve, snapshot.volume_24h
    ]);

    return result.lastID!;
  }

  async getPoolSnapshots(poolId: string, limit: number = 100): Promise<PoolSnapshot[]> {
    if (!this.db) throw new Error('Database not initialized');

    return await this.db.all(
      'SELECT * FROM pool_snapshots WHERE pool_id = ? ORDER BY timestamp DESC LIMIT ?',
      [poolId, limit]
    );
  }

  // Trade History methods
  async insertTradeHistory(trade: TradeHistory): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(`
      INSERT INTO trade_history (
        pool_id, tx_signature, trade_type, base_amount, quote_amount, price, block_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      trade.pool_id, trade.tx_signature, trade.trade_type,
      trade.base_amount, trade.quote_amount, trade.price, trade.block_time
    ]);

    return result.lastID!;
  }

  async getTradeHistory(poolId: string, limit: number = 100): Promise<TradeHistory[]> {
    if (!this.db) throw new Error('Database not initialized');

    return await this.db.all(
      'SELECT * FROM trade_history WHERE pool_id = ? ORDER BY block_time DESC LIMIT ?',
      [poolId, limit]
    );
  }

  // Utility methods
  async getDatabaseStats(): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');

    const stats = await this.db.all(`
      SELECT 
        (SELECT COUNT(*) FROM status_6_pools) as total_pools,
        (SELECT COUNT(*) FROM status_6_pools WHERE analysis_status = 'pending') as pending_pools,
        (SELECT COUNT(*) FROM pool_snapshots) as total_snapshots,
        (SELECT COUNT(*) FROM trade_history) as total_trades
    `);

    return stats[0];
  }

  async updatePoolStatus(poolId: string, status: 'pending' | 'analyzed' | 'traded' | 'inactive'): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(`
      UPDATE status_6_pools SET analysis_status = ? WHERE pool_id = ?
    `, [status, poolId]);
  }
}