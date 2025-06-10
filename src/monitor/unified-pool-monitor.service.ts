import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { SocketService } from '../gateway/socket.service';
import { TokenInfo } from '../types/token';
import { LIQUIDITY_STATE_LAYOUT_V4, decodeRaydiumPoolState } from './raydium-layout';
import bs58 from 'bs58';

const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

export interface PoolState {
  pool_id: string;
  token_a: TokenInfo;
  token_b: TokenInfo;
  status: number;
  pool_open_time: number;
  detected_at: number;
  lifecycle_stage: 'pending' | 'teed_up' | 'status_6' | 'monitoring' | 'completed';
  metadata?: {
    trade_count?: number;
    reserve_changes?: any;
    last_activity?: number;
  };
}

export interface PoolEvent {
  type: 'pool_teed_up' | 'pool_status_6' | 'pool_ready' | 'pool_activity' | 'pool_error';
  pool_id: string;
  timestamp: number;
  data: any;
}

@Injectable()
export class UnifiedPoolMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UnifiedPoolMonitorService.name);
  
  // Core state
  private isInitialized = false;
  private subscriptionId: number | null = null;
  
  // Pool tracking
  private pendingPools: Map<string, PoolState> = new Map();
  private teedUpPools: Map<string, PoolState> = new Map();
  private activePools: Map<string, PoolState> = new Map();
  
  // Configuration
  private readonly config = {
    maxPendingPools: 100,
    maxTeedUpPools: 50,
    maxActivePools: 200,
    status6FilterHours: 1, // Only process status 6 pools created within last hour
    cleanupIntervalMs: 300000, // 5 minutes
    healthCheckIntervalMs: 60000, // 1 minute
  };

  // Timers
  private cleanupTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly socketService: SocketService
  ) {
    this.logger.log('[UnifiedPoolMonitorService] Initializing unified pool monitor...');
  }

  async onModuleInit() {
    try {
      this.logger.log('[UnifiedPoolMonitorService] Starting unified pool monitoring...');
      
      // Wait for SocketService to be ready
      await this.waitForSocketService();
      
      // Start monitoring
      await this.startStatus6Monitoring();
      
      // Start background tasks
      this.startCleanupTask();
      this.startHealthCheckTask();
      
      this.isInitialized = true;
      this.logger.log('[UnifiedPoolMonitorService] ✅ Unified monitoring active');
      this.logger.log('[UnifiedPoolMonitorService] 🎯 Monitoring: Pending → Teed Up → Status 6 → Active');
      
    } catch (error) {
      this.logger.error('[UnifiedPoolMonitorService] Failed to initialize:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('[UnifiedPoolMonitorService] Shutting down...');
    
    // Stop timers
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    // Remove subscription
    if (this.subscriptionId !== null) {
      try {
        await this.connection.removeProgramAccountChangeListener(this.subscriptionId);
        this.logger.log('[UnifiedPoolMonitorService] Removed program account change listener');
      } catch (error) {
        this.logger.error('[UnifiedPoolMonitorService] Error removing listener:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    // Clear state
    this.pendingPools.clear();
    this.teedUpPools.clear();
    this.activePools.clear();
    this.isInitialized = false;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Add a pool to pending monitoring (manual addition)
   */
  public addPendingPool(poolId: string, tokenA: TokenInfo, tokenB: TokenInfo): void {
    if (!this.isInitialized) {
      throw new Error('UnifiedPoolMonitorService not initialized');
    }

    if (this.pendingPools.size >= this.config.maxPendingPools) {
      this.logger.warn(`[UnifiedPoolMonitorService] Max pending pools reached (${this.config.maxPendingPools}), removing oldest`);
      this.removeOldestPendingPool();
    }

    const poolState: PoolState = {
      pool_id: poolId,
      token_a: tokenA,
      token_b: tokenB,
      status: 0,
      pool_open_time: 0,
      detected_at: Date.now(),
      lifecycle_stage: 'pending'
    };

    this.pendingPools.set(poolId, poolState);
    this.logger.log(`[UnifiedPoolMonitorService] ➕ Added pending pool: ${poolId}`);
    
    this.broadcastEvent({
      type: 'pool_teed_up',
      pool_id: poolId,
      timestamp: Date.now(),
      data: { token_a: tokenA, token_b: tokenB }
    });
  }

  /**
   * Handle pool tee up detection (initialize2 event)
   */
  public onPoolTeedUp(poolId: string, tokenA: TokenInfo, tokenB: TokenInfo): void {
    if (!this.isInitialized) {
      throw new Error('UnifiedPoolMonitorService not initialized');
    }

    this.logger.log(`[UnifiedPoolMonitorService] 🏌️‍♂️ POOL TEED UP: ${poolId}`);
    this.logger.log(`[UnifiedPoolMonitorService] Base: ${tokenA.symbol} (${tokenA.mint})`);
    this.logger.log(`[UnifiedPoolMonitorService] Quote: ${tokenB.symbol} (${tokenB.mint})`);

    // Check if we were already tracking this pool
    const existingPending = this.pendingPools.get(poolId);
    const existingTeedUp = this.teedUpPools.get(poolId);

    if (existingPending) {
      // Move from pending to teed up
      existingPending.lifecycle_stage = 'teed_up';
      this.teedUpPools.set(poolId, existingPending);
      this.pendingPools.delete(poolId);
      this.logger.log(`[UnifiedPoolMonitorService] 🔄 Moved pool ${poolId} from pending to teed up`);
    } else if (!existingTeedUp) {
      // New teed up pool
      const poolState: PoolState = {
        pool_id: poolId,
        token_a: tokenA,
        token_b: tokenB,
        status: 0,
        pool_open_time: 0,
        detected_at: Date.now(),
        lifecycle_stage: 'teed_up'
      };
      this.teedUpPools.set(poolId, poolState);
      this.logger.log(`[UnifiedPoolMonitorService] ➕ New teed up pool: ${poolId}`);
    }

    this.broadcastEvent({
      type: 'pool_teed_up',
      pool_id: poolId,
      timestamp: Date.now(),
      data: { token_a: tokenA, token_b: tokenB }
    });
  }

  /**
   * Get all pools by lifecycle stage
   */
  public getPoolsByStage(stage: PoolState['lifecycle_stage']): PoolState[] {
    switch (stage) {
      case 'pending':
        return Array.from(this.pendingPools.values());
      case 'teed_up':
        return Array.from(this.teedUpPools.values());
      case 'status_6':
      case 'monitoring':
      case 'completed':
        return Array.from(this.activePools.values()).filter(pool => pool.lifecycle_stage === stage);
      default:
        return [];
    }
  }

  /**
   * Get pool statistics
   */
  public getPoolStats() {
    return {
      pending: this.pendingPools.size,
      teed_up: this.teedUpPools.size,
      active: this.activePools.size,
      total: this.pendingPools.size + this.teedUpPools.size + this.activePools.size,
      max_pending: this.config.maxPendingPools,
      max_teed_up: this.config.maxTeedUpPools,
      max_active: this.config.maxActivePools
    };
  }

  /**
   * Check if pool is being monitored
   */
  public isPoolMonitored(poolId: string): boolean {
    return this.pendingPools.has(poolId) || 
           this.teedUpPools.has(poolId) || 
           this.activePools.has(poolId);
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async waitForSocketService(): Promise<void> {
    let attempts = 0;
    while (!this.socketService.isReady() && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
      this.logger.log(`[UnifiedPoolMonitorService] Waiting for Socket.IO server... attempt ${attempts}/10`);
    }

    if (!this.socketService.isReady()) {
      throw new Error('Socket.IO server failed to initialize within 10 seconds');
    }
  }

  private async startStatus6Monitoring(): Promise<void> {
    try {
      this.subscriptionId = this.connection.onProgramAccountChange(
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

      this.logger.log('[UnifiedPoolMonitorService] ✅ Status 6 monitoring active');
      this.logger.log('[UnifiedPoolMonitorService] 🎯 Waiting for pools to swing (hit status 6)...');
    } catch (error) {
      this.logger.error('[UnifiedPoolMonitorService] Failed to start monitoring:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  private async handleStatus6Detection(updatedAccountInfo: any): Promise<void> {
    try {
      const poolId = updatedAccountInfo.accountId.toString();
      
      // Skip if we're already monitoring this pool
      if (this.isPoolMonitored(poolId)) {
        return;
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
        this.logger.debug(`[UnifiedPoolMonitorService] Skipping legacy pool ${poolId} (poolOpenTime: 0)`);
        return;
      }

      // Check if pool is actually open for trading
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime < poolState.poolOpenTime) {
        this.logger.debug(`[UnifiedPoolMonitorService] Pool ${poolId} status 6 but not yet open`);
        return;
      }

      // Filter for recently created pools
      const ONE_HOUR = 60 * 60;
      const poolBecameStatus6Recently = (currentTime - poolState.poolOpenTime) <= ONE_HOUR;
      
      if (!poolBecameStatus6Recently) {
        const hoursAgo = Math.floor((currentTime - poolState.poolOpenTime) / 3600);
        this.logger.debug(`[UnifiedPoolMonitorService] Skipping old status 6 pool ${poolId} (created ${hoursAgo} hours ago)`);
        return;
      }

      this.logger.log(`[UnifiedPoolMonitorService] 🚀 NEW STATUS 6 POOL DETECTED: ${poolId}`);
      this.logger.log(`[UnifiedPoolMonitorService] Pool opens at: ${new Date(poolState.poolOpenTime * 1000)}`);
      this.logger.log(`[UnifiedPoolMonitorService] Base mint: ${poolState.baseMint}`);
      this.logger.log(`[UnifiedPoolMonitorService] Quote mint: ${poolState.quoteMint}`);

      // Get token information
      const tokenInfo = await this.getTokenInfo(poolState.baseMint, poolState.quoteMint);
      if (!tokenInfo) {
        this.logger.warn(`[UnifiedPoolMonitorService] Could not get token info for pool ${poolId}`);
        return;
      }

      // Create pool state
      const newPoolState: PoolState = {
        pool_id: poolId,
        token_a: tokenInfo.baseToken,
        token_b: tokenInfo.quoteToken,
        status: 6,
        pool_open_time: poolState.poolOpenTime,
        detected_at: Date.now(),
        lifecycle_stage: 'status_6'
      };

      // Check if this was a pool we were tracking
      const teedUpPool = this.teedUpPools.get(poolId);
      if (teedUpPool) {
        this.logger.log(`[UnifiedPoolMonitorService] 🏌️‍♂️ SWING DETECTED! Pool ${poolId} hit status 6!`);
        this.logger.log(`[UnifiedPoolMonitorService] ⏱️  Time from tee up to swing: ${Math.floor((Date.now() - teedUpPool.detected_at) / 1000)}s`);
        
        // Update the existing pool
        teedUpPool.status = 6;
        teedUpPool.pool_open_time = poolState.poolOpenTime;
        teedUpPool.lifecycle_stage = 'status_6';
        this.teedUpPools.delete(poolId);
        this.activePools.set(poolId, teedUpPool);
      } else {
        // New status 6 pool (missed the tee up)
        this.logger.log(`[UnifiedPoolMonitorService] ⚠️  Status 6 pool detected but we missed the tee up: ${poolId}`);
        this.activePools.set(poolId, newPoolState);
      }

      // Broadcast the event
      this.broadcastEvent({
        type: 'pool_status_6',
        pool_id: poolId,
        timestamp: Date.now(),
        data: {
          token_a: newPoolState.token_a,
          token_b: newPoolState.token_b,
          pool_open_time: poolState.poolOpenTime,
          missed_tee_up: !teedUpPool
        }
      });

      // Start monitoring this pool
      await this.startPoolMonitoring(newPoolState);

    } catch (error) {
      this.logger.error(`[UnifiedPoolMonitorService] Error handling status 6 detection:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async getTokenInfo(baseMint: string, quoteMint: string): Promise<{ baseToken: TokenInfo; quoteToken: TokenInfo } | null> {
    try {
      // For now, use placeholder token info - you can enhance this with actual token metadata
      const baseToken: TokenInfo = {
        symbol: 'TOKEN_A',
        mint: baseMint,
        decimals: 9
      };

      const quoteToken: TokenInfo = {
        symbol: 'TOKEN_B', 
        mint: quoteMint,
        decimals: 6
      };

      return { baseToken, quoteToken };
    } catch (error) {
      this.logger.error('[UnifiedPoolMonitorService] Error getting token info:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  private async startPoolMonitoring(poolState: PoolState): Promise<void> {
    try {
      poolState.lifecycle_stage = 'monitoring';
      this.logger.log(`[UnifiedPoolMonitorService] 🎯 Started monitoring pool: ${poolState.pool_id}`);
      
      // Broadcast pool ready event
      this.broadcastEvent({
        type: 'pool_ready',
        pool_id: poolState.pool_id,
        timestamp: Date.now(),
        data: {
          base_token: poolState.token_a.symbol,
          quote_token: poolState.token_b.symbol,
          pool_open_time: poolState.pool_open_time
        }
      });

      // TODO: Add actual trading activity monitoring here
      // This would include monitoring trades, liquidity changes, etc.
      
    } catch (error) {
      this.logger.error(`[UnifiedPoolMonitorService] Error starting pool monitoring for ${poolState.pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private broadcastEvent(event: PoolEvent): void {
    try {
      // Use the more flexible broadcast method for different event types
      this.socketService.broadcast(event.type, {
        pool_id: event.pool_id,
        timestamp: event.timestamp,
        data: event.data
      });
    } catch (error) {
      this.logger.error(`[UnifiedPoolMonitorService] Error broadcasting event:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private removeOldestPendingPool(): void {
    if (this.pendingPools.size === 0) return;
    
    const oldestPool = Array.from(this.pendingPools.entries())
      .sort(([, a], [, b]) => a.detected_at - b.detected_at)[0];
    
    if (oldestPool) {
      this.pendingPools.delete(oldestPool[0]);
      this.logger.log(`[UnifiedPoolMonitorService] 🗑️  Removed oldest pending pool: ${oldestPool[0]}`);
    }
  }

  private startCleanupTask(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.config.cleanupIntervalMs);
    
    this.logger.log(`[UnifiedPoolMonitorService] 🧹 Cleanup task started (${this.config.cleanupIntervalMs}ms interval)`);
  }

  private startHealthCheckTask(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);
    
    this.logger.log(`[UnifiedPoolMonitorService] 💚 Health check task started (${this.config.healthCheckIntervalMs}ms interval)`);
  }

  private performCleanup(): void {
    try {
      const now = Date.now();
      const ONE_HOUR = 60 * 60 * 1000;
      
      // Clean up old pending pools (older than 1 hour)
      for (const [poolId, pool] of this.pendingPools.entries()) {
        if (now - pool.detected_at > ONE_HOUR) {
          this.pendingPools.delete(poolId);
          this.logger.log(`[UnifiedPoolMonitorService] 🗑️  Cleaned up old pending pool: ${poolId}`);
        }
      }
      
      // Clean up old teed up pools (older than 30 minutes)
      const THIRTY_MINUTES = 30 * 60 * 1000;
      for (const [poolId, pool] of this.teedUpPools.entries()) {
        if (now - pool.detected_at > THIRTY_MINUTES) {
          this.teedUpPools.delete(poolId);
          this.logger.log(`[UnifiedPoolMonitorService] 🗑️  Cleaned up old teed up pool: ${poolId}`);
        }
      }
      
    } catch (error) {
      this.logger.error('[UnifiedPoolMonitorService] Error during cleanup:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private performHealthCheck(): void {
    try {
      const stats = this.getPoolStats();
      this.logger.log(`[UnifiedPoolMonitorService] 💚 Health check - Pending: ${stats.pending}, Teed Up: ${stats.teed_up}, Active: ${stats.active}`);
      
      // Check for potential issues
      if (stats.pending > this.config.maxPendingPools * 0.8) {
        this.logger.warn(`[UnifiedPoolMonitorService] ⚠️  High pending pool count: ${stats.pending}/${this.config.maxPendingPools}`);
      }
      
      if (stats.active > this.config.maxActivePools * 0.8) {
        this.logger.warn(`[UnifiedPoolMonitorService] ⚠️  High active pool count: ${stats.active}/${this.config.maxActivePools}`);
      }
      
    } catch (error) {
      this.logger.error('[UnifiedPoolMonitorService] Error during health check:', error instanceof Error ? error.message : 'Unknown error');
    }
  }
} 