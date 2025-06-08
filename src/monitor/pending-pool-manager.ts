import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { Logger } from '@nestjs/common';
import { DatabaseManager } from './db-manager.js';
import { getCurrentTimestamp } from './db-schema.js';
import { Api } from '@raydium-io/raydium-sdk-v2';
import { decodeRaydiumPoolState } from './raydium-layout.js';

type PoolState = 'pending' | 'exists' | 'ready' | 'failed';

export interface PendingPoolInfo {
    poolId: string;
    state: PoolState;
    firstSeen: number;
    existsSince?: number;
    lastChecked?: number;
    lastReadinessCheck?: number;
    attempts: number;
    error?: string;
}

export interface PendingPool {
    pool_id: string;
    base_mint: string;
    quote_mint: string;
    base_decimals: number;
    quote_decimals: number;
    state: PoolState;
    first_seen: number;
    exists_since?: number;
    ready_since?: number;
    failed_at?: number;
    last_checked: number;
    last_readiness_check?: number;
    attempts: number;
    error?: string;
    initial_price?: number;
    created_at: number;
    updated_at: number;
}

export type PoolStateChangeCallback = (pool: PendingPool) => Promise<void>;

export class PendingPoolManager {
  private pendingPools: Map<string, PendingPoolInfo> = new Map();
  private readonly maxWaitTime: number = 30 * 60 * 1000; // 30 minutes
  private readonly maxReadyWaitTime: number = 15 * 60 * 1000; // 15 minutes
  private readonly checkInterval: number = 1000; // 1 second
  private readonly maxAttempts: number = 1800; // 30 minutes worth of attempts
  private readonly statusUpdateInterval: number = 60 * 1000; // 1 minute
  private db: DatabaseManager;
  private connection: Connection;
  private logger = new Logger(PendingPoolManager.name);
  private onPoolExists: PoolStateChangeCallback | null = null;
  private onPoolReady: PoolStateChangeCallback | null = null;
  private intervalId?: NodeJS.Timeout;
  private statusUpdateIntervalId?: NodeJS.Timeout;
  private readonly READINESS_CHECK_INTERVAL = 1000; // 1 second between readiness checks
  private readonly EXISTENCE_CHECK_INTERVAL = 1000; // 1 second between existence checks
  private readonly MAX_EXISTENCE_ATTEMPTS = 1800; // 30 minutes at 1s intervals

  constructor(connection: Connection) {
    this.connection = connection;
    this.db = new DatabaseManager();
    // Initialization moved to async init()
  }

  async init() {
    await this.db.init();
    await this.loadExistingPools();
    this.start();
  }

  public setCallbacks(
    onPoolExists: PoolStateChangeCallback,
    onPoolReady: PoolStateChangeCallback
  ) {
    this.onPoolExists = onPoolExists;
    this.onPoolReady = onPoolReady;
  }

  private start() {
    if (!this.intervalId) {
      this.intervalId = setInterval(() => this.checkPools(), this.checkInterval);
      this.logger.log('Started checking pending pools');
    }
    if (!this.statusUpdateIntervalId) {
      this.statusUpdateIntervalId = setInterval(() => this.printStatusUpdate(), this.statusUpdateInterval);
      this.logger.log('Started status update interval');
    }
  }

