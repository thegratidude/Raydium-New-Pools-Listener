import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { PoolMonitorManager } from './pool-monitor-manager';
import { TokenInfo } from '../types/token';

export interface PendingPool {
  pool_id: string;
  token_a: TokenInfo;
  token_b: TokenInfo;
  state: 'pending' | 'ready' | 'indexed' | 'failed';
  last_update_time: number;
  last_trade_time?: number;
  trade_count: number;
  reserve_changes: number;
}

@Injectable()
export class PendingPoolManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingPoolManager.name);
  private pendingPools: Map<string, PendingPool> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private reminderInterval: NodeJS.Timeout | null = null;
  private readonly MAX_WAIT_TIME = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_RETRIES = 3;
  private readonly CHECK_INTERVAL = 10000; // 10 seconds
  private readonly REMINDER_INTERVAL = 60000; // 1 minute
  private readonly TRADE_WINDOW = 30000; // 30 seconds to observe trades
  private onPoolReady: (pool: PendingPool) => void;
  private readonly poolMonitorManager?: PoolMonitorManager;
  private isInitialized = false;

  constructor(
    private readonly connection: Connection,
    onPoolReady: (pool: PendingPool) => void,
    poolMonitorManager?: PoolMonitorManager
  ) {
    this.onPoolReady = onPoolReady;
    this.poolMonitorManager = poolMonitorManager;
    this.logger.log('PendingPoolManager initialized');
  }

  async onModuleInit() {
    try {
      this.logger.log('[PendingPoolManager] Initializing...');
      this.isInitialized = true;
      
      // Start monitoring for any pools that are already in indexed state
      this.startMonitoringForExistingIndexedPools();
    } catch (error) {
      this.logger.error('[PendingPoolManager] Failed to initialize:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('[PendingPoolManager] Shutting down...');
    this.pendingPools.clear();
    this.isInitialized = false;
  }

  addPool(pool_id: string, token_a: TokenInfo, token_b: TokenInfo) {
    if (!this.isInitialized) {
      throw new Error('PendingPoolManager not initialized');
    }

    if (this.pendingPools.has(pool_id)) {
      this.logger.log(`[PendingPoolManager] Pool ${pool_id} already exists in pending state`);
      return;
    }

    this.logger.log(`[PendingPoolManager] Adding new pool to pending state: ${token_a.symbol}/${token_b.symbol} (${pool_id})`);
    
    this.pendingPools.set(pool_id, {
      pool_id,
      token_a,
      token_b,
      state: 'pending',
      last_update_time: Date.now(),
      trade_count: 0,
      reserve_changes: 0
    });
  }

  notifyTradeData(pool_id: string, update: { trade_count: number; reserve_change_percent: number; time_since_first_trade: number }) {
    if (!this.isInitialized) {
      throw new Error('PendingPoolManager not initialized');
    }

    const pool = this.pendingPools.get(pool_id);
    if (!pool) {
      this.logger.log(`[PendingPoolManager] Received trade data for unknown pool: ${pool_id}`);
      return;
    }

    if (pool.state === 'indexed') {
      pool.trade_count = update.trade_count;
      pool.reserve_changes = update.reserve_change_percent;
      
      if (!pool.last_trade_time) {
        pool.last_trade_time = Date.now() - update.time_since_first_trade;
        this.logger.log(`[PendingPoolManager] 🔥 First trade detected for pool ${pool_id}`);
      }

      // Only mark as ready if we've seen enough trades in the window
      if (update.trade_count >= 2 && update.time_since_first_trade <= this.TRADE_WINDOW) {
        this.logger.log(`[PendingPoolManager] 🎯 Pool ${pool_id} is ready! Seen ${update.trade_count} trades with ${update.reserve_change_percent.toFixed(2)}% reserve change`);
        pool.state = 'ready';
        this.onPoolReady(pool);
        this.pendingPools.delete(pool_id);
      }
    }
  }

  private checkPools() {
    const now = Date.now();
    let pendingCount = 0;
    let indexedCount = 0;
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

    for (const [pool_id, pool] of this.pendingPools.entries()) {
      const timeSinceCreation = now - pool.last_update_time;
      const timeSinceLastCheck = now - pool.last_update_time;
      pool.last_update_time = now;

      // Check if pool is older than 2 hours and remove it
      if (timeSinceCreation > TWO_HOURS_MS) {
        this.logger.log(`[PendingPoolManager] 🕐 Removing old pool ${pool_id} - ${Math.floor(timeSinceCreation / (60 * 60 * 1000))}h ${Math.floor((timeSinceCreation % (60 * 60 * 1000)) / (60 * 1000))}m old`);
        this.pendingPools.delete(pool_id);
        continue;
      }

      switch (pool.state) {
        case 'pending':
          pendingCount++;
          // Move to indexed state after initial delay
          if (timeSinceCreation >= 10000) { // 10 seconds
            this.logger.log(`[PendingPoolManager] Pool ${pool_id} moved to indexed state`);
            pool.state = 'indexed';
            // Start monitoring for first swaps when pool becomes indexed
            this.startMonitoringForFirstSwaps(pool);
          }
          break;

        case 'indexed':
          indexedCount++;
          // Check if we've waited too long for trade data
          if (timeSinceCreation >= this.MAX_WAIT_TIME) {
            this.logger.log(`[PendingPoolManager] Pool ${pool_id} failed to produce trade data after ${this.MAX_WAIT_TIME/1000}s`);
            pool.state = 'failed';
            this.pendingPools.delete(pool_id);
          }
          break;
      }
    }

    // Log status if we have any pending or indexed pools
    if (pendingCount > 0 || indexedCount > 0) {
      this.logger.log(`[PendingPoolManager] Status: ${pendingCount} pending, ${indexedCount} indexed pools`);
    }
  }

  private startMonitoringForFirstSwaps(pool: PendingPool) {
    if (!this.poolMonitorManager) {
      this.logger.error(`[PendingPoolManager] PoolMonitorManager not available, cannot start monitoring for pool ${pool.pool_id}`);
      return;
    }

    try {
      this.logger.log(`[PendingPoolManager] 🎧 Starting swap monitoring for indexed pool: ${pool.token_a.symbol}/${pool.token_b.symbol} (${pool.pool_id})`);
      
      // Add the pool to the PoolMonitorManager to start listening for first swaps
      this.poolMonitorManager.addPool({
        pool_id: pool.pool_id,
        token_a: pool.token_a,
        token_b: pool.token_b
      }).catch(error => {
        this.logger.error(`[PendingPoolManager] Failed to start monitoring for pool ${pool.pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
      });
      
    } catch (error) {
      this.logger.error(`[PendingPoolManager] Error starting swap monitoring for pool ${pool.pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private startReminderSystem() {
    this.reminderInterval = setInterval(() => {
      const now = Date.now();
      const pendingPools = Array.from(this.pendingPools.values())
        .filter(pool => pool.state === 'pending' || pool.state === 'indexed');

      if (pendingPools.length > 0) {
        this.logger.log('\n[PendingPoolManager] 🔄 Waiting for trades:');
        pendingPools.forEach(pool => {
          const waitTime = Math.floor((now - pool.last_update_time) / 1000);
          const status = pool.state === 'pending' ? '⏳ Pending' : '📊 Indexed';
          const tradeInfo = pool.trade_count > 0 
            ? ` (${pool.trade_count} trades, ${pool.reserve_changes.toFixed(2)}% reserve change)`
            : '';
          this.logger.log(`  • ${pool.token_a.symbol}/${pool.token_b.symbol} (${pool.pool_id.slice(0, 8)}...): ${status}${tradeInfo} (${waitTime}s)`);
        });
        this.logger.log(''); // Empty line for readability
      }
    }, this.REMINDER_INTERVAL);
  }

  start() {
    if (!this.checkInterval) {
      this.checkInterval = setInterval(() => this.checkPools(), this.CHECK_INTERVAL);
      this.startReminderSystem();
      this.logger.log('[PendingPoolManager] Started pool monitoring system');
    }
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }
    this.logger.log('[PendingPoolManager] Stopped pool monitoring system');
  }

  getPool(pool_id: string): PendingPool | undefined {
    if (!this.isInitialized) {
      throw new Error('PendingPoolManager not initialized');
    }
    return this.pendingPools.get(pool_id);
  }

  getAllPools(): PendingPool[] {
    if (!this.isInitialized) {
      throw new Error('PendingPoolManager not initialized');
    }
    return Array.from(this.pendingPools.values());
  }

  setPoolState(pool_id: string, state: 'pending' | 'ready' | 'indexed' | 'failed') {
    if (!this.isInitialized) {
      throw new Error('PendingPoolManager not initialized');
    }

    const pool = this.pendingPools.get(pool_id);
    if (!pool) {
      this.logger.log(`[PendingPoolManager] Cannot set state for unknown pool: ${pool_id}`);
      return;
    }

    pool.state = state;
    pool.last_update_time = Date.now();

    if (state === 'ready') {
      this.onPoolReady(pool);
      this.pendingPools.delete(pool_id);
    }
  }

  public removePool(pool_id: string) {
    this.pendingPools.delete(pool_id);
  }

  private startMonitoringForExistingIndexedPools() {
    if (!this.poolMonitorManager) {
      this.logger.warn('[PendingPoolManager] PoolMonitorManager not available, skipping existing indexed pools');
      return;
    }

    const now = Date.now();
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    
    const indexedPools = Array.from(this.pendingPools.values()).filter(pool => {
      if (pool.state !== 'indexed') return false;
      
      // Check if pool is older than 2 hours
      const poolAge = now - pool.last_update_time;
      if (poolAge > TWO_HOURS_MS) {
        this.logger.log(`[PendingPoolManager] 🕐 Skipping pool ${pool.pool_id} - too old (${Math.floor(poolAge / (60 * 60 * 1000))}h ${Math.floor((poolAge % (60 * 60 * 1000)) / (60 * 1000))}m old)`);
        // Remove old pools from tracking
        this.pendingPools.delete(pool.pool_id);
        return false;
      }
      
      return true;
    });
    
    if (indexedPools.length > 0) {
      this.logger.log(`[PendingPoolManager] 🎧 Starting swap monitoring for ${indexedPools.length} existing indexed pools (filtered out pools older than 2 hours)`);
      
      indexedPools.forEach(pool => {
        const poolAge = now - pool.last_update_time;
        const ageMinutes = Math.floor(poolAge / (60 * 1000));
        this.logger.log(`[PendingPoolManager] 📊 Pool ${pool.token_a.symbol}/${pool.token_b.symbol} (${pool.pool_id.slice(0, 8)}...) - ${ageMinutes}m old`);
        this.startMonitoringForFirstSwaps(pool);
      });
    } else {
      this.logger.log('[PendingPoolManager] No valid indexed pools to monitor (all were older than 2 hours)');
    }
  }
} 