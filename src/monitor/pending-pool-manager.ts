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
  private readonly logger = new Logger(PendingPoolManager.name);
  private pendingPools: Map<string, PendingPool> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 1000; // 1 second
  private readonly MAX_ATTEMPTS = 1800; // 30 minutes
  private readonly MAX_ATTEMPTS_READY = 300; // 5 minutes for ready pools

  constructor(
    private readonly connection: Connection,
    private readonly poolMonitorService: PoolMonitorService
  ) {
    this.logger.log('PendingPoolManager initialized');
  }

  addPool(poolId: string, tokenA: string, tokenB: string) {
    this.logger.log(`Adding pool ${poolId} to pending list`);
    this.pendingPools.set(poolId, {
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
    if (!this.checkInterval) {
      this.checkInterval = setInterval(() => this.checkPools(), this.CHECK_INTERVAL);
      this.logger.log('Started checking pending pools');
    }
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.logger.log('Stopped checking pending pools');
    }
  }

  private async checkPools() {
    const now = Date.now();
    const pending = Array.from(this.pendingPools.values()).filter(p => p.state === 'pending');
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
        this.pendingPools.delete(pool.poolId);
      } else if (pool.attempts >= this.MAX_ATTEMPTS) {
        pool.state = 'failed';
        pool.error = 'Not found after max attempts';
        this.logger.warn(`Pool ${pool.poolId} failed after ${this.MAX_ATTEMPTS} attempts`);
        this.pendingPools.delete(pool.poolId);
      }
    });
  }

  getPendingPools() {
    return Array.from(this.pendingPools.values());
  }

  public removePool(poolId: string) {
    this.pendingPools.delete(poolId);
  }
} 