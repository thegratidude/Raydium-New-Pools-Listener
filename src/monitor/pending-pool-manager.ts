import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { PoolMonitorManager } from './pool-monitor-manager';
import { TokenInfo } from '../types/token';
import * as fs from 'fs';
import * as path from 'path';

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
  private readonly MAX_WAIT_TIME = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_RETRIES = 3;
  private readonly CHECK_INTERVAL = 10000; // 10 seconds
  private readonly TRADE_WINDOW = 30000; // 30 seconds to observe trades
  private onPoolReady: (pool: PendingPool) => void;
  private readonly poolMonitorManager?: PoolMonitorManager;
  private isInitialized = false;
  private lastStatusLogTime = 0;
  private readonly STATUS_LOG_INTERVAL = 30000; // 30 seconds
  private readonly PENDING_POOLS_FILE = 'pending_pools.json';

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
      
      // Load pending pools from file
      await this.loadPendingPools();
      
      // Start monitoring for any pools that are already in indexed state
      this.startMonitoringForExistingIndexedPools();
    } catch (error) {
      this.logger.error('[PendingPoolManager] Failed to initialize:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('[PendingPoolManager] Shutting down...');
    
    // Save pending pools to file before clearing
    await this.savePendingPools();
    
    this.pendingPools.clear();
    this.isInitialized = false;
  }

  private async savePendingPools(): Promise<void> {
    try {
      const poolsData = Array.from(this.pendingPools.values()).map(pool => ({
        ...pool,
        // Convert TokenInfo objects to serializable format
        token_a: {
          symbol: pool.token_a.symbol,
          mint: pool.token_a.mint,
          decimals: pool.token_a.decimals
        },
        token_b: {
          symbol: pool.token_b.symbol,
          mint: pool.token_b.mint,
          decimals: pool.token_b.decimals
        }
      }));
      
      await fs.promises.writeFile(this.PENDING_POOLS_FILE, JSON.stringify(poolsData, null, 2));
      this.logger.log(`[PendingPoolManager] Saved ${poolsData.length} pending pools to file`);
    } catch (error) {
      this.logger.error('[PendingPoolManager] Failed to save pending pools:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async loadPendingPools(): Promise<void> {
    try {
      if (!fs.existsSync(this.PENDING_POOLS_FILE)) {
        this.logger.log('[PendingPoolManager] No pending pools file found, starting fresh');
        return;
      }

      const data = await fs.promises.readFile(this.PENDING_POOLS_FILE, 'utf8');
      const poolsData = JSON.parse(data) as any[];
      
      const now = Date.now();
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
      
      let loadedCount = 0;
      let expiredCount = 0;
      
      for (const poolData of poolsData) {
        // Check if pool is older than 2 hours
        const poolAge = now - poolData.last_update_time;
        if (poolAge > TWO_HOURS_MS) {
          expiredCount++;
          continue;
        }
        
        // Restore TokenInfo objects
        const pool: PendingPool = {
          pool_id: poolData.pool_id,
          token_a: {
            symbol: poolData.token_a.symbol,
            mint: poolData.token_a.mint,
            decimals: poolData.token_a.decimals
          },
          token_b: {
            symbol: poolData.token_b.symbol,
            mint: poolData.token_b.mint,
            decimals: poolData.token_b.decimals
          },
          state: poolData.state,
          last_update_time: poolData.last_update_time,
          last_trade_time: poolData.last_trade_time,
          trade_count: poolData.trade_count,
          reserve_changes: poolData.reserve_changes
        };
        
        this.pendingPools.set(pool.pool_id, pool);
        loadedCount++;
      }
      
      this.logger.log(`[PendingPoolManager] Loaded ${loadedCount} pending pools, skipped ${expiredCount} expired pools`);
    } catch (error) {
      this.logger.error('[PendingPoolManager] Failed to load pending pools:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  addPool(pool_id: string, token_a: TokenInfo, token_b: TokenInfo) {
    if (!this.isInitialized) {
      throw new Error('PendingPoolManager not initialized');
    }

    if (this.pendingPools.has(pool_id)) {
      this.logger.log(`[PendingPoolManager] Pool ${pool_id} already exists in pending state`);
      return;
    }

    this.logger.log(`[PendingPoolManager] Adding new pool to pending state: ${pool_id}`);
    
    this.pendingPools.set(pool_id, {
      pool_id,
      token_a,
      token_b,
      state: 'pending',
      last_update_time: Date.now(),
      trade_count: 0,
      reserve_changes: 0
    });

    // Save to file after adding
    this.savePendingPools().catch(error => {
      this.logger.error('[PendingPoolManager] Failed to save after adding pool:', error instanceof Error ? error.message : 'Unknown error');
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

      // Save to file after trade data update
      this.savePendingPools().catch(error => {
        this.logger.error('[PendingPoolManager] Failed to save after trade data update:', error instanceof Error ? error.message : 'Unknown error');
      });
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
        this.logger.log(`🕐 Removing old pool ${pool_id} - ${Math.floor(timeSinceCreation / (60 * 60 * 1000))}h ${Math.floor((timeSinceCreation % (60 * 60 * 1000)) / (60 * 1000))}m old`);
        this.pendingPools.delete(pool_id);
        continue;
      }

      switch (pool.state) {
        case 'pending':
          pendingCount++;
          // Move to indexed state after initial delay
          if (timeSinceCreation >= 10000) { // 10 seconds
            pool.state = 'indexed';
            // Start monitoring for first swaps when pool becomes indexed
            this.startMonitoringForFirstSwaps(pool);
          }
          break;

        case 'indexed':
          indexedCount++;
          // Check if we've waited too long for trade data
          if (timeSinceCreation >= this.MAX_WAIT_TIME) {
            this.logger.log(`Pool ${pool_id} failed to produce trade data after ${this.MAX_WAIT_TIME/1000}s`);
            pool.state = 'failed';
            this.pendingPools.delete(pool_id);
          }
          break;
      }
    }

    // Log consolidated status every 30 seconds
    if (this.shouldLogStatus()) {
      this.logStatusUpdate(pendingCount, indexedCount);
    }
  }

  private logStatusUpdate(pendingCount: number, indexedCount: number) {
    const now = Date.now();
    
    // Build status message
    let statusMessage = `Status: ${pendingCount} pending, ${indexedCount} indexed pools`;
    
    // Add individual pool details if there are any pools
    if (pendingCount > 0 || indexedCount > 0) {
      const pendingPools = Array.from(this.pendingPools.values())
        .filter(pool => pool.state === 'pending' || pool.state === 'indexed');
      
      if (pendingPools.length > 0) {
        statusMessage += '\n  Pools:';
        pendingPools.forEach(pool => {
          const waitTime = Math.floor((now - pool.last_update_time) / 1000);
          const poolIdShort = pool.pool_id.slice(0, 6);
          
          // Determine detailed status based on pool state and conditions
          let detailedStatus = '';
          let tradeInfo = '';
          
          if (pool.state === 'pending') {
            if (waitTime < 10) {
              detailedStatus = '⏳ Awaiting indexing (10s delay)';
            } else {
              detailedStatus = '🔄 Moving to indexed state...';
            }
          } else if (pool.state === 'indexed') {
            if (pool.trade_count === 0) {
              detailedStatus = '🎧 Awaiting first swaps';
            } else if (pool.trade_count === 1) {
              detailedStatus = '🔥 First trade detected, waiting for more';
            } else if (pool.trade_count >= 2) {
              detailedStatus = '📊 Multiple trades detected';
              tradeInfo = ` (${pool.trade_count} trades, ${pool.reserve_changes.toFixed(2)}% reserve change)`;
            }
            
            // Check if we're approaching timeout
            const timeUntilTimeout = this.MAX_WAIT_TIME - (waitTime * 1000);
            if (timeUntilTimeout < 60000 && timeUntilTimeout > 0) { // Less than 1 minute left
              detailedStatus += ` ⚠️ Timeout in ${Math.ceil(timeUntilTimeout / 1000)}s`;
            }
          }
          
          statusMessage += `\n    • ${poolIdShort}...: ${detailedStatus}${tradeInfo} (${waitTime}s)`;
        });
      }
    }
    
    this.logger.log(statusMessage);
  }

  private shouldLogStatus(): boolean {
    const now = Date.now();
    if (now - this.lastStatusLogTime > this.STATUS_LOG_INTERVAL) {
      this.lastStatusLogTime = now;
      return true;
    }
    return false;
  }

  private startMonitoringForFirstSwaps(pool: PendingPool) {
    if (!this.poolMonitorManager) {
      this.logger.error(`[PendingPoolManager] PoolMonitorManager not available, cannot start monitoring for pool ${pool.pool_id}`);
      return;
    }

    try {
      this.logger.log(`[PendingPoolManager] 🎧 Starting swap monitoring for indexed pool: ${pool.pool_id}`);
      
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
    // Removed - consolidated into 30-second status updates
  }

  start() {
    if (!this.checkInterval) {
      this.checkInterval = setInterval(() => this.checkPools(), this.CHECK_INTERVAL);
      this.logger.log('[PendingPoolManager] Started pool monitoring system');
    }
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
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

    // Save to file after state change
    this.savePendingPools().catch(error => {
      this.logger.error('[PendingPoolManager] Failed to save after state change:', error instanceof Error ? error.message : 'Unknown error');
    });
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
        this.logger.log(`🕐 Skipping pool ${pool.pool_id} - too old (${Math.floor(poolAge / (60 * 60 * 1000))}h ${Math.floor((poolAge % (60 * 60 * 1000)) / (60 * 1000))}m old)`);
        // Remove old pools from tracking
        this.pendingPools.delete(pool.pool_id);
        return false;
      }
      
      return true;
    });
    
    if (indexedPools.length > 0) {
      this.logger.log(`🎧 Starting swap monitoring for ${indexedPools.length} existing indexed pools (filtered out pools older than 2 hours)`);
      
      indexedPools.forEach(pool => {
        const poolAge = now - pool.last_update_time;
        const ageMinutes = Math.floor(poolAge / (60 * 1000));
        this.logger.log(`📊 Pool ${pool.pool_id} - ${ageMinutes}m old`);
        this.startMonitoringForFirstSwaps(pool);
      });
    } else {
      this.logger.log('[PendingPoolManager] No valid indexed pools to monitor (all were older than 2 hours)');
    }
  }
} 