  private stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (this.statusUpdateIntervalId) {
      clearInterval(this.statusUpdateIntervalId);
      this.statusUpdateIntervalId = undefined;
    }
  }

  private async loadExistingPools(): Promise<void> {
    const pool = await this.db.getPendingPool('pending');
    if (pool) {
        this.pendingPools.set(pool.pool_id, {
            poolId: pool.pool_id,
            state: pool.state,
            firstSeen: pool.first_seen,
            existsSince: pool.exists_since,
            lastChecked: pool.last_checked,
            lastReadinessCheck: pool.last_readiness_check,
            attempts: pool.attempts || 0,
            error: pool.error
        });
    }
  }

  public async addPool(
    poolId: string,
    baseMint: string,
    quoteMint: string,
    baseDecimals: number,
    quoteDecimals: number
  ): Promise<void> {
    const now = getCurrentTimestamp();
    const pool: PendingPool = {
        pool_id: poolId,
        base_mint: baseMint,
        quote_mint: quoteMint,
        base_decimals: baseDecimals,
        quote_decimals: quoteDecimals,
        state: 'pending',
        first_seen: now,
        last_checked: now,
        attempts: 0,
        created_at: now,
        updated_at: now
    };

    await this.db.addPendingPool(pool);
    this.pendingPools.set(poolId, {
        poolId,
        state: 'pending',
        firstSeen: now,
        attempts: 0
    });
  }

  private async updatePoolState(
    poolId: string,
    newState: PoolState,
    updates: Partial<Omit<PendingPool, 'pool_id' | 'created_at' | 'updated_at'>> = {}
  ): Promise<void> {
    const poolInfo = this.pendingPools.get(poolId);
    if (!poolInfo) {
        throw new Error(`Pool ${poolId} not found`);
    }

    const now = getCurrentTimestamp();
    const stateUpdates: Partial<PendingPool> = {
        state: newState,
        updated_at: now,
        last_checked: now,
        ...updates
    };

    await this.db.updatePendingPool(poolId, stateUpdates);
    this.pendingPools.set(poolId, {
        ...poolInfo,
        state: newState,
        lastChecked: now
    });

    // Get the full pool info
    const pool = await this.db.getPendingPool(poolId as PoolState);
    if (!pool) return;

    // Call appropriate callback based on state change
    if (newState === 'exists' && this.onPoolExists) {
        await this.onPoolExists(pool);
    } else if (newState === 'ready' && this.onPoolReady) {
        await this.onPoolReady(pool);
    }
  }

  public async checkPools(): Promise<void> {
    const now = getCurrentTimestamp();
    
    for (const [poolId, poolInfo] of this.pendingPools.entries()) {
      if (poolInfo.state === 'ready' || poolInfo.state === 'failed') {
        continue;
      }

      const timeSinceFirstSeen = now - poolInfo.firstSeen;
      if (timeSinceFirstSeen > this.maxWaitTime) {
        await this.updatePoolState(poolId, 'failed', {
          error: 'Max wait time exceeded',
          last_checked: now,
          attempts: (poolInfo.attempts || 0) + 1,
          failed_at: now
        });
        continue;
      }

      const attempts = (poolInfo.attempts || 0) + 1;
      poolInfo.attempts = attempts;
      poolInfo.lastChecked = now;

      // Update attempts in database
      await this.db.updatePendingPool(poolId, {
        attempts,
        last_checked: now,
        updated_at: now
      });

      if (poolInfo.state === 'pending') {
        await this.checkPoolExists(poolId);
      } else if (poolInfo.state === 'exists') {
        await this.checkPoolReadiness(poolId);
      }
    }
  }

  private async checkPoolExists(poolId: string): Promise<boolean> {
    try {
      const exists = await this.connection.getAccountInfo(new PublicKey(poolId));
      if (exists) {
        await this.updatePoolState(poolId, 'exists', {
          exists_since: getCurrentTimestamp()
        });
      }
      return !!exists;
    } catch (err) {
      console.error(`[PendingPoolManager] Error checking pool existence for ${poolId}:`, err);
      return false;
    }
  }

  private async checkPoolReadiness(poolId: string): Promise<void> {
    const poolInfo = this.pendingPools.get(poolId);
    if (!poolInfo) return;

    try {
      const now = getCurrentTimestamp();
      poolInfo.lastReadinessCheck = now;
      const attempts = (poolInfo.attempts || 0) + 1;

      // Log readiness check attempt
      this.logger.log(`Checking pool ${poolId} readiness (Attempt ${attempts})`);

      // Update last readiness check in database
      await this.db.updatePendingPool(poolId, {
        last_readiness_check: now,
        updated_at: now,
        attempts
      });

      const accountInfo = await this.connection.getAccountInfo(new PublicKey(poolId));
      if (!accountInfo) {
        if (attempts >= this.maxAttempts) {
          this.logger.log(`Pool ${poolId} failed: Max attempts (${this.maxAttempts}) reached without success`);
          await this.updatePoolState(poolId, 'failed', {
            error: 'Max attempts reached without success',
            last_checked: now,
            attempts,
            failed_at: now
          });
        }
        return;
      }

      // If we have pool info, check if it's ready
      const isReady = await this.isPoolReady(accountInfo);
      if (isReady) {
        this.logger.log(`Pool ${poolId} is now ready for trading!`);
        await this.updatePoolState(poolId, 'ready', {
          ready_since: now
        });
      } else {
        const timeSinceExists = now - (poolInfo.existsSince || now);
        if (timeSinceExists > this.maxWaitTime) {
          this.logger.log(`Pool ${poolId} failed: Not ready after ${this.formatElapsedTime(poolInfo.existsSince || now)}`);
          await this.updatePoolState(poolId, 'failed', {
            error: 'Not ready after max wait time',
            last_checked: now,
            attempts,
            failed_at: now
          });
        } else {
          this.logger.debug(`Pool ${poolId} not ready yet (Attempt ${attempts})`);
        }
      }
    } catch (err) {
      this.logger.error(`Error checking pool readiness for ${poolId}:`, err);
    }
  }

  private async isPoolReady(accountInfo: AccountInfo<Buffer>): Promise<boolean> {
    try {
      // First verify the account data is valid
      if (!accountInfo || !accountInfo.data) {
        this.logger.debug('Invalid account data');
        return false;
      }

      // Decode the pool state to get basic info
      const poolState = decodeRaydiumPoolState(accountInfo.data);
      
      // Create API instance with timeout
      const api = new Api({ cluster: 'mainnet', timeout: 30000 });
      
      try {
        // Try to get pool info from Raydium API
        const poolInfo = await api.fetchPoolById({ ids: poolState.baseMint });
        
        // Check if pool is indexed
        if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
          this.logger.debug(`Pool ${poolState.baseMint} not yet indexed by Raydium API`);
          return false;
        }

        const pool = poolInfo[0];
        
        // Verify token data exists
        if (!pool.mintA || !pool.mintB) {
          this.logger.debug(`Pool ${poolState.baseMint} missing token data`);
          return false;
        }

        // Get pool metrics
        const tvl = pool.tvl || 0;
        const volume24h = pool.day?.volume || 0;

        // Log metrics for debugging
        this.logger.debug(`Pool ${poolState.baseMint} metrics: TVL=$${tvl}, 24h Volume=$${volume24h}`);

        // Check minimum requirements
        if (tvl < 45000) {
          this.logger.debug(`Pool ${poolState.baseMint} has insufficient TVL: $${tvl}`);
          return false;
        }

        if (volume24h < 5000) {
          this.logger.debug(`Pool ${poolState.baseMint} has insufficient 24h volume: $${volume24h}`);
          return false;
        }

        // Pool meets all criteria
        this.logger.log(`Pool ${poolState.baseMint} is ready for monitoring (TVL: $${tvl.toLocaleString()}, 24h Volume: $${volume24h.toLocaleString()})`);
        return true;

      } catch (error: any) {
        // Handle rate limiting
        if (error?.response?.status === 429) {
          this.logger.warn('Raydium API rate limited, will retry later');
          return false;
        }
        
        // Log other API errors
        this.logger.debug(`Error checking pool readiness via API: ${error?.message || error}`);
        return false;
      }
    } catch (err) {
      this.logger.error('Error checking pool readiness:', err);
      return false;
    }
  }

  public getPendingPools(): PendingPoolInfo[] {
    return Array.from(this.pendingPools.values());
  }

  public removePool(poolId: string): void {
    this.pendingPools.delete(poolId);
  }

  private async checkPool(poolId: string, poolInfo: PendingPoolInfo): Promise<void> {
    const now = getCurrentTimestamp();
    const timeSinceFirstSeen = now - poolInfo.firstSeen;

    if (timeSinceFirstSeen > this.maxWaitTime) {
        const updates: Partial<PendingPool> = {
            state: 'failed',
            error: 'Max wait time exceeded',
            last_checked: now,
            attempts: poolInfo.attempts + 1
        };
        await this.db.updatePendingPool(poolId, updates);
        this.pendingPools.delete(poolId);
        return;
    }

    if (poolInfo.attempts >= this.maxAttempts) {
        const updates: Partial<PendingPool> = {
            state: 'failed',
            error: 'Max attempts reached without success',
            last_checked: now,
            attempts: poolInfo.attempts + 1
        };
        await this.db.updatePendingPool(poolId, updates);
        this.pendingPools.delete(poolId);
        return;
    }

    // Check if pool exists
    const exists = await this.checkPoolExists(poolId);
    if (!exists) {
        const updates: Partial<PendingPool> = {
            state: 'pending',
            last_checked: now,
            attempts: poolInfo.attempts + 1
        };
        await this.db.updatePendingPool(poolId, updates);
        this.updatePoolInfo(poolId, {
            state: 'pending',
            lastChecked: now,
            attempts: poolInfo.attempts + 1
        });
        return;
    }

    // Update to exists state if not already
    if (poolInfo.state === 'pending') {
        const updates: Partial<PendingPool> = {
            state: 'exists',
            exists_since: now,
            last_checked: now,
            attempts: poolInfo.attempts + 1
        };
        await this.db.updatePendingPool(poolId, updates);
        this.updatePoolInfo(poolId, {
            state: 'exists',
            existsSince: now,
            lastChecked: now,
            attempts: poolInfo.attempts + 1
        });
        return;
    }

    // Check if pool is ready
    const isReady = await this.checkPoolReady(poolId);
    if (isReady) {
        const updates: Partial<PendingPool> = {
            state: 'ready',
            last_checked: now,
            last_readiness_check: now,
            attempts: poolInfo.attempts + 1
        };
        await this.db.updatePendingPool(poolId, updates);
        this.pendingPools.delete(poolId);
        return;
    }

    // Check if we've waited too long for readiness
    const timeSinceExists = poolInfo.existsSince ? now - poolInfo.existsSince : 0;
    if (timeSinceExists > this.maxReadyWaitTime) {
        const updates: Partial<PendingPool> = {
            state: 'failed',
            error: 'Not ready after max wait time',
            last_checked: now,
            last_readiness_check: now,
            attempts: poolInfo.attempts + 1
        };
        await this.db.updatePendingPool(poolId, updates);
        this.pendingPools.delete(poolId);
        return;
    }

    // Update last check time
    const updates: Partial<PendingPool> = {
        state: 'exists',
        last_checked: now,
        attempts: poolInfo.attempts + 1
    };
    await this.db.updatePendingPool(poolId, updates);
    this.updatePoolInfo(poolId, {
        lastChecked: now,
        attempts: poolInfo.attempts + 1
    });
  }

  private updatePoolInfo(poolId: string, updates: Partial<PendingPoolInfo>): void {
    const poolInfo = this.pendingPools.get(poolId);
    if (poolInfo) {
      this.pendingPools.set(poolId, { ...poolInfo, ...updates });
    }
  }

  private async checkPoolReady(poolId: string): Promise<boolean> {
    try {
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(poolId));
      if (!accountInfo) return false;
      return await this.isPoolReady(accountInfo);
    } catch (err) {
      this.logger.error(`Error checking pool readiness for ${poolId}:`, err);
      return false;
    }
  }

  private formatElapsedTime(startTime: number): string {
    const now = getCurrentTimestamp();
    const elapsedMs = now - startTime;
    const minutes = Math.floor(elapsedMs / 60000);
    const seconds = Math.floor((elapsedMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  private async printStatusUpdate(): Promise<void> {
    const poolsByState = new Map<PoolState, PendingPoolInfo[]>();
    
    // Group pools by state
    for (const pool of this.pendingPools.values()) {
      if (!poolsByState.has(pool.state)) {
        poolsByState.set(pool.state, []);
      }
      poolsByState.get(pool.state)!.push(pool);
    }

    // Only print if we have pools to show
    const totalPools = Array.from(poolsByState.values()).reduce((sum, pools) => sum + pools.length, 0);
    if (totalPools === 0) {
      return;
    }

    // Print status update
    console.log(`\n📊 Pool Status Update: ${new Date().toLocaleTimeString()}`);
    console.log('----------------------------------------\n');

    // Print each state group
    for (const [state, pools] of poolsByState.entries()) {
      if (pools.length === 0) continue;

      const stateEmoji = {
        'pending': '⏳',
        'exists': '🔍',
        'ready': '✅',
        'failed': '❌'
      }[state];

      console.log(`${stateEmoji} ${state.toUpperCase()} Pools (${pools.length}):`);
      for (const pool of pools) {
        const elapsedTime = this.formatElapsedTime(pool.firstSeen);
        const attempts = pool.attempts || 0;
        console.log(`  • ${pool.poolId} (${elapsedTime}, ${attempts} attempts)`);
      }
      console.log('----------------------------------------\n');
    }
  }
} 