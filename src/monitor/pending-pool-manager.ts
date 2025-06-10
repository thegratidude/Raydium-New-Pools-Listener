import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitorManager } from './pool-monitor-manager';
import { SocketService } from '../gateway/socket.service';
import { TokenInfo } from '../types/token';
import { LIQUIDITY_STATE_LAYOUT_V4, decodeRaydiumPoolState } from './raydium-layout';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

export interface PendingPool {
  pool_id: string;
  token_a: TokenInfo;
  token_b: TokenInfo;
  state: 'pending' | 'ready' | 'indexed' | 'failed';
  last_update_time: number;
  last_trade_time?: number;
  trade_count: number;
  reserve_changes: number;
  initialize2_detected_at: number;
  status_6_detected_at?: number;
}

@Injectable()
export class PendingPoolManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingPoolManager.name);
  private pendingPools: Map<string, PendingPool> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private status6SubscriptionId: number | null = null;
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
    poolMonitorManager?: PoolMonitorManager,
    private readonly socketService?: SocketService
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
      
      // Start status 6 monitoring
      await this.startStatus6Monitoring();
      
      // Start monitoring for any pools that are already in indexed state
      this.startMonitoringForExistingIndexedPools();
    } catch (error) {
      this.logger.error('[PendingPoolManager] Failed to initialize:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('[PendingPoolManager] Shutting down...');
    
    // Remove status 6 subscription
    if (this.status6SubscriptionId !== null) {
      try {
        await this.connection.removeProgramAccountChangeListener(this.status6SubscriptionId);
        this.logger.log('[PendingPoolManager] Removed status 6 listener');
      } catch (error) {
        this.logger.error('[PendingPoolManager] Error removing status 6 listener:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
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
          reserve_changes: poolData.reserve_changes,
          initialize2_detected_at: poolData.initialize2_detected_at,
          status_6_detected_at: poolData.status_6_detected_at
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
      reserve_changes: 0,
      initialize2_detected_at: Date.now()
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
    
    // Add monitor status if available
    if (this.poolMonitorManager) {
      const activeMonitors = this.poolMonitorManager.getActiveMonitorCount();
      statusMessage += ` | ${activeMonitors} active monitors`;
    }
    
    // Add individual pool details if there are any pools
    if (pendingCount > 0 || indexedCount > 0) {
      const pendingPools = Array.from(this.pendingPools.values())
        .filter(pool => pool.state === 'pending' || pool.state === 'indexed');
      
      if (pendingPools.length > 0) {
        statusMessage += '\n  Pools:';
        pendingPools.forEach(pool => {
          const waitTime = Math.floor((now - pool.last_update_time) / 1000);
          const poolIdShort = pool.pool_id.substring(0, 6);
          
          let status = '';
          if (pool.state === 'pending') {
            status = `⏳ Awaiting indexing (${waitTime}s)`;
          } else if (pool.state === 'indexed') {
            if (pool.trade_count === 0) {
              status = `🎧 Awaiting first swaps (${waitTime}s)`;
            } else if (pool.trade_count === 1) {
              status = `🔥 First trade detected, waiting for more (${waitTime}s)`;
            } else {
              status = `📊 Multiple trades detected (${pool.trade_count} trades, ${pool.reserve_changes.toFixed(2)}% reserve change) (${waitTime}s)`;
            }
          }
          
          // Add timeout warning
          if (waitTime > 240) { // 4 minutes
            status += ` ⚠️ Timeout in ${300 - waitTime}s`;
          }
          
          statusMessage += `\n    • ${poolIdShort}...: ${status}`;
        });
      }
    }
    
    this.logger.log(`[PendingPoolManager] ${statusMessage}`);
    this.lastStatusLogTime = now;
    
    // Log monitor status every 30 seconds
    if (this.poolMonitorManager && (now - this.lastStatusLogTime) > 30000) {
      this.poolMonitorManager.logMonitorStatus();
    }
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

  private async startStatus6Monitoring() {
    try {
      this.logger.log('[PendingPoolManager] 🎯 Starting status 6 monitoring...');
      
      this.status6SubscriptionId = this.connection.onProgramAccountChange(
        RAYDIUM_PROGRAM_ID,
        async (updatedAccountInfo) => {
          await this.handleStatus6Detection(updatedAccountInfo);
        },
        'confirmed',
        [
          { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
          { 
            memcmp: { 
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
              bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]) // Status 6 in little-endian
            }
          }
        ]
      );

      this.logger.log('[PendingPoolManager] ✅ Status 6 monitoring active');
    } catch (error) {
      this.logger.error('[PendingPoolManager] Failed to start status 6 monitoring:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  private async handleStatus6Detection(updatedAccountInfo: any) {
    try {
      const poolId = updatedAccountInfo.accountId.toString();
      
      // Check if this is a pool we're tracking
      const pendingPool = this.pendingPools.get(poolId);
      if (!pendingPool) {
        return; // Not tracking this pool
      }

      // Decode the pool state
      const poolState = decodeRaydiumPoolState(updatedAccountInfo.accountInfo.data);
      if (!poolState) {
        return;
      }

      // Verify it's actually status 6
      if (poolState.status !== 6) {
        return;
      }

      // Filter out legacy pools (poolOpenTime: 0)
      if (poolState.poolOpenTime === 0) {
        this.logger.debug(`[PendingPoolManager] Skipping legacy pool ${poolId} (poolOpenTime: 0)`);
        return;
      }

      // Check if pool is actually open for trading
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime < poolState.poolOpenTime) {
        this.logger.debug(`[PendingPoolManager] Pool ${poolId} status 6 but not yet open`);
        return;
      }

      // 🎯 STATUS 6 DETECTED FOR TRACKED POOL!
      this.logger.log(`[PendingPoolManager] 🏌️‍♂️ SWING DETECTED! Pool ${poolId} hit status 6!`);
      this.logger.log(`[PendingPoolManager] ⏱️  Time from initialize2 to status 6: ${Math.floor((Date.now() - pendingPool.initialize2_detected_at) / 1000)}s`);
      
      // Update pool state
      pendingPool.status_6_detected_at = Date.now();
      pendingPool.state = 'ready';
      pendingPool.last_update_time = Date.now();

      // Broadcast status 6 detection to port 5001
      await this.broadcastStatus6Detection(pendingPool);

      // Call the pool ready handler
      this.onPoolReady(pendingPool);

      // Remove from pending pools (mission accomplished)
      this.pendingPools.delete(poolId);
      this.logger.log(`[PendingPoolManager] ✅ Pool ${poolId} removed from pending list`);

    } catch (error) {
      this.logger.error(`[PendingPoolManager] Error handling status 6 detection:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async broadcastStatus6Detection(pool: PendingPool) {
    try {
      const timeFromInitialize2 = Math.floor((Date.now() - pool.initialize2_detected_at) / 1000);
      
      const message = {
        event: 'status_6_detected',
        pool_id: pool.pool_id,
        timestamp: Date.now(),
        data: {
          base_token: pool.token_a.symbol,
          quote_token: pool.token_b.symbol,
          base_mint: pool.token_a.mint,
          quote_mint: pool.token_b.mint,
          time_from_initialize2_seconds: timeFromInitialize2,
          initialize2_detected_at: new Date(pool.initialize2_detected_at).toISOString(),
          status_6_detected_at: new Date(pool.status_6_detected_at!).toISOString(),
          detection_method: 'hybrid_initialize2_to_status6'
        }
      };

      // Broadcast to port 5001 via SocketService
      this.logger.log(`[PendingPoolManager] 📢 Broadcasting status 6 detection to port 5001: ${pool.pool_id}`);
      this.logger.log(`[PendingPoolManager] ⏱️  Time from initialize2 to status 6: ${timeFromInitialize2}s`);
      
      // Use the socket service to broadcast
      if (this.socketService) {
        this.socketService.broadcast('status_6_detected', message);
      } else {
        // Fallback: log the message
        console.log('🚀 STATUS 6 DETECTED - SEND TO PORT 5001:', JSON.stringify(message, null, 2));
      }

    } catch (error) {
      this.logger.error('[PendingPoolManager] Error broadcasting status 6 detection:', error instanceof Error ? error.message : 'Unknown error');
    }
  }
} 