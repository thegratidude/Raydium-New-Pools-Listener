import { Logger } from '@nestjs/common';
import * as path from 'path';
import { promisify } from 'util';

const logger = new Logger('PoolHistoryDB');
const dbPath = path.join(process.cwd(), 'pool_history.sqlite');

// Export initialized database operations
let db: any;
let dbRun: any;
let dbGet: any;
let dbAll: any;
let dbExec: any;

// Initialize database using dynamic import
async function initDatabase() {
  // Suppress bigint warning for SQLite
  process.env.NODE_NO_WARNINGS = '1';
  
  const sqlite3 = await import('sqlite3');
  const db = new sqlite3.default.Database(dbPath);
  
  // Promisify common database operations
  const dbRun = promisify(db.run.bind(db));
  const dbGet = promisify(db.get.bind(db));
  const dbAll = promisify(db.all.bind(db));
  const dbExec = promisify(db.exec.bind(db));
  
  // Enable foreign keys
  await dbRun('PRAGMA foreign_keys = ON');
  
  try {
    // Create tables
    await dbExec(`
      CREATE TABLE IF NOT EXISTS pool_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pool_id TEXT,
        base_symbol TEXT,
        quote_symbol TEXT,
        timestamp INTEGER,
        price REAL,
        tvl REAL,
        base_reserve REAL,
        quote_reserve REAL,
        buy_pressure REAL,
        rug_risk REAL,
        trend TEXT,
        volume REAL,
        UNIQUE(pool_id, timestamp)
      );
      CREATE INDEX IF NOT EXISTS idx_pool_time ON pool_history(pool_id, timestamp);
      
      -- New table for swap transactions
      CREATE TABLE IF NOT EXISTS swap_tx_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pool_id TEXT,
        action TEXT,
        base_symbol TEXT,
        quote_symbol TEXT,
        amount_in REAL,
        amount_out REAL,
        tx_hash TEXT,
        status TEXT,
        error TEXT,
        timestamp INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_swap_tx_time ON swap_tx_history(pool_id, timestamp);
    `);
    
    logger.debug('Database initialized');
  } catch (err) {
    logger.error('Error initializing database:', err);
    throw err;
  }
  
  return { db, dbRun, dbGet, dbAll, dbExec };
}

export async function initPoolHistoryDB() {
  try {
    // Initialize database and get DB operations
    const result = await initDatabase();
    db = result.db;
    dbRun = result.dbRun;
    dbGet = result.dbGet;
    dbAll = result.dbAll;
    dbExec = result.dbExec;
    
    // Test DB write/read/delete after schema is created (startup only)
    const testData = {
      poolId: '__test__',
      baseSymbol: 'TEST',
      quoteSymbol: 'TEST',
      timestamp: Math.floor(Date.now() / 1000),
      price: 1.23,
      tvl: 12345,
      baseReserve: 100,
      quoteReserve: 200,
      buyPressure: 50,
      rugRisk: 10,
      trend: 'sideways',
      volume: 999,
    };

    await insertPoolHistory(testData);
    logger.debug('Database initialized and tested');
  } catch (err) {
    logger.error('Error initializing database:', err);
    throw err;
  }
}

// Insert a new history record
export async function insertPoolHistory({
  poolId,
  baseSymbol,
  quoteSymbol,
  timestamp,
  price,
  tvl,
  baseReserve,
  quoteReserve,
  buyPressure,
  rugRisk,
  trend,
  volume,
}: {
  poolId: string;
  baseSymbol: string;
  quoteSymbol: string;
  timestamp: number;
  price: number;
  tvl: number;
  baseReserve: number;
  quoteReserve: number;
  buyPressure: number;
  rugRisk: number;
  trend: string;
  volume: number;
}) {
  try {
    await dbRun(
      `INSERT OR IGNORE INTO pool_history
        (pool_id, base_symbol, quote_symbol, timestamp, price, tvl, base_reserve, quote_reserve, buy_pressure, rug_risk, trend, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        poolId,
        baseSymbol,
        quoteSymbol,
        timestamp,
        price,
        tvl,
        baseReserve,
        quoteReserve,
        buyPressure,
        rugRisk,
        trend,
        volume
      ]
    );
  } catch (err) {
    logger.error(`Failed to write to SQLite:`, err);
    throw err;
  }
}

// Insert a new swap transaction record
export async function insertSwapTx({
  poolId,
  action,
  baseSymbol,
  quoteSymbol,
  amountIn,
  amountOut,
  txHash,
  status,
  error,
  timestamp,
}: {
  poolId: string;
  action: 'buy' | 'sell';
  baseSymbol: string;
  quoteSymbol: string;
  amountIn: number;
  amountOut: number;
  txHash: string;
  status: string;
  error?: string;
  timestamp: number;
}) {
  try {
    await dbRun(
      `INSERT INTO swap_tx_history
        (pool_id, action, base_symbol, quote_symbol, amount_in, amount_out, tx_hash, status, error, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        poolId,
        action,
        baseSymbol,
        quoteSymbol,
        amountIn,
        amountOut,
        txHash,
        status,
        error || '',
        timestamp
      ]
    );
  } catch (err) {
    logger.error(`Failed to write swap tx to SQLite:`, err);
    throw err;
  }
}

// Removed periodic health check setInterval

// Delete everything from here to the end of the file 