import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { TokenInfo } from '../types/token';
import { PoolMonitor, PoolUpdate } from './pool-monitor';
import { SocketService } from '../gateway/socket.service';
import { PoolBroadcastMessage } from './types';

interface ManagedPool {
  poolId: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  monitor?: PoolMonitor;
}

@Injectable()
export class PoolMonitorManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolMonitorManager.name);
  private pools: Map<string, ManagedPool> = new Map();
  private readonly httpUrl: string;
  private readonly wssUrl: string;

  constructor(
    private readonly connection: Connection,
    private readonly socketService: SocketService | undefined,
    httpEndpoint?: string,
    wssEndpoint?: string
  ) {
    this.httpUrl = httpEndpoint || 'https://api.mainnet-beta.solana.com';
    this.wssUrl = wssEndpoint || 'wss://api.mainnet-beta.solana.com';
    this.logger.log('PoolMonitorManager initialized');
  }

  async onModuleInit() {
    this.logger.log('[PoolMonitorManager] Initializing...');
  }

  async onModuleDestroy() {
    this.logger.log('[PoolMonitorManager] Shutting down...');
    // Stop all monitors
    for (const pool of this.pools.values()) {
      if (pool.monitor) {
        // Since we removed the stop method, we'll just set the monitor to undefined
        pool.monitor = undefined;
      }
    }
  }

  async addPool(poolInfo: { poolId: string; tokenA: TokenInfo; tokenB: TokenInfo }) {
    if (this.pools.has(poolInfo.poolId)) {
      this.logger.log(`[PoolMonitorManager] Pool ${poolInfo.poolId} already exists`);
      return;
    }

    this.logger.log(`[PoolMonitorManager] Adding pool: ${poolInfo.tokenA.symbol}/${poolInfo.tokenB.symbol} (${poolInfo.poolId})`);

    // Create monitor
    const monitor = new PoolMonitor({
      poolId: new PublicKey(poolInfo.poolId),
      tokenA: poolInfo.tokenA,
      tokenB: poolInfo.tokenB,
      httpUrl: this.httpUrl,
      wssUrl: this.wssUrl,
      onUpdate: (update: PoolUpdate) => {
        this.logger.log(`[PoolMonitor] Update for ${update.poolId}:`, {
          baseReserve: update.baseReserve,
          quoteReserve: update.quoteReserve,
          timestamp: new Date(update.timestamp).toISOString()
        });

        // Broadcast to socket clients if socket service is available
        if (this.socketService?.isReady()) {
          const broadcastMessage: PoolBroadcastMessage = {
            event: 'pool_update',
            pool_id: update.poolId,
            timestamp: update.timestamp,
            data: {
              pair: `${poolInfo.tokenA.symbol}/${poolInfo.tokenB.symbol}`,
              price: update.baseReserve / update.quoteReserve, // Simple price calculation
              price_change: 0, // We don't have historical data for change
              tvl: update.baseReserve + update.quoteReserve, // Simple TVL calculation
              volume_24h: 0, // We don't have volume data yet
              market_pressure: {
                buy_pressure: 0,
                sell_pressure: 0,
                trend: 'neutral',
                rug_risk: 0
              },
              reserves: {
                base_reserve: update.baseReserve,
                quote_reserve: update.quoteReserve,
                base_symbol: poolInfo.tokenA.symbol,
                quote_symbol: poolInfo.tokenB.symbol
              },
              origin_data: {
                price: update.baseReserve / update.quoteReserve,
                base_reserve: update.baseReserve,
                quote_reserve: update.quoteReserve,
                timestamp: update.timestamp
              }
            }
          };
          this.socketService.broadcastPoolUpdate(broadcastMessage);
        }
      }
    });

    // Store pool info
    this.pools.set(poolInfo.poolId, {
      ...poolInfo,
      monitor
    });

    // Start monitoring
    await monitor.start();
  }

  async removePool(poolId: string) {
    const pool = this.pools.get(poolId);
    if (!pool) {
      this.logger.log(`[PoolMonitorManager] Pool ${poolId} not found`);
      return;
    }

    this.logger.log(`[PoolMonitorManager] Removing pool: ${pool.tokenA.symbol}/${pool.tokenB.symbol} (${poolId})`);

    // Since we removed the stop method, we'll just set the monitor to undefined
    if (pool.monitor) {
      pool.monitor = undefined;
    }

    this.pools.delete(poolId);
  }

  getPool(poolId: string): ManagedPool | undefined {
    return this.pools.get(poolId);
  }

  getAllPools(): ManagedPool[] {
    return Array.from(this.pools.values());
  }
} 