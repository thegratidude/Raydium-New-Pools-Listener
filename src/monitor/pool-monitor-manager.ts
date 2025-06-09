import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { TokenInfo } from '../types/token';
import { PoolMonitor } from '../scripts/pool-monitor/monitor';
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
  private statusInterval: NodeJS.Timeout | null = null;
  private lastStatusTime = 0;

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
      
      // Start periodic status reporting
      this.startStatusReporting();
    } catch (error) {
      this.logger.error('[PoolMonitorManager] Failed to initialize:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('[PoolMonitorManager] Shutting down...');
    try {
      // Stop status reporting
      this.stopStatusReporting();
      
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

  private startStatusReporting() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
    }
    
    // Report status every 60 seconds (1 minute)
    this.statusInterval = setInterval(() => {
      this.reportStatus();
    }, 60000);
    
    this.logger.log('[PoolMonitorManager] Started periodic status reporting (every 60 seconds)');
  }

  private stopStatusReporting() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
      this.logger.log('[PoolMonitorManager] Stopped periodic status reporting');
    }
  }

  private reportStatus() {
    if (!this.isInitialized) {
      return;
    }

    const now = Date.now();
    const totalPools = this.pools.size;
    
    if (totalPools === 0) {
      this.logger.log('📊 MONITOR STATUS: No pools currently being monitored');
      return;
    }

    // Separate pools by monitoring state
    const activePools: ManagedPool[] = [];
    const silentPools: ManagedPool[] = [];

    for (const pool of this.pools.values()) {
      if (pool.monitor) {
        // Check if monitor is in silent mode or has detected activity
        if (pool.monitor.isInSilentMode() && !pool.monitor.getHasDetectedActivity()) {
          silentPools.push(pool);
        } else {
          activePools.push(pool);
        }
      } else {
        silentPools.push(pool);
      }
    }

    // Build status message
    let statusMessage = `📊 MONITOR STATUS (${new Date().toLocaleTimeString()})`;
    statusMessage += `\n${'='.repeat(60)}`;
    statusMessage += `\nTotal Pools: ${totalPools}`;
    statusMessage += `\nActive Monitors: ${activePools.length}`;
    statusMessage += `\nSilent Monitors: ${silentPools.length}`;
    
    if (activePools.length > 0) {
      statusMessage += `\n\n🟢 ACTIVE POOLS:`;
      activePools.forEach((pool, index) => {
        const poolIdShort = pool.pool_id.substring(0, 8);
        statusMessage += `\n  ${index + 1}. ${pool.token_a.symbol}/${pool.token_b.symbol} (${poolIdShort}...)`;
      });
    }
    
    if (silentPools.length > 0) {
      statusMessage += `\n\n🔇 SILENT POOLS:`;
      silentPools.forEach((pool, index) => {
        const poolIdShort = pool.pool_id.substring(0, 8);
        statusMessage += `\n  ${index + 1}. ${pool.token_a.symbol}/${pool.token_b.symbol} (${poolIdShort}...)`;
      });
    }

    // Add pending pools info if available
    if (this.pendingPoolManager) {
      const pendingPools = this.pendingPoolManager.getAllPools();
      if (pendingPools.length > 0) {
        statusMessage += `\n\n⏳ PENDING POOLS: ${pendingPools.length}`;
        pendingPools.slice(0, 3).forEach((pool, index) => {
          const poolIdShort = pool.pool_id.substring(0, 8);
          const waitTime = Math.floor((now - pool.last_update_time) / 1000);
          statusMessage += `\n  ${index + 1}. ${pool.token_a.symbol}/${pool.token_b.symbol} (${poolIdShort}...) - ${pool.state} (${waitTime}s)`;
        });
        if (pendingPools.length > 3) {
          statusMessage += `\n  ... and ${pendingPools.length - 3} more`;
        }
      }
    }

    statusMessage += `\n${'='.repeat(60)}`;
    
    this.logger.log(statusMessage);
    this.lastStatusTime = now;
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