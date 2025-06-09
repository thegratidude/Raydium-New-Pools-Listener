import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { TokenInfo } from '../types/token';
import { PoolMonitor } from './pool-monitor';
import { SocketService } from '../gateway/socket.service';
import { PendingPoolManager } from './pending-pool-manager';
import { PoolUpdate, PoolBroadcastMessage, createMarketPressure } from '../types/market';

interface ManagedPool {
  pool_id: string;
  token_a: TokenInfo;
  token_b: TokenInfo;
  monitor: PoolMonitor | null;
}

@Injectable()
export class PoolMonitorManager implements OnModuleInit, OnModuleDestroy {
  private pools: Map<string, ManagedPool> = new Map();
  private readonly logger = new Logger(PoolMonitorManager.name);
  private readonly socketService: SocketService;
  private pendingPoolManager: PendingPoolManager | null = null;
  private readonly httpEndpoint: string;
  private readonly wssEndpoint: string;
  private isInitialized = false;

  constructor(
    private readonly connection: Connection,
    socketService: SocketService,
    pendingPoolManager: PendingPoolManager | null = null,
    httpEndpoint: string = process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
    wssEndpoint: string = process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com'
  ) {
    if (!httpEndpoint || !wssEndpoint) {
      throw new Error('HTTP and WSS endpoints are required');
    }

    this.socketService = socketService;
    this.pendingPoolManager = pendingPoolManager;
    this.httpEndpoint = httpEndpoint;
    this.wssEndpoint = wssEndpoint;
    this.logger.log('PoolMonitorManager initialized');
  }

