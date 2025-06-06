import { Injectable, Logger } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { PoolInfo, TokenInfo, PoolUpdateCallback } from './types';

@Injectable()
export class PoolMonitorManager {
  private readonly logger = new Logger(PoolMonitorManager.name);
  private pools: Map<string, any> = new Map();

  constructor(private readonly connection: Connection) {
    this.logger.log('PoolMonitorManager initialized');
  }

  addPool(
    poolInfo: PoolInfo,
    baseToken: TokenInfo,
    quoteToken: TokenInfo,
    onUpdate: PoolUpdateCallback
  ) {
    this.logger.log(`Adding pool ${poolInfo.poolId} to real-time monitoring`);
    this.logger.log(`Pair: ${baseToken.symbol}/${quoteToken.symbol}`);
    
    // Add pool monitoring logic here
    this.pools.set(poolInfo.poolId, {
      poolInfo,
      baseToken,
      quoteToken,
      onUpdate,
      lastUpdate: Date.now()
    });

    this.logger.log(`✅ Pool ${poolInfo.poolId} added to real-time monitoring`);
  }

  removePool(poolId: string) {
    if (this.pools.has(poolId)) {
      this.pools.delete(poolId);
      this.logger.log(`Removed pool ${poolId} from monitoring`);
    }
  }

  getActivePools() {
    return Array.from(this.pools.keys());
  }
} 