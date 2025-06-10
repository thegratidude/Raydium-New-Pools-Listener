import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { SocketService } from '../gateway/socket.service';
import { GatewayService } from '../gateway/gateway.service';
import { TokenInfo } from '../types/token';
import { LIQUIDITY_STATE_LAYOUT_V4, decodeRaydiumPoolState } from './raydium-layout';
import bs58 from 'bs58';
import { EventEmitter2 } from '@nestjs/event-emitter';

const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

export interface PoolState {
  pool_id: string;
  token_a: TokenInfo;
  token_b: TokenInfo;
  status: number;
  pool_open_time: number;
  detected_at: number;
  status_1_detected_at?: number;
  status_6_detected_at?: number;
  status6SubscriptionId?: number; // NEW: Individual listener for this pool
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
  private logsSubscriptionId: number | null = null; // For health monitoring only
  
  // Pool tracking - only pending pools (status 1 waiting for status 6)
  private pendingPools: Map<string, PoolState> = new Map();
  
  // Message tracking
  private messageCount = 0; // Resets every minute for health checks
  private totalMessageCount = 0; // Never resets, for logging
  private lastMessageTime = Date.now();
  
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
    private readonly socketService: SocketService,
    private readonly gatewayService: GatewayService,
    private readonly eventEmitter: EventEmitter2
  ) {
    this.logger.log('Initializing unified pool monitor...');
  }

  async onModuleInit() {
    try {
      this.logger.log('Starting unified pool monitoring...');
      
      // Wait for SocketService to be ready
      await this.waitForSocketService();
      
      // Start logs monitoring for health tracking (silent)
      await this.startLogsMonitoring();
      
      // Start monitoring for status 1 pools
      await this.startStatus1Monitoring();
      
      // Start background tasks
      this.startCleanupTask();
      this.startHealthCheckTask();
      
      this.isInitialized = true;
      this.logger.log('✅ Unified monitoring active');
      this.logger.log('🎯 Monitoring: Logs (health) + Status 1 → Individual Status 6 listeners');
      
    } catch (error) {
      this.logger.error('Failed to initialize:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down...');
    
    // Stop timers
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    // Remove individual pool listeners
    for (const [poolId, pool] of this.pendingPools.entries()) {
      if (pool.status6SubscriptionId) {
        try {
          await this.connection.removeProgramAccountChangeListener(pool.status6SubscriptionId);
          this.logger.log(`Removed individual listener for pool: ${poolId}`);
        } catch (error) {
          this.logger.error(`Error removing listener for pool ${poolId}:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }
    }
    
    // Remove subscriptions
    if (this.logsSubscriptionId !== null) {
      try {
        await this.connection.removeOnLogsListener(this.logsSubscriptionId);
        this.logger.log('Removed logs listener');
      } catch (error) {
        this.logger.error('Error removing logs listener:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    if (this.status1SubscriptionId !== null) {
      try {
        await this.connection.removeProgramAccountChangeListener(this.status1SubscriptionId);
        this.logger.log('Removed status 1 listener');
      } catch (error) {
        this.logger.error('Error removing status 1 listener:', error instanceof Error ? error.message : 'Unknown error');
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

  /**
   * Get message statistics for health monitoring
   */
  public getMessageStats() {
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    const messagesPerMinute = this.messageCount;
    
    return {
      total_messages: this.totalMessageCount,
      messages_per_minute: messagesPerMinute,
      time_since_last_message_ms: timeSinceLastMessage,
      is_active: timeSinceLastMessage < 60000 // Active if last message was within 1 minute
    };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async waitForSocketService(): Promise<void> {
    let attempts = 0;
    while (!this.socketService.isReady() && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
      this.logger.log(`Waiting for Socket.IO server... attempt ${attempts}/10`);
    }

    if (!this.socketService.isReady()) {
      throw new Error('Socket.IO server failed to initialize within 10 seconds');
    }
  }

  // Logs monitoring for health tracking (SILENT - no logging)
  private async startLogsMonitoring(): Promise<void> {
    try {
      this.logsSubscriptionId = this.connection.onLogs(
        RAYDIUM_PROGRAM_ID,
        ({ logs, err, signature }) => {
          if (err) return;

          // Silently count messages for health monitoring
          this.totalMessageCount++;
          this.lastMessageTime = Date.now();
          
          // Track message in gateway service for health monitoring
          this.gatewayService.trackRaydiumMessage();
          
          // NO LOGGING - just count for health monitoring
        },
        'confirmed'
      );

      this.logger.log('✅ Logs monitoring active (silent health tracking)');
      this.logger.log('📊 Tracking all Raydium network activity silently...');
    } catch (error) {
      this.logger.error('Failed to start logs monitoring:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  private async startStatus1Monitoring(): Promise<void> {
    try {
      this.logger.log('🔍 Setting up NEW Status 6 monitoring (pools created within 10 minutes)...');
      this.logger.log(`🔍 Data size filter: ${LIQUIDITY_STATE_LAYOUT_V4.span} bytes`);
      
      this.status1SubscriptionId = this.connection.onProgramAccountChange(
        RAYDIUM_PROGRAM_ID,
        async (updatedAccountInfo) => {
          // Only log every 5000th event to avoid spam
          this.totalMessageCount++;
          if (this.totalMessageCount % 5000 === 0) {
            this.logger.log(`🔍 Status 6 listener received event #${this.totalMessageCount}`);
          }
          await this.handleNewStatus6Detection(updatedAccountInfo);
        },
        'confirmed',
        [
          { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span }
        ]
      );
      
      this.logger.log(`🔍 Subscription ID: ${this.status1SubscriptionId}`);
    } catch (error) {
      this.logger.error('Error setting up Status 6 monitoring:', error);
    }
  }

  private async handleNewStatus6Detection(updatedAccountInfo: any): Promise<void> {
    try {
      const poolId = updatedAccountInfo.accountId.toString();
      
      // Check if we're already monitoring this pool
      if (this.pendingPools.has(poolId)) {
        return;
      }

      // Check if we've reached the maximum pending pools
      if (this.pendingPools.size >= this.config.maxPendingPools) {
        this.removeOldestPendingPool();
      }

      // Decode the pool state
      const poolState = decodeRaydiumPoolState(updatedAccountInfo.accountInfo.data);
      if (!poolState) {
        return;
      }

      // Only look for Status 6 pools
      if (poolState.status !== 6) {
        return;
      }

      // Check if this is a NEW pool (recently created)
      const currentTime = Math.floor(Date.now() / 1000);
      const poolOpenTime = poolState.poolOpenTime;
      
      // Skip pools with invalid open times
      if (poolOpenTime === 0) {
        return;
      }
      
      // Skip pools with future open times (more than 5 minutes in future)
      if (poolOpenTime > currentTime + 300) {
        return;
      }
      
      // Skip pools that are too old (older than 10 minutes)
      if (currentTime - poolOpenTime > 600) {
        return;
      }

      // This is a NEW Status 6 pool!
      this.logger.log(`🚀 NEW STATUS 6 DETECTED: ${poolId}`);
      this.logger.log(`Pool opens at: ${new Date(poolState.poolOpenTime * 1000)}`);
      this.logger.log(`⏱️  Pool age: ${currentTime - poolOpenTime}s`);

      // Get token info
      const tokenInfo = await this.getTokenInfo(poolState.baseMint, poolState.quoteMint);
      if (!tokenInfo) {
        this.logger.error(`Failed to get token info for pool ${poolId}`);
        return;
      }

      // Create pool state and add to pending
      const newPoolState: PoolState = {
        pool_id: poolId,
        token_a: tokenInfo.baseToken,
        token_b: tokenInfo.quoteToken,
        status: 6,
        pool_open_time: poolState.poolOpenTime,
        detected_at: Date.now(),
        status_6_detected_at: Date.now()
      };

      this.pendingPools.set(poolId, newPoolState);
      this.logger.log(`➕ Added to pending: ${poolId}`);

      // Broadcast status 6 event
      this.broadcastEvent({
        type: 'pool_status_6',
        pool_id: poolId,
        timestamp: Date.now(),
        data: {
          // Basic pool info
          pool_id: poolId,
          token_a_mint: poolState.baseMint,
          token_b_mint: poolState.quoteMint,
          base_vault: poolState.baseVault,
          quote_vault: poolState.quoteVault,
          lp_mint: poolState.lpMint,
          market_id: poolState.serumMarket,
          amm_open_orders: poolState.ammOpenOrders,
          
          // Calculate fees as percentages
          trade_fee: (poolState.tradeFeeNumerator / poolState.tradeFeeDenominator) * 100,
          swap_fee: (poolState.swapFeeNumerator / poolState.swapFeeDenominator) * 100,
          
          // Trading parameters
          min_size: poolState.minSize,
          price_range_min: poolState.minPriceMultiplier,
          price_range_max: poolState.maxPriceMultiplier,
          decimals_a: poolState.baseDecimal,
          decimals_b: poolState.quoteDecimal,
          order_book_depth: poolState.depth,
          pool_open_time: poolState.poolOpenTime,
          detected_at: Date.now(),
          analysis_status: 'pending',
          
          // Additional token info for compatibility
          token_a: newPoolState.token_a,
          token_b: newPoolState.token_b,
          
          // Additional metadata
          pool_age_seconds: Math.floor(Date.now() / 1000) - poolState.poolOpenTime
        }
      });

    } catch (error) {
      this.logger.error(`Error handling new status 6 detection:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // NEW: Handle individual Status 6 detection for a specific pool
  private async handleIndividualStatus6Detection(poolId: string, updatedAccountInfo: any): Promise<void> {
    try {
      // Check if this is still a pool we're monitoring
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
        this.logger.debug(`Pool ${poolId} status 6 but not yet open`);
        return;
      }

      this.logger.log(`🎯 STATUS 6 TRANSITION DETECTED: ${poolId}`);
      this.logger.log(`Pool opens at: ${new Date(poolState.poolOpenTime * 1000)}`);
      this.logger.log(`⏱️  Time from status 1 to status 6: ${Math.floor((Date.now() - (pendingPool.status_1_detected_at || pendingPool.detected_at)) / 1000)}s`);

      // Update pool state
      pendingPool.status = 6;
      pendingPool.pool_open_time = poolState.poolOpenTime;

      // Calculate fees as percentages
      const tradeFeePercent = (poolState.tradeFeeNumerator / poolState.tradeFeeDenominator) * 100;
      const swapFeePercent = (poolState.swapFeeNumerator / poolState.swapFeeDenominator) * 100;

      // Create comprehensive pool data for position manager
      const poolData = {
        pool_id: poolId,
        token_a_mint: poolState.baseMint,
        token_b_mint: poolState.quoteMint,
        base_vault: poolState.baseVault,
        quote_vault: poolState.quoteVault,
        lp_mint: poolState.lpMint,
        market_id: poolState.serumMarket,
        amm_open_orders: poolState.ammOpenOrders,
        trade_fee: tradeFeePercent,
        swap_fee: swapFeePercent,
        min_size: poolState.minSize,
        price_range_min: poolState.minPriceMultiplier,
        price_range_max: poolState.maxPriceMultiplier,
        decimals_a: poolState.baseDecimal,
        decimals_b: poolState.quoteDecimal,
        order_book_depth: poolState.depth,
        pool_open_time: poolState.poolOpenTime,
        detected_at: Date.now(),
        analysis_status: 'pending' as const
      };

      // Debug: Log the actual pool data structure
      this.logger.log(`🔍 DEBUG: Pool data structure for ${poolId}:`, {
        pool_id: poolData.pool_id,
        token_a_mint: poolData.token_a_mint,
        token_b_mint: poolData.token_b_mint,
        base_vault: poolData.base_vault,
        quote_vault: poolData.quote_vault,
        lp_mint: poolData.lp_mint,
        market_id: poolData.market_id,
        amm_open_orders: poolData.amm_open_orders,
        trade_fee: poolData.trade_fee,
        swap_fee: poolData.swap_fee,
        min_size: poolData.min_size,
        price_range_min: poolData.price_range_min,
        price_range_max: poolData.price_range_max,
        decimals_a: poolData.decimals_a,
        decimals_b: poolData.decimals_b,
        order_book_depth: poolData.order_book_depth,
        pool_open_time: poolData.pool_open_time
      });

      // Debug: Log the raw pool state
      this.logger.log(`🔍 DEBUG: Raw pool state for ${poolId}:`, {
        baseMint: poolState.baseMint,
        quoteMint: poolState.quoteMint,
        baseVault: poolState.baseVault,
        quoteVault: poolState.quoteVault,
        lpMint: poolState.lpMint,
        serumMarket: poolState.serumMarket,
        ammOpenOrders: poolState.ammOpenOrders,
        tradeFeeNumerator: poolState.tradeFeeNumerator,
        tradeFeeDenominator: poolState.tradeFeeDenominator,
        swapFeeNumerator: poolState.swapFeeNumerator,
        swapFeeDenominator: poolState.swapFeeDenominator,
        minSize: poolState.minSize,
        minPriceMultiplier: poolState.minPriceMultiplier,
        maxPriceMultiplier: poolState.maxPriceMultiplier,
        baseDecimal: poolState.baseDecimal,
        quoteDecimal: poolState.quoteDecimal,
        depth: poolState.depth,
        poolOpenTime: poolState.poolOpenTime
      });

      // Broadcast status 6 event to port 5001 with full pool data
      this.broadcastEvent({
        type: 'pool_status_6',
        pool_id: poolId,
        timestamp: Date.now(),
        data: {
          ...poolData,
          token_a: pendingPool.token_a,
          token_b: pendingPool.token_b,
          time_to_status_6_ms: Date.now() - (pendingPool.status_1_detected_at || pendingPool.detected_at)
        }
      });

      // Broadcast pool ready event
      this.broadcastEvent({
        type: 'pool_ready',
        pool_id: poolId,
        timestamp: Date.now(),
        data: {
          ...poolData,
          base_token: pendingPool.token_a.symbol,
          quote_token: pendingPool.token_b.symbol
        }
      });

      // Remove individual listener for this pool
      await this.removeIndividualStatus6Listener(poolId);

      // Remove from pending pools (mission accomplished!)
      this.pendingPools.delete(poolId);
      this.logger.log(`✅ Removed from pending: ${poolId}`);

    } catch (error) {
      this.logger.error(`Error handling individual status 6 detection for pool ${poolId}:`, error instanceof Error ? error.message : 'Unknown error');
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
      this.logger.error('Error getting token info:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  private broadcastEvent(event: PoolEvent): void {
    try {
      this.logger.log(`📡 Broadcasting ${event.type} event for pool: ${event.pool_id}`);
      
      // Use the more flexible broadcast method for different event types
      this.socketService.broadcast(event.type, {
        pool_id: event.pool_id,
        timestamp: event.timestamp,
        data: event.data
      });
      
      // Also emit event for position manager to listen to
      this.eventEmitter.emit(event.type, {
        pool_id: event.pool_id,
        timestamp: event.timestamp,
        data: event.data
      });
      
      this.logger.log(`✅ Successfully broadcasted ${event.type} event for pool: ${event.pool_id}`);
    } catch (error) {
      this.logger.error(`❌ Error broadcasting ${event.type} event for pool ${event.pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private removeOldestPendingPool(): void {
    if (this.pendingPools.size === 0) return;
    
    const oldestPool = Array.from(this.pendingPools.entries())
      .sort(([, a], [, b]) => a.detected_at - b.detected_at)[0];
    
    if (oldestPool) {
      this.pendingPools.delete(oldestPool[0]);
      this.logger.log(`🗑️  Removed oldest pending pool: ${oldestPool[0]}`);
    }
  }

  private startCleanupTask(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.config.cleanupIntervalMs);
    
    this.logger.log(`🧹 Cleanup task started (${this.config.cleanupIntervalMs}ms interval)`);
  }

  private startHealthCheckTask(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);
    
    this.logger.log(`💚 Health check task started (${this.config.healthCheckIntervalMs}ms interval)`);
  }

  private performCleanup(): void {
    try {
      const now = Date.now();
      const ONE_HOUR = 60 * 60 * 1000;
      
      // Clean up old pending pools (older than 1 hour)
      for (const [poolId, pool] of this.pendingPools.entries()) {
        if (now - pool.detected_at > ONE_HOUR) {
          // Remove individual listener for this pool
          this.removeIndividualStatus6Listener(poolId);
          
          // Remove from pending pools
          this.pendingPools.delete(poolId);
          this.logger.log(`🗑️  Cleaned up old pending pool: ${poolId}`);
        }
      }
      
    } catch (error) {
      this.logger.error('Error during cleanup:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private performHealthCheck(): void {
    try {
      const stats = this.getPoolStats();
      const messageStats = this.getMessageStats();
      
      this.logger.log(`💚 Health check - Pending: ${stats.pending}/${stats.max_pending} | Messages: ${messageStats.messages_per_minute}/min | Active: ${messageStats.is_active ? '✅' : '❌'}`);
      
      // Check for potential issues
      if (stats.pending > this.config.maxPendingPools * 0.8) {
        this.logger.warn(`⚠️  High pending pool count: ${stats.pending}/${this.config.maxPendingPools}`);
      }
      
      if (!messageStats.is_active) {
        this.logger.warn(`⚠️  No Raydium messages received in last minute`);
      }
      
      // Reset message count for next minute
      this.messageCount = 0;
      
    } catch (error) {
      this.logger.error('Error during health check:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // NEW: Add individual listener for a specific pool to watch for Status 6
  private async addIndividualStatus6Listener(poolId: string): Promise<void> {
    try {
      const poolPublicKey = new PublicKey(poolId);
      
      const subscriptionId = this.connection.onProgramAccountChange(
        poolPublicKey,
        async (updatedAccountInfo) => {
          await this.handleIndividualStatus6Detection(poolId, updatedAccountInfo);
        },
        'confirmed'
      );

      // Store the subscription ID in the pool state
      const pool = this.pendingPools.get(poolId);
      if (pool) {
        pool.status6SubscriptionId = subscriptionId;
        this.pendingPools.set(poolId, pool);
      }

      this.logger.log(`✅ Added individual Status 6 listener for pool: ${poolId}`);
    } catch (error) {
      this.logger.error(`Failed to add individual Status 6 listener for pool ${poolId}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // NEW: Remove individual listener for a specific pool
  private async removeIndividualStatus6Listener(poolId: string): Promise<void> {
    try {
      const pool = this.pendingPools.get(poolId);
      if (pool && pool.status6SubscriptionId) {
        await this.connection.removeProgramAccountChangeListener(pool.status6SubscriptionId);
        this.logger.log(`✅ Removed individual Status 6 listener for pool: ${poolId}`);
      }
    } catch (error) {
      this.logger.error(`Error removing individual Status 6 listener for pool ${poolId}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }
} 