import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { SocketService } from '../gateway/socket.service';
import { PoolMonitorManager } from './pool-monitor-manager';
import { TokenInfo } from '../types/token';
import { LIQUIDITY_STATE_LAYOUT_V4, decodeRaydiumPoolState } from './raydium-layout';
import bs58 from 'bs58';

const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

interface TeedUpPool {
  pool_id: string;
  token_a: TokenInfo;
  token_b: TokenInfo;
  teed_up_at: number;
  detected_status_6: boolean;
  status_6_detected_at?: number;
}

@Injectable()
export class HybridPoolMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HybridPoolMonitorService.name);
  private subscriptionId: number | null = null;
  private teedUpPools: Map<string, TeedUpPool> = new Map();
  private isInitialized = false;

  constructor(
    private readonly connection: Connection,
    private readonly socketService: SocketService,
    private readonly poolMonitorManager: PoolMonitorManager
  ) {
    this.logger.log('HybridPoolMonitorService initialized');
  }

  async onModuleInit() {
    try {
      this.logger.log('[HybridPoolMonitorService] Starting hybrid pool monitoring...');
      
      // Start the status 6 monitoring
      await this.startStatus6Monitoring();
      
      this.isInitialized = true;
      this.logger.log('[HybridPoolMonitorService] ✅ Hybrid monitoring active');
      this.logger.log('[HybridPoolMonitorService] 🏌️‍♂️ Watching for: Tee up (initialize2) → Swing (status 6)');
    } catch (error) {
      this.logger.error('[HybridPoolMonitorService] Failed to initialize:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('[HybridPoolMonitorService] Shutting down...');
    
    if (this.subscriptionId !== null) {
      try {
        await this.connection.removeProgramAccountChangeListener(this.subscriptionId);
        this.logger.log('[HybridPoolMonitorService] Removed program account change listener');
      } catch (error) {
        this.logger.error('[HybridPoolMonitorService] Error removing listener:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    this.teedUpPools.clear();
    this.isInitialized = false;
  }

  // Method called by the existing NestJS listener when initialize2 is detected
  public onPoolTeedUp(poolId: string, tokenA: TokenInfo, tokenB: TokenInfo) {
    if (!this.isInitialized) {
      throw new Error('HybridPoolMonitorService not initialized');
    }

    this.logger.log(`[HybridPoolMonitorService] 🏌️‍♂️ POOL TEED UP: ${poolId}`);
    this.logger.log(`[HybridPoolMonitorService] Base: ${tokenA.symbol} (${tokenA.mint})`);
    this.logger.log(`[HybridPoolMonitorService] Quote: ${tokenB.symbol} (${tokenB.mint})`);

    // Add to our tracking
    this.teedUpPools.set(poolId, {
      pool_id: poolId,
      token_a: tokenA,
      token_b: tokenB,
      teed_up_at: Date.now(),
      detected_status_6: false
    });

    // Broadcast the tee up event
    this.broadcastPoolTeedUp(poolId, tokenA, tokenB);
  }

  private async startStatus6Monitoring() {
    try {
      // Monitor for status 6 pools (the "swing")
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

      this.logger.log('[HybridPoolMonitorService] ✅ Status 6 monitoring active');
      this.logger.log('[HybridPoolMonitorService] 🎯 Waiting for pools to swing (hit status 6)...');
    } catch (error) {
      this.logger.error('[HybridPoolMonitorService] Failed to start monitoring:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  private async handleStatus6Detection(updatedAccountInfo: any) {
    try {
      const poolId = updatedAccountInfo.accountId.toString();
      
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
        this.logger.debug(`[HybridPoolMonitorService] Skipping legacy pool ${poolId} (poolOpenTime: 0)`);
        return;
      }

      // Check if pool is actually open for trading
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime < poolState.poolOpenTime) {
        this.logger.debug(`[HybridPoolMonitorService] Pool ${poolId} status 6 but not yet open`);
        return;
      }

      // Check if this is a pool we've been tracking (was teed up)
      const teedUpPool = this.teedUpPools.get(poolId);
      
      if (teedUpPool) {
        // 🎯 PERFECT! This is a pool we've been tracking
        this.logger.log(`[HybridPoolMonitorService] 🏌️‍♂️ SWING DETECTED! Pool ${poolId} hit status 6!`);
        this.logger.log(`[HybridPoolMonitorService] ⏱️  Time from tee up to swing: ${Math.floor((Date.now() - teedUpPool.teed_up_at) / 1000)}s`);
        
        // Update tracking
        teedUpPool.detected_status_6 = true;
        teedUpPool.status_6_detected_at = Date.now();

        // Broadcast the swing event
        await this.broadcastPoolSwing(teedUpPool);

        // Start monitoring this pool for trading activity
        await this.startPoolMonitoring(teedUpPool);

        // Remove from tracking (mission accomplished)
        this.teedUpPools.delete(poolId);

      } else {
        // This is a status 6 pool we weren't tracking (missed the tee up)
        this.logger.log(`[HybridPoolMonitorService] ⚠️  Status 6 pool detected but we missed the tee up: ${poolId}`);
        this.logger.log(`[HybridPoolMonitorService] Base: ${poolState.baseMint}`);
        this.logger.log(`[HybridPoolMonitorService] Quote: ${poolState.quoteMint}`);
        
        // Still process it, but note it's a missed opportunity
        await this.handleMissedTeeUp(poolId, poolState);
      }

    } catch (error) {
      this.logger.error(`[HybridPoolMonitorService] Error handling status 6 detection:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async handleMissedTeeUp(poolId: string, poolState: any) {
    try {
      // Get token information
      const tokenInfo = await this.getTokenInfo(poolState.baseMint, poolState.quoteMint);
      if (!tokenInfo) {
        return;
      }

      // Create a synthetic teed up pool for tracking
      const syntheticPool: TeedUpPool = {
        pool_id: poolId,
        token_a: tokenInfo.baseToken,
        token_b: tokenInfo.quoteToken,
        teed_up_at: Date.now() - 60000, // Assume it was teed up 1 minute ago
        detected_status_6: true,
        status_6_detected_at: Date.now()
      };

      this.logger.log(`[HybridPoolMonitorService] 🔄 Processing missed tee up for pool ${poolId}`);
      
      // Broadcast and start monitoring
      await this.broadcastPoolSwing(syntheticPool);
      await this.startPoolMonitoring(syntheticPool);

    } catch (error) {
      this.logger.error(`[HybridPoolMonitorService] Error handling missed tee up:`, error instanceof Error ? error.message : 'Unknown error');
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
      this.logger.error('[HybridPoolMonitorService] Error getting token info:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  private broadcastPoolTeedUp(poolId: string, tokenA: TokenInfo, tokenB: TokenInfo) {
    try {
      const message = {
        event: 'pool_teed_up' as const,
        pool_id: poolId,
        timestamp: Date.now(),
        data: {
          base_token: tokenA.symbol,
          quote_token: tokenB.symbol,
          base_mint: tokenA.mint,
          quote_mint: tokenB.mint,
          event: 'tee_up'
        }
      };

      this.socketService.broadcast('pool_teed_up', message);
      this.logger.log(`[HybridPoolMonitorService] 📢 Broadcasted tee up: ${poolId}`);
    } catch (error) {
      this.logger.error('[HybridPoolMonitorService] Error broadcasting tee up:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async broadcastPoolSwing(pool: TeedUpPool) {
    try {
      const timeFromTeeUp = Math.floor((Date.now() - pool.teed_up_at) / 1000);
      
      const message = {
        event: 'pool_swing' as const,
        pool_id: pool.pool_id,
        timestamp: Date.now(),
        data: {
          base_token: pool.token_a.symbol,
          quote_token: pool.token_b.symbol,
          base_mint: pool.token_a.mint,
          quote_mint: pool.token_b.mint,
          time_from_tee_up_seconds: timeFromTeeUp,
          event: 'swing',
          detection_method: pool.detected_status_6 ? 'hybrid' : 'status_6_only'
        }
      };

      this.socketService.broadcast('pool_swing', message);
      this.logger.log(`[HybridPoolMonitorService] 📢 Broadcasted swing: ${pool.pool_id} (${timeFromTeeUp}s from tee up)`);
    } catch (error) {
      this.logger.error('[HybridPoolMonitorService] Error broadcasting swing:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async startPoolMonitoring(pool: TeedUpPool) {
    try {
      // Add to PoolMonitorManager for real-time monitoring
      await this.poolMonitorManager.addPool({
        pool_id: pool.pool_id,
        token_a: pool.token_a,
        token_b: pool.token_b
      });

      this.logger.log(`[HybridPoolMonitorService] ✅ Started monitoring for pool ${pool.pool_id}`);
    } catch (error) {
      this.logger.error(`[HybridPoolMonitorService] Error starting pool monitoring for ${pool.pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // Public methods for monitoring and debugging
  public getTeedUpPools(): TeedUpPool[] {
    return Array.from(this.teedUpPools.values());
  }

  public getTeedUpPoolCount(): number {
    return this.teedUpPools.size;
  }

  public isPoolTeedUp(poolId: string): boolean {
    return this.teedUpPools.has(poolId);
  }

  public getPoolStats() {
    return {
      teed_up_pools: this.getTeedUpPoolCount(),
      teed_up_pools_list: this.getTeedUpPools().map(p => ({
        pool_id: p.pool_id,
        teed_up_at: new Date(p.teed_up_at).toISOString(),
        time_since_tee_up: Math.floor((Date.now() - p.teed_up_at) / 1000)
      }))
    };
  }
} 