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
  status_1_detected_at?: number;
}

export interface PoolEvent {
  type: 'pool_status_1' | 'pool_status_6' | 'pool_ready';
  pool_id: string;
  timestamp: number;
  data: any;
}

@Injectable()
export class UnifiedPoolMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UnifiedPoolMonitorService.name);
  
  // Core state
  private isInitialized = false;
  private status1SubscriptionId: number | null = null;
  private status6SubscriptionId: number | null = null;
  
  // Pool tracking - only pending pools (status 1 waiting for status 6)
  private pendingPools: Map<string, PoolState> = new Map();
  
  // Configuration
  private readonly config = {
    maxPendingPools: 100,
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
      
      // Start monitoring for status 1 pools
      await this.startStatus1Monitoring();
      
      // Start monitoring for status 6 transitions
      await this.startStatus6Monitoring();
      
      // Start background tasks
      this.startCleanupTask();
      this.startHealthCheckTask();
      
      this.isInitialized = true;
      this.logger.log('[UnifiedPoolMonitorService] ✅ Unified monitoring active');
      this.logger.log('[UnifiedPoolMonitorService] 🎯 Monitoring: Status 1 → Status 6 → Broadcast');
      
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
    
    // Remove subscriptions
    if (this.status1SubscriptionId !== null) {
      try {
        await this.connection.removeProgramAccountChangeListener(this.status1SubscriptionId);
        this.logger.log('[UnifiedPoolMonitorService] Removed status 1 listener');
      } catch (error) {
        this.logger.error('[UnifiedPoolMonitorService] Error removing status 1 listener:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    if (this.status6SubscriptionId !== null) {
      try {
        await this.connection.removeProgramAccountChangeListener(this.status6SubscriptionId);
        this.logger.log('[UnifiedPoolMonitorService] Removed status 6 listener');
      } catch (error) {
        this.logger.error('[UnifiedPoolMonitorService] Error removing status 6 listener:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    // Clear state
    this.pendingPools.clear();
    this.isInitialized = false;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get all pending pools (status 1 waiting for status 6)
   */
  public getPendingPools(): PoolState[] {
    return Array.from(this.pendingPools.values());
  }

  /**
   * Get pool statistics
   */
  public getPoolStats() {
    return {
      pending: this.pendingPools.size,
      max_pending: this.config.maxPendingPools
    };
  }

  /**
   * Check if pool is being monitored
   */
  public isPoolMonitored(poolId: string): boolean {
    return this.pendingPools.has(poolId);
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

  private async startStatus1Monitoring(): Promise<void> {
    try {
      this.status1SubscriptionId = this.connection.onProgramAccountChange(
        RAYDIUM_PROGRAM_ID,
        async (updatedAccountInfo) => {
          await this.handleStatus1Detection(updatedAccountInfo);
        },
        'confirmed',
        [
          { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
          { 
            memcmp: { 
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
              bytes: bs58.encode([1, 0, 0, 0, 0, 0, 0, 0]) // Status 1 in little-endian
            }
          }
        ]
      );

      this.logger.log('[UnifiedPoolMonitorService] ✅ Status 1 monitoring active');
      this.logger.log('[UnifiedPoolMonitorService] 🎯 Watching for new pool initializations...');
    } catch (error) {
      this.logger.error('[UnifiedPoolMonitorService] Failed to start status 1 monitoring:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  private async startStatus6Monitoring(): Promise<void> {
    try {
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

      this.logger.log('[UnifiedPoolMonitorService] ✅ Status 6 monitoring active');
      this.logger.log('[UnifiedPoolMonitorService] 🎯 Watching for status 6 transitions...');
    } catch (error) {
      this.logger.error('[UnifiedPoolMonitorService] Failed to start status 6 monitoring:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  private async handleStatus1Detection(updatedAccountInfo: any): Promise<void> {
    try {
      const poolId = updatedAccountInfo.accountId.toString();
      
      // Skip if we're already monitoring this pool
      if (this.pendingPools.has(poolId)) {
        return;
      }

      // Decode the pool state
      const poolState = decodeRaydiumPoolState(updatedAccountInfo.accountInfo.data);
      if (!poolState) {
        return;
      }

      // Verify it's actually status 1
      if (poolState.status !== 1) {
        return;
      }

      // Filter out legacy pools (poolOpenTime: 0)
      if (poolState.poolOpenTime === 0) {
        this.logger.debug(`[UnifiedPoolMonitorService] Skipping legacy pool ${poolId} (poolOpenTime: 0)`);
        return;
      }

      this.logger.log(`[UnifiedPoolMonitorService] 🚀 NEW STATUS 1 POOL DETECTED: ${poolId}`);
      this.logger.log(`[UnifiedPoolMonitorService] Base mint: ${poolState.baseMint}`);
      this.logger.log(`[UnifiedPoolMonitorService] Quote mint: ${poolState.quoteMint}`);

      // Get token information
      const tokenInfo = await this.getTokenInfo(poolState.baseMint, poolState.quoteMint);
      if (!tokenInfo) {
        this.logger.warn(`[UnifiedPoolMonitorService] Could not get token info for pool ${poolId}`);
        return;
      }

      // Check if we have room for more pending pools
      if (this.pendingPools.size >= this.config.maxPendingPools) {
        this.logger.warn(`[UnifiedPoolMonitorService] Max pending pools reached (${this.config.maxPendingPools}), removing oldest`);
        this.removeOldestPendingPool();
      }

      // Create pool state and add to pending
      const newPoolState: PoolState = {
        pool_id: poolId,
        token_a: tokenInfo.baseToken,
        token_b: tokenInfo.quoteToken,
        status: 1,
        pool_open_time: poolState.poolOpenTime,
        detected_at: Date.now(),
        status_1_detected_at: Date.now()
      };

      this.pendingPools.set(poolId, newPoolState);
      this.logger.log(`[UnifiedPoolMonitorService] ➕ Added to pending: ${poolId}`);

      // Broadcast status 1 event
      this.broadcastEvent({
        type: 'pool_status_1',
        pool_id: poolId,
        timestamp: Date.now(),
        data: {
          token_a: newPoolState.token_a,
          token_b: newPoolState.token_b,
          pool_open_time: poolState.poolOpenTime
        }
      });

    } catch (error) {
      this.logger.error(`[UnifiedPoolMonitorService] Error handling status 1 detection:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async handleStatus6Detection(updatedAccountInfo: any): Promise<void> {
    try {
      const poolId = updatedAccountInfo.accountId.toString();
      
      // Check if this is a pool we're monitoring
      const pendingPool = this.pendingPools.get(poolId);
      if (!pendingPool) {
        // Not a pool we're tracking, skip
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

      // Check if pool is actually open for trading
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime < poolState.poolOpenTime) {
        this.logger.debug(`[UnifiedPoolMonitorService] Pool ${poolId} status 6 but not yet open`);
        return;
      }

      this.logger.log(`[UnifiedPoolMonitorService] 🎯 STATUS 6 TRANSITION DETECTED: ${poolId}`);
      this.logger.log(`[UnifiedPoolMonitorService] Pool opens at: ${new Date(poolState.poolOpenTime * 1000)}`);
      this.logger.log(`[UnifiedPoolMonitorService] ⏱️  Time from status 1 to status 6: ${Math.floor((Date.now() - (pendingPool.status_1_detected_at || pendingPool.detected_at)) / 1000)}s`);

      // Update pool state
      pendingPool.status = 6;
      pendingPool.pool_open_time = poolState.poolOpenTime;

      // Broadcast status 6 event to port 5001
      this.broadcastEvent({
        type: 'pool_status_6',
        pool_id: poolId,
        timestamp: Date.now(),
        data: {
          token_a: pendingPool.token_a,
          token_b: pendingPool.token_b,
          pool_open_time: poolState.poolOpenTime,
          time_to_status_6_ms: Date.now() - (pendingPool.status_1_detected_at || pendingPool.detected_at)
        }
      });

      // Broadcast pool ready event
      this.broadcastEvent({
        type: 'pool_ready',
        pool_id: poolId,
        timestamp: Date.now(),
        data: {
          base_token: pendingPool.token_a.symbol,
          quote_token: pendingPool.token_b.symbol,
          pool_open_time: poolState.poolOpenTime
        }
      });

      // Remove from pending pools (mission accomplished!)
      this.pendingPools.delete(poolId);
      this.logger.log(`[UnifiedPoolMonitorService] ✅ Removed from pending: ${poolId}`);

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
      
    } catch (error) {
      this.logger.error('[UnifiedPoolMonitorService] Error during cleanup:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private performHealthCheck(): void {
    try {
      const stats = this.getPoolStats();
      this.logger.log(`[UnifiedPoolMonitorService] 💚 Health check - Pending: ${stats.pending}/${stats.max_pending}`);
      
      // Check for potential issues
      if (stats.pending > this.config.maxPendingPools * 0.8) {
        this.logger.warn(`[UnifiedPoolMonitorService] ⚠️  High pending pool count: ${stats.pending}/${this.config.maxPendingPools}`);
      }
      
    } catch (error) {
      this.logger.error('[UnifiedPoolMonitorService] Error during health check:', error instanceof Error ? error.message : 'Unknown error');
    }
  }
} 