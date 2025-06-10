import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { SocketService } from '../gateway/socket.service';
import { PoolMonitorManager } from './pool-monitor-manager';
import { TokenInfo } from '../types/token';
import { LIQUIDITY_STATE_LAYOUT_V4, decodeRaydiumPoolState } from './raydium-layout';
import bs58 from 'bs58';

const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

interface Status6Pool {
  pool_id: string;
  token_a: TokenInfo;
  token_b: TokenInfo;
  detected_at: number;
  pool_open_time: number;
}

@Injectable()
export class Status6MonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Status6MonitorService.name);
  private subscriptionId: number | null = null;
  private detectedPools: Map<string, Status6Pool> = new Map();
  private isInitialized = false;

  constructor(
    private readonly connection: Connection,
    private readonly socketService: SocketService,
    private readonly poolMonitorManager: PoolMonitorManager
  ) {
    this.logger.log('Status6MonitorService initialized');
  }

  async onModuleInit() {
    try {
      this.logger.log('[Status6MonitorService] Starting status 6 pool detection...');
      
      // Start the efficient program account change monitoring
      await this.startStatus6Monitoring();
      
      this.isInitialized = true;
      this.logger.log('[Status6MonitorService] ✅ Status 6 monitoring active');
    } catch (error) {
      this.logger.error('[Status6MonitorService] Failed to initialize:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('[Status6MonitorService] Shutting down...');
    
    if (this.subscriptionId !== null) {
      try {
        await this.connection.removeProgramAccountChangeListener(this.subscriptionId);
        this.logger.log('[Status6MonitorService] Removed program account change listener');
      } catch (error) {
        this.logger.error('[Status6MonitorService] Error removing listener:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    this.detectedPools.clear();
    this.isInitialized = false;
  }

  private async startStatus6Monitoring() {
    try {
      // Use the most efficient method from the compass artifact
      this.subscriptionId = this.connection.onProgramAccountChange(
        RAYDIUM_PROGRAM_ID,
        async (updatedAccountInfo) => {
          await this.handleAccountChange(updatedAccountInfo);
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

      this.logger.log('[Status6MonitorService] ✅ Program account change listener registered');
      this.logger.log('[Status6MonitorService] 🎯 Monitoring for status 6 pools (tradeable)');
    } catch (error) {
      this.logger.error('[Status6MonitorService] Failed to start monitoring:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  private async handleAccountChange(updatedAccountInfo: any) {
    try {
      const poolId = updatedAccountInfo.accountId.toString();
      
      // Skip if we already detected this pool
      if (this.detectedPools.has(poolId)) {
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
        this.logger.debug(`[Status6MonitorService] Pool ${poolId} status 6 but not yet open (opens at ${new Date(poolState.poolOpenTime * 1000)})`);
        return;
      }

      // NEW: Filter out legacy pools (poolOpenTime: 0)
      if (poolState.poolOpenTime === 0) {
        this.logger.debug(`[Status6MonitorService] Skipping legacy pool ${poolId} (poolOpenTime: 0 - created before timestamp tracking)`);
        return;
      }

      // NEW: Filter for pools that became status 6 recently (within last hour)
      const ONE_HOUR = 60 * 60; // 1 hour in seconds
      const poolBecameStatus6Recently = (currentTime - poolState.poolOpenTime) <= ONE_HOUR;
      
      if (!poolBecameStatus6Recently) {
        const hoursAgo = Math.floor((currentTime - poolState.poolOpenTime) / 3600);
        this.logger.debug(`[Status6MonitorService] Skipping old status 6 pool ${poolId} (created ${hoursAgo} hours ago)`);
        return;
      }

      this.logger.log(`[Status6MonitorService] 🚀 NEW STATUS 6 POOL DETECTED: ${poolId}`);
      this.logger.log(`[Status6MonitorService] Pool opens at: ${new Date(poolState.poolOpenTime * 1000)}`);
      this.logger.log(`[Status6MonitorService] Base mint: ${poolState.baseMint}`);
      this.logger.log(`[Status6MonitorService] Quote mint: ${poolState.quoteMint}`);
      this.logger.log(`[Status6MonitorService] 🆕 Recently created: ${poolBecameStatus6Recently ? 'YES' : 'NO'}`);

      // Get token information
      const tokenInfo = await this.getTokenInfo(poolState.baseMint, poolState.quoteMint);
      if (!tokenInfo) {
        this.logger.warn(`[Status6MonitorService] Could not get token info for pool ${poolId}`);
        return;
      }

      // Create pool record
      const pool: Status6Pool = {
        pool_id: poolId,
        token_a: tokenInfo.baseToken,
        token_b: tokenInfo.quoteToken,
        detected_at: Date.now(),
        pool_open_time: poolState.poolOpenTime
      };

      this.detectedPools.set(poolId, pool);

      // Broadcast the new pool immediately
      await this.broadcastNewPool(pool);

      // Start monitoring this pool
      await this.startPoolMonitoring(pool);

    } catch (error) {
      this.logger.error(`[Status6MonitorService] Error handling account change:`, error instanceof Error ? error.message : 'Unknown error');
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
      this.logger.error('[Status6MonitorService] Error getting token info:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  private async broadcastNewPool(pool: Status6Pool) {
    try {
      const message = {
        event: 'pool_ready' as const,
        pool_id: pool.pool_id,
        timestamp: Date.now(),
        data: {
          base_token: pool.token_a.symbol,
          quote_token: pool.token_b.symbol,
          trade_count: 0, // Status 6 pools are ready but haven't had trades yet
          reserve_change_percent: 0,
          detection_method: 'status_6_monitoring',
          detected_at: new Date(pool.detected_at).toISOString(),
          pool_open_time: new Date(pool.pool_open_time * 1000).toISOString()
        }
      };

      this.socketService.broadcastPoolReady(message);
      this.logger.log(`[Status6MonitorService] 📢 Broadcasted status 6 pool: ${pool.pool_id}`);
    } catch (error) {
      this.logger.error('[Status6MonitorService] Error broadcasting new pool:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async startPoolMonitoring(pool: Status6Pool) {
    try {
      // Add to PoolMonitorManager for real-time monitoring
      await this.poolMonitorManager.addPool({
        pool_id: pool.pool_id,
        token_a: pool.token_a,
        token_b: pool.token_b
      });

      this.logger.log(`[Status6MonitorService] ✅ Started monitoring for pool ${pool.pool_id}`);
    } catch (error) {
      this.logger.error(`[Status6MonitorService] Error starting pool monitoring for ${pool.pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // Public methods for monitoring and debugging
  public getDetectedPools(): Status6Pool[] {
    return Array.from(this.detectedPools.values());
  }

  public getPoolCount(): number {
    return this.detectedPools.size;
  }

  public isPoolDetected(poolId: string): boolean {
    return this.detectedPools.has(poolId);
  }
} 