import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { Logger } from '@nestjs/common';
import { PoolMonitorService } from './pool-monitor.service';

export interface PendingPool {
  poolId: string;
  tokenA: string;
  tokenB: string;
  state: 'pending' | 'indexed' | 'failed';
  attempts: number;
  lastChecked: number;
  error?: string;
}

export class PendingPoolManager {
  private pools: Map<string, PendingPool> = new Map();
  private checkInterval: number;
  private maxAttempts: number;
  private connection: Connection;
  private logger = new Logger(PendingPoolManager.name);
  private poolMonitorService: PoolMonitorService;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    connection: Connection,
    poolMonitorService: PoolMonitorService,
    options: {
      checkInterval?: number;
      maxAttempts?: number;
    } = {}
  ) {
    this.connection = connection;
    this.poolMonitorService = poolMonitorService;
    this.checkInterval = options.checkInterval || 30_000; // 30 seconds default
    this.maxAttempts = options.maxAttempts || 30; // 30 attempts default
  }

  addPool(poolId: string, tokenA: string, tokenB: string) {
    this.logger.log(`Adding pool ${poolId} to pending list`);
    this.pools.set(poolId, {
      poolId,
      tokenA,
      tokenB,
      state: 'pending',
      attempts: 0,
      lastChecked: Date.now()
    });
    this.start();
  }

  private start() {
    if (!this.intervalId) {
      this.intervalId = setInterval(() => this.checkPools(), this.checkInterval);
      this.logger.log('Started checking pending pools');
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.log('Stopped checking pending pools');
    }
  }

  private async checkPools() {
    const now = Date.now();
    const pending = Array.from(this.pools.values()).filter(p => p.state === 'pending');
    if (pending.length === 0) {
      this.stop();
      return;
    }

    this.logger.log(`Checking ${pending.length} pending pools...`);
    
    // Batch check existence
    const pubkeys = pending.map(p => new PublicKey(p.poolId));
    let infos: (AccountInfo<Buffer> | null)[] = [];
    try {
      infos = await this.connection.getMultipleAccountsInfo(pubkeys);
    } catch (e) {
      this.logger.error('Batch RPC error:', e);
      return;
    }

    pending.forEach((pool, i) => {
      pool.lastChecked = now;
      pool.attempts++;
      const info = infos[i];
      
      if (info) {
        // Pool exists on-chain, mark as indexed and notify PoolMonitorService
        pool.state = 'indexed';
        this.logger.log(`Pool ${pool.poolId} is now indexed, notifying PoolMonitorService`);
        this.poolMonitorService.handlePoolReady(pool);
        this.pools.delete(pool.poolId);
      } else if (pool.attempts >= this.maxAttempts) {
        pool.state = 'failed';
        pool.error = 'Not found after max attempts';
        this.logger.warn(`Pool ${pool.poolId} failed after ${this.maxAttempts} attempts`);
        this.pools.delete(pool.poolId);
      }
    });
  }

  getPendingPools() {
    return Array.from(this.pools.values());
  }

  public removePool(poolId: string) {
    this.pools.delete(poolId);
  }
} 