  async onModuleInit() {
    try {
      this.logger.log('[PoolMonitorManager] Initializing...');
      this.isInitialized = true;
    } catch (error) {
      this.logger.error('[PoolMonitorManager] Failed to initialize:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('[PoolMonitorManager] Shutting down...');
    try {
      // Stop all monitors
      for (const pool of this.pools.values()) {
        if (pool.monitor) {
          try {
            await pool.monitor.stop();
          } catch (error) {
            this.logger.error(`Error stopping monitor for pool ${pool.pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
          }
        }
      }
      this.pools.clear();
      this.isInitialized = false;
    } catch (error) {
      this.logger.error('[PoolMonitorManager] Error during shutdown:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async addPool(poolInfo: { pool_id: string; token_a: TokenInfo; token_b: TokenInfo }) {
    try {
      if (!this.isInitialized) {
        throw new Error('PoolMonitorManager not initialized');
      }

      if (!poolInfo.pool_id || !poolInfo.token_a || !poolInfo.token_b) {
        throw new Error('Invalid pool information: pool_id, token_a, and token_b are required');
      }

      if (this.pools.has(poolInfo.pool_id)) {
        this.logger.debug(`Pool ${poolInfo.pool_id} already exists`);
        return;
      }

      this.logger.log(`Adding pool: ${poolInfo.token_a.symbol}/${poolInfo.token_b.symbol} (${poolInfo.pool_id})`);

      // Create monitor
      const monitor = new PoolMonitor({
        poolId: new PublicKey(poolInfo.pool_id),
        tokenA: poolInfo.token_a,
        tokenB: poolInfo.token_b,
        httpUrl: this.httpEndpoint,
        wssUrl: this.wssEndpoint,
        onUpdate: (update: PoolUpdate) => {
          this.onUpdate(update);
        }
      });

      this.logger.log(`[PoolMonitorManager] Created PoolMonitor for ${poolInfo.token_a.symbol}/${poolInfo.token_b.symbol} (${poolInfo.pool_id.substring(0, 8)}...)`);

      // Store pool info
      this.pools.set(poolInfo.pool_id, {
        pool_id: poolInfo.pool_id,
        token_a: poolInfo.token_a,
        token_b: poolInfo.token_b,
        monitor
      });

      // Start monitoring
      try {
        this.logger.log(`[PoolMonitorManager] Starting monitoring for ${poolInfo.token_a.symbol}/${poolInfo.token_b.symbol} (${poolInfo.pool_id.substring(0, 8)}...)`);
        await monitor.start();
        this.logger.log(`[PoolMonitorManager] ✅ Successfully started monitoring for ${poolInfo.token_a.symbol}/${poolInfo.token_b.symbol} (${poolInfo.pool_id.substring(0, 8)}...)`);
      } catch (error) {
        this.logger.error(`Failed to start monitor for pool ${poolInfo.pool_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        this.pools.delete(poolInfo.pool_id);
        throw error;
      }
    } catch (error) {
      this.logger.error(`Failed to add pool ${poolInfo.pool_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  async removePool(pool_id: string) {
    try {
      if (!this.isInitialized) {
        throw new Error('PoolMonitorManager not initialized');
      }

      if (!pool_id) {
        throw new Error('Invalid pool_id');
      }

      const pool = this.pools.get(pool_id);
      if (!pool) {
        this.logger.log(`[PoolMonitorManager] Pool ${pool_id} not found`);
        return;
      }

      this.logger.log(`[PoolMonitorManager] Removing pool: ${pool.token_a.symbol}/${pool.token_b.symbol} (${pool_id})`);

      if (pool.monitor) {
        try {
          await pool.monitor.stop();
        } catch (error) {
          this.logger.error(`Error stopping monitor for pool ${pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }

      this.pools.delete(pool_id);
    } catch (error) {
      this.logger.error(`Failed to remove pool ${pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  getPool(pool_id: string): ManagedPool | undefined {
    if (!this.isInitialized) {
      throw new Error('PoolMonitorManager not initialized');
    }
    return this.pools.get(pool_id);
  }

  getAllPools(): ManagedPool[] {
    if (!this.isInitialized) {
      throw new Error('PoolMonitorManager not initialized');
    }
    return Array.from(this.pools.values());
  }

  getActiveMonitorCount(): number {
    if (!this.isInitialized) {
      return 0;
    }
    return this.pools.size;
  }

  logMonitorStatus(): void {
    if (!this.isInitialized) {
      this.logger.log('[PoolMonitorManager] Not initialized');
      return;
    }

    const poolCount = this.pools.size;
    this.logger.log(`[PoolMonitorManager] Status: ${poolCount} active monitors`);
    
    if (poolCount > 0) {
      this.logger.log('[PoolMonitorManager] Active pools:');
      for (const [poolId, pool] of this.pools.entries()) {
        this.logger.log(`  • ${pool.token_a.symbol}/${pool.token_b.symbol} (${poolId.substring(0, 8)}...) - Monitor: ${pool.monitor ? '✅ Active' : '❌ Inactive'}`);
      }
    }
  }

  private onUpdate(update: PoolUpdate) {
    try {
      if (update.has_trade_data && this.pendingPoolManager) {
        this.pendingPoolManager.notifyTradeData(update.pool_id, {
          trade_count: update.trade_count || 0,
          reserve_change_percent: update.reserve_change_percent || 0,
          time_since_first_trade: update.time_since_first_trade || 0
        });
      }

      // Convert market pressure to the broadcast format
      const market_pressure = createMarketPressure(update.market_pressure);

      // Broadcast the update
      const broadcastMessage: PoolBroadcastMessage = {
        event: 'pool_update',
        pool_id: update.pool_id,
        timestamp: Date.now(),
        data: {
          price: update.price,
          tvl: update.tvl,
          market_pressure,
          base_token: update.base_token,
          quote_token: update.quote_token,
          base_reserve: update.base_reserve,
          quote_reserve: update.quote_reserve,
          trade_count: update.trade_count,
          reserve_change_percent: update.reserve_change_percent
        }
      };

      this.socketService.broadcastPoolUpdate(broadcastMessage);
    } catch (error) {
      this.logger.error(`Error processing update for pool ${update.pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  setPendingPoolManager(manager: PendingPoolManager) {
    if (!this.isInitialized) {
      throw new Error('PoolMonitorManager not initialized');
    }
    this.pendingPoolManager = manager;
  }
} 