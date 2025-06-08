import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { Logger } from '@nestjs/common';
import { DatabaseManager } from './db-manager.js';
import { getCurrentTimestamp } from './db-schema.js';
import { Api } from '@raydium-io/raydium-sdk-v2';
import { decodeRaydiumPoolState } from './raydium-layout.js';
import { insertPoolHistory } from './pool-history-db.js';

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
  private readonly CLEANUP_AGE_MS: number = 2 * 60 * 60 * 1000; // 2 hours
  private readonly RPC_RATE_LIMIT_DELAY = 2000; // 2 seconds between RPC calls
  private readonly MAX_RPC_RETRIES = 5;
  private lastRpcCall: number = 0;
  private rpcRetryDelays: Map<string, number> = new Map();
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
    await this.cleanupOldPools();
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
    try {
      const pools = await this.db.getAllPendingPools();
      for (const pool of pools) {
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
      this.logger.log(`Loaded ${pools.length} existing pools from database`);
    } catch (err) {
      this.logger.error('Error loading existing pools:', err);
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

  private async makeRpcCall<T>(operation: () => Promise<T>, poolId: string): Promise<T> {
    const now = getCurrentTimestamp();
    const retryDelay = this.rpcRetryDelays.get(poolId) || this.RPC_RATE_LIMIT_DELAY;
    
    // Ensure minimum delay between RPC calls
    const timeSinceLastCall = now - this.lastRpcCall;
    if (timeSinceLastCall < retryDelay) {
      await new Promise(resolve => setTimeout(resolve, retryDelay - timeSinceLastCall));
    }

    let attempts = 0;
    while (attempts < this.MAX_RPC_RETRIES) {
      try {
        this.lastRpcCall = getCurrentTimestamp();
        const result = await operation();
        // Reset retry delay on success
        this.rpcRetryDelays.set(poolId, this.RPC_RATE_LIMIT_DELAY);
        return result;
      } catch (err: any) {
        attempts++;
        if (err?.message?.includes('429') || err?.message?.includes('rate limited')) {
          // Exponential backoff: 2s, 4s, 8s, 16s, 32s
          const newDelay = Math.min(retryDelay * 2, 32000);
          this.rpcRetryDelays.set(poolId, newDelay);
          this.logger.warn(`Rate limited for pool ${poolId}, retrying in ${newDelay}ms (attempt ${attempts}/${this.MAX_RPC_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, newDelay));
        } else {
          throw err;
        }
      }
    }
    throw new Error(`Failed after ${this.MAX_RPC_RETRIES} retries for pool ${poolId}`);
  }

  private async checkPoolExists(poolId: string): Promise<boolean> {
    try {
      const exists = await this.makeRpcCall(
        () => this.connection.getAccountInfo(new PublicKey(poolId)),
        poolId
      );
      if (exists) {
        await this.updatePoolState(poolId, 'exists', {
          exists_since: getCurrentTimestamp()
        });
      }
      return !!exists;
    } catch (err) {
      this.logger.error(`Error checking pool existence for ${poolId}:`, err);
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

      // Only log readiness checks at debug level
      this.logger.debug(`Checking pool ${poolId} readiness (Attempt ${attempts})`);

      // Update last readiness check in database
      await this.db.updatePendingPool(poolId, {
        last_readiness_check: now,
        updated_at: now,
        attempts
      });

      const accountInfo = await this.makeRpcCall(
        () => this.connection.getAccountInfo(new PublicKey(poolId)),
        poolId
      );
      if (!accountInfo) {
        if (attempts >= this.maxAttempts) {
          this.logger.log(`❌ Pool ${poolId} failed: Max attempts (${this.maxAttempts}) reached without success`);
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
        // Make trade ready signal very visible
        console.log('\n' + '='.repeat(50));
        console.log('🚀 POOL READY FOR TRADING!');
        console.log('='.repeat(50));
        console.log(`Pool ID: ${poolId}`);
        console.log(`Time to Ready: ${this.formatElapsedTime(poolInfo.firstSeen)}`);
        console.log(`Total Attempts: ${attempts}`);
        console.log('='.repeat(50) + '\n');
        
        await this.updatePoolState(poolId, 'ready', {
          ready_since: now
        });
      } else {
        const timeSinceExists = now - (poolInfo.existsSince || now);
        if (timeSinceExists > this.maxWaitTime) {
          this.logger.log(`❌ Pool ${poolId} failed: Not ready after ${this.formatElapsedTime(poolInfo.existsSince || now)}`);
          await this.updatePoolState(poolId, 'failed', {
            error: 'Not ready after max wait time',
            last_checked: now,
            attempts,
            failed_at: now
          });
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
        const price = pool.price || 0;
        const baseReserve = pool.mintAmountA || 0;
        const quoteReserve = pool.mintAmountB || 0;

        // Log detailed metrics for debugging
        this.logger.debug(`Pool ${poolState.baseMint} metrics:
          TVL: $${tvl.toLocaleString()}
          Price: $${price.toFixed(8)}
          24h Volume: $${volume24h.toLocaleString()}
          Base Reserve: ${baseReserve}
          Quote Reserve: ${quoteReserve}
          Token A: ${pool.mintA.symbol || 'Unknown'} (${pool.mintA.address})
          Token B: ${pool.mintB.symbol || 'Unknown'} (${pool.mintB.address})
        `);

        // Check if pool is trade-ready in Raydium UI sense
        // A pool is considered ready if:
        // 1. It has a valid price (non-zero)
        // 2. It has a valid TVL (non-zero)
        // 3. It has valid reserves (both tokens have non-zero amounts)
        const isTradeReady = price > 0 && tvl > 0 && baseReserve > 0 && quoteReserve > 0;

        if (isTradeReady) {
          this.logger.log(`Pool ${poolState.baseMint} is trade-ready in Raydium UI:
            Price: $${price.toFixed(8)}
            TVL: $${tvl.toLocaleString()}
            Base Reserve: ${baseReserve}
            Quote Reserve: ${quoteReserve}
          `);
        } else {
          this.logger.debug(`Pool ${poolState.baseMint} not yet trade-ready:
            Price: ${price > 0 ? 'valid' : 'invalid'}
            TVL: ${tvl > 0 ? 'valid' : 'invalid'}
            Base Reserve: ${baseReserve > 0 ? 'valid' : 'invalid'}
            Quote Reserve: ${quoteReserve > 0 ? 'valid' : 'invalid'}
          `);
        }

        // Write pool metrics to history database
        try {
          await insertPoolHistory({
            poolId: poolState.baseMint,
            baseSymbol: pool.mintA.symbol || 'Unknown',
            quoteSymbol: pool.mintB.symbol || 'Unknown',
            timestamp: Math.floor(Date.now() / 1000),
            price: price,
            tvl: tvl,
            baseReserve: baseReserve,
            quoteReserve: quoteReserve,
            buyPressure: 0,  // Not available in API
            rugRisk: 0,  // Not available in API
            trend: 'neutral',  // Not available in API
            volume: volume24h
          });
          this.logger.debug(`Updated pool history for ${poolState.baseMint}`);
        } catch (err) {
          this.logger.error(`Failed to write pool history for ${poolState.baseMint}:`, err);
        }

        return isTradeReady;

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

  private async checkPools(): Promise<void> {
    const now = getCurrentTimestamp();
    
    // Process pools in batches to avoid overwhelming RPC
    const pools = Array.from(this.pendingPools.entries());
    for (let i = 0; i < pools.length; i++) {
      const [poolId, poolInfo] = pools[i];
      
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

      // Add delay between pool checks
      if (i < pools.length - 1) {
        await new Promise(resolve => setTimeout(resolve, this.RPC_RATE_LIMIT_DELAY));
      }

      if (poolInfo.state === 'pending') {
        await this.checkPoolExists(poolId);
      } else if (poolInfo.state === 'exists') {
        await this.checkPoolReadiness(poolId);
      }
    }
  }

  private formatElapsedTime(startTime: number): string {
    const now = getCurrentTimestamp();
    const elapsedMs = now - startTime;
    
    // Convert to seconds first to avoid floating point issues
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    // Format based on duration
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      // For very short durations, show at least 1 second
      return `${Math.max(1, seconds)}s`;
    }
  }

  private async printStatusUpdate(): Promise<void> {
    const poolsByState = new Map<PoolState, PendingPoolInfo[]>();
    const now = getCurrentTimestamp();
    
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
        const timeSinceLastCheck = now - (pool.lastChecked || pool.firstSeen);
        const checkInterval = Math.floor(timeSinceLastCheck / 1000); // Convert to seconds
        const lastCheckStr = checkInterval < 60 ? `${checkInterval}s` : `${Math.floor(checkInterval / 60)}m ${checkInterval % 60}s`;
        console.log(`  • ${pool.poolId} (${elapsedTime}, ${attempts} attempts, last check ${lastCheckStr} ago)`);
      }
      console.log('----------------------------------------\n');
    }
  }

  private async cleanupOldPools(): Promise<void> {
    const now = getCurrentTimestamp();
    const cutoffTime = now - this.CLEANUP_AGE_MS;
    
    try {
      // Get all pending pools older than 2 hours
      const oldPools = await this.db.getOldPools(cutoffTime);
      
      for (const pool of oldPools) {
        // Only clean up pools that are still in pending state
        if (pool.state === 'pending') {
          await this.db.updatePendingPool(pool.pool_id, {
            state: 'failed',
            error: 'Cleaned up due to age (2+ hours in pending state)',
            failed_at: now,
            updated_at: now
          });
          this.logger.log(`Cleaned up old pending pool ${pool.pool_id}`);
        }
        // Remove from memory if present
        this.pendingPools.delete(pool.pool_id);
      }
      
      this.logger.log(`Cleaned up ${oldPools.length} old pending pools`);
    } catch (err) {
      this.logger.error('Error during pool cleanup:', err);
    }
  }
} 