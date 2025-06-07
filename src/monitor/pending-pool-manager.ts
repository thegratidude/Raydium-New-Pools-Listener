import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { Logger } from '@nestjs/common';
import { PoolMonitorService } from './pool-monitor.service';

export interface PendingPool {
  poolId: string;
  tokenA: string;
  tokenB: string;
  state: 'pending' | 'exists' | 'ready' | 'failed';
  attempts: number;
  lastChecked: number;
  error?: string;
  existsSince?: number;
  lastReadinessCheck?: number;
}

export class PendingPoolManager {
  private pools: Map<string, PendingPool> = new Map();
  private checkInterval: number;
  private maxAttempts: number;
  private connection: Connection;
  private logger = new Logger(PendingPoolManager.name);
  private poolMonitorService: PoolMonitorService;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly READINESS_CHECK_INTERVAL = 1000; // 1 second between readiness checks
  private readonly MAX_READINESS_WAIT = 15 * 60 * 1000; // 15 minutes max wait for readiness
  private readonly EXISTENCE_CHECK_INTERVAL = 1000; // 1 second between existence checks
  private readonly MAX_EXISTENCE_ATTEMPTS = 1800; // 30 minutes at 1s intervals

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
    this.checkInterval = options.checkInterval || this.EXISTENCE_CHECK_INTERVAL; // 1 second default
    this.maxAttempts = options.maxAttempts || this.MAX_EXISTENCE_ATTEMPTS; // 1800 attempts = 30 minutes at 1s intervals
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
    const pending = Array.from(this.pools.values()).filter(p => p.state === 'pending' || p.state === 'exists');
    if (pending.length === 0) {
      this.stop();
      return;
    }

    this.logger.debug(`Checking ${pending.length} pending pools...`);
    
    // Process each pool individually for faster response
    for (const pool of pending) {
      try {
        pool.lastChecked = now;
        pool.attempts++;
        
        // Get pool info directly
        const info = await this.connection.getAccountInfo(new PublicKey(pool.poolId));
        
        if (info) {
          if (pool.state === 'pending') {
            // Pool just found to exist
            pool.state = 'exists';
            pool.existsSince = now;
            pool.lastReadinessCheck = now;
            this.logger.log(`Pool ${pool.poolId} exists on-chain, starting readiness checks`);
            this.poolMonitorService.handlePoolExists(pool);
          }

          // Check if it's time for a readiness check
          if (pool.state === 'exists' && 
              now - (pool.lastReadinessCheck || 0) >= this.READINESS_CHECK_INTERVAL) {
            pool.lastReadinessCheck = now;
            
            try {
              const isReady = await this.checkPoolReadiness(pool);
              if (isReady) {
                pool.state = 'ready';
                this.logger.log(`Pool ${pool.poolId} is now ready to trade!`);
                this.poolMonitorService.handlePoolReady(pool);
                this.pools.delete(pool.poolId);
              } else if (now - (pool.existsSince || now) > this.MAX_READINESS_WAIT) {
                pool.state = 'failed';
                pool.error = 'Not ready after max wait time';
                this.logger.warn(`Pool ${pool.poolId} failed: ${pool.error}`);
                this.pools.delete(pool.poolId);
              }
            } catch (error) {
              this.logger.warn(`Readiness check failed for pool ${pool.poolId}:`, error);
            }
          }
        } else if (pool.attempts >= this.maxAttempts) {
          pool.state = 'failed';
          pool.error = 'Not found after max attempts';
          this.logger.warn(`Pool ${pool.poolId} failed after ${this.maxAttempts} attempts`);
          this.pools.delete(pool.poolId);
        }
      } catch (error) {
        this.logger.error(`Error checking pool ${pool.poolId}:`, error);
      }
    }
  }

  private async checkPoolReadiness(pool: PendingPool): Promise<boolean> {
    try {
      // Get pool state
      const poolState = await this.poolMonitorService.getPoolState(pool.poolId);
      if (!poolState) {
        this.logger.debug(`Pool ${pool.poolId} state not yet available`);
        return false;
      }

      // Check if pool is indexed
      const isIndexed = await this.poolMonitorService.isPoolIndexed(pool.poolId);
      if (!isIndexed) {
        this.logger.debug(`Pool ${pool.poolId} not yet indexed by Raydium API`);
        return false;
      }

      // Get detailed pool info
      const poolInfo = await this.poolMonitorService.getPoolInfo(pool.poolId);
      if (!poolInfo) {
        this.logger.debug(`Pool ${pool.poolId} not found in Raydium API`);
        return false;
      }

      // Check if pool is properly initialized
      if (!poolInfo.id || !poolInfo.mintA || !poolInfo.mintB) {
        this.logger.debug(`Pool ${pool.poolId} not fully initialized in Raydium API`);
        return false;
      }

      // Check if both vaults have non-zero reserves
      if (!poolState.baseReserve || !poolState.quoteReserve || 
          poolState.baseReserve === 0 || poolState.quoteReserve === 0) {
        this.logger.debug(`Pool ${pool.poolId} reserves not yet initialized:
          Base Reserve: ${poolState.baseReserve}
          Quote Reserve: ${poolState.quoteReserve}`);
        return false;
      }

      // Check if we can get a valid price
      if (!poolState.price || poolState.price <= 0) {
        this.logger.debug(`Pool ${pool.poolId} price not yet valid: ${poolState.price}`);
        return false;
      }

      // Check if pool has proper token info
      if (!poolInfo.mintA.symbol || !poolInfo.mintB.symbol || 
          !poolInfo.mintA.decimals || !poolInfo.mintB.decimals) {
        this.logger.debug(`Pool ${pool.poolId} token info not complete:
          Base Token: ${poolInfo.mintA.symbol} (${poolInfo.mintA.decimals} decimals)
          Quote Token: ${poolInfo.mintB.symbol} (${poolInfo.mintB.decimals} decimals)`);
        return false;
      }

      // Check if pool has proper program info
      if (!poolInfo.programId || !poolInfo.authority) {
        this.logger.debug(`Pool ${pool.poolId} program info not complete:
          Program ID: ${poolInfo.programId}
          Authority: ${poolInfo.authority}`);
        return false;
      }

      // All checks passed
      this.logger.log(`Pool ${pool.poolId} is ready to trade:
        Base Token: ${poolInfo.mintA.symbol} (${poolInfo.mintA.decimals} decimals)
        Quote Token: ${poolInfo.mintB.symbol} (${poolInfo.mintB.decimals} decimals)
        Price: ${poolState.price}
        Base Reserve: ${poolState.baseReserve}
        Quote Reserve: ${poolState.quoteReserve}
        TVL: ${poolState.baseReserve * poolState.price + poolState.quoteReserve}`);

      return true;
    } catch (error) {
      this.logger.debug(`Readiness check error for pool ${pool.poolId}:`, error);
      return false;
    }
  }

  getPendingPools() {
    return Array.from(this.pools.values());
  }

  public removePool(poolId: string) {
    this.pools.delete(poolId);
  }
} 