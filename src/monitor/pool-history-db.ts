// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3');
import * as path from 'path';

const dbPath = path.join(process.cwd(), 'pool_history.sqlite');
console.log(`[pool-history-db] Using SQLite DB at: ${dbPath}`);
const db = new Database(dbPath);

// Removed periodic health check setInterval

// Initialize schema
export function initPoolHistoryDB() {
  db.exec(`
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
  try {
    // Insert test row
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO pool_history
        (pool_id, base_symbol, quote_symbol, timestamp, price, tvl, base_reserve, quote_reserve, buy_pressure, rug_risk, trend, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      testData.poolId,
      testData.baseSymbol,
      testData.quoteSymbol,
      testData.timestamp,
      testData.price,
      testData.tvl,
      testData.baseReserve,
      testData.quoteReserve,
      testData.buyPressure,
      testData.rugRisk,
      testData.trend,
      testData.volume
    );
    // Read it back
    const row = db.prepare('SELECT * FROM pool_history WHERE pool_id = ?').get(testData.poolId);
    if (row) {
      console.log('[pool-history-db] Test DB write/read successful:', row);
      // Delete test row
      db.prepare('DELETE FROM pool_history WHERE pool_id = ?').run(testData.poolId);
      console.log('[pool-history-db] Test DB row deleted.');
    } else {
      console.error('[pool-history-db] Test DB write/read failed: row not found');
    }
  } catch (err) {
    console.error('[pool-history-db] Test DB write/read/delete error:', err);
  }
}

// Insert a new history record
export function insertPoolHistory({
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
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO pool_history
        (pool_id, base_symbol, quote_symbol, timestamp, price, tvl, base_reserve, quote_reserve, buy_pressure, rug_risk, trend, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
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
    );
  } catch (err) {
    console.error(`[pool-history-db] Failed to write to SQLite:`, err);
  }
}

// Insert a new swap transaction record
export function insertSwapTx({
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
    const stmt = db.prepare(`
      INSERT INTO swap_tx_history
        (pool_id, action, base_symbol, quote_symbol, amount_in, amount_out, tx_hash, status, error, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
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
    );
  } catch (err) {
    console.error(`[pool-history-db] Failed to write swap tx to SQLite:`, err);
  }
} 