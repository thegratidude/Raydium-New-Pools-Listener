import { Injectable, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { Api } from '@raydium-io/raydium-sdk-v2';
import { PoolMonitor } from './pool-monitor.js';
import { PoolInfo, TokenInfo, PoolUpdateCallback, PoolSnapshot, MarketPressure, TrendDirection } from './types.js';
import { DatabaseManager } from './db-manager.js';
import { getCurrentTimestamp } from './db-schema.js';

interface PoolStats {
    pool_id: string;
    first_seen: number;
    last_updated: number;
    total_snapshots: number;
    avg_price: number;
    avg_tvl: number;
    total_volume: number;
    total_trades: number;
    max_price: number;
    min_price: number;
    max_tvl: number;
    min_tvl: number;
    price_volatility: number;
    tvl_volatility: number;
    avg_market_pressure: number;
    max_market_pressure: number;
    suspicious_count: number;
    avg_risk_score: number;
}

@Injectable()
export class PoolMonitorManager {
  private readonly logger = new Logger(PoolMonitorManager.name);
  private pools: Map<string, {
    poolInfo: PoolInfo;
    baseToken: TokenInfo;
    quoteToken: TokenInfo;
    onUpdate: PoolUpdateCallback;
    lastUpdate: number;
    monitor?: PoolMonitor;
    lastSnapshot?: PoolSnapshot;
  }> = new Map();
  private api: Api;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY = 5000; // 5 seconds
  private isInCooldown: boolean = false;
  private readonly COOLDOWN_PERIOD = 60000; // Increase cooldown to 1 minute
  private healthCheckInterval = 30000; // Start with 30s
  private consecutiveFailures = 0;
  private readonly maxHealthCheckInterval = 300000; // Max 5 minutes
  private readonly MAX_CONSECUTIVE_FAILURES = 5; // Require more consecutive failures before reconnecting
  private lastHealthCheckTime: number = Date.now();
  private readonly HEALTH_CHECK_TIMEOUT = 10000; // 10 second timeout for health checks
  private monitors: Map<string, PoolMonitor> = new Map();
  private db: DatabaseManager;
  private readonly snapshotInterval: number = 1000; // 1 second
  private readonly significantPriceChange = 0.05; // 5%
  private readonly significantTvlChange = 0.1; // 10%
  private subscribers: Map<string, Set<(update: PoolSnapshot) => void>> = new Map();

  constructor(private readonly connection: Connection) {
    this.api = new Api({ cluster: 'mainnet', timeout: 30000 });
    this.setupConnectionHandlers();
    this.db = new DatabaseManager();
  }

  async onModuleInit() {
    await this.db.init();
  }

  private setupConnectionHandlers() {
    const healthCheck = async () => {
      const now = Date.now();
      const timeSinceLastCheck = now - this.lastHealthCheckTime;
      
      // Skip if we're in cooldown
      if (this.isInCooldown) {
        this.logger.debug('Skipping health check during cooldown period');
        setTimeout(healthCheck, this.healthCheckInterval);
        return;
      }

      try {
        // Add timeout to health check
        const healthCheckPromise = this.connection.getLatestBlockhash();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), this.HEALTH_CHECK_TIMEOUT)
        );
        
        await Promise.race([healthCheckPromise, timeoutPromise]);
        
        // Success - reset counters and log if we had previous failures
        if (this.consecutiveFailures > 0) {
          this.logger.log(`Connection health check succeeded after ${this.consecutiveFailures} failures`);
        }
        this.consecutiveFailures = 0;
        this.healthCheckInterval = 30000; // Reset to base interval
        this.lastHealthCheckTime = now;
      } catch (error) {
        this.consecutiveFailures++;
        const isTimeout = error.message === 'Health check timeout';
        
        this.logger.warn(
          `Connection health check failed (attempt ${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES})` +
          `${isTimeout ? ' - timeout' : ''} - ${error.message}`
        );
        
        // Only trigger reconnection if we've had enough consecutive failures
        if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
          this.logger.warn('Multiple consecutive health check failures, initiating reconnection...');
          this.handleConnectionError(error);
          
          // Increase interval exponentially up to max
          this.healthCheckInterval = Math.min(
            this.healthCheckInterval * 1.5, // More gradual increase
            this.maxHealthCheckInterval
          );
        }
      }
      
      // Schedule next check
      setTimeout(healthCheck, this.healthCheckInterval);
    };

    // Start health check
    healthCheck();
  }

  private handleConnectionError(error: Error) {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `Max reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached, ` +
        `entering ${this.COOLDOWN_PERIOD/1000}s cooldown period`
      );
      this.isInCooldown = true;
      
      // Reset after cooldown period
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.isInCooldown = false;
        this.consecutiveFailures = 0;
        this.healthCheckInterval = 30000;
        this.logger.log('Cooldown period ended, resuming normal operation');
      }, this.COOLDOWN_PERIOD);
      
      return;
    }

    this.reconnectAttempts++;
    const backoffTime = Math.min(
      1000 * Math.pow(1.5, this.reconnectAttempts - 1), // More gradual backoff
      30000
    );
    
    this.logger.warn(
      `Connection error (${error.message}), ` +
      `attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}, ` +
      `retrying in ${backoffTime/1000}s`
    );
    
    setTimeout(() => {
      if (!this.isInCooldown) {
        this.reconnectAllMonitors();
      }
    }, backoffTime);
  }

  private async reconnectAllMonitors(): Promise<void> {
    this.logger.log('Attempting to reconnect all monitors...');
    const reconnectPromises = [];

    for (const [poolId, { monitor }] of this.pools.entries()) {
      if (monitor) {
        reconnectPromises.push(
          (async () => {
            try {
              await monitor.start();
              this.logger.log(`Successfully reconnected monitor for pool ${poolId}`);
            } catch (error) {
              this.logger.error(`Failed to reconnect monitor for pool ${poolId}:`, error);
              // If a monitor fails to reconnect after multiple attempts, remove it
              if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
                this.logger.warn(`Removing pool ${poolId} due to persistent connection issues`);
                this.pools.delete(poolId);
              }
            }
          })()
        );
      }
    }

    // Wait for all reconnection attempts to complete
    await Promise.all(reconnectPromises);
  }

  private updatePoolState(poolId: string) {
    const pool = this.pools.get(poolId);
    if (!pool?.monitor) {
      return;
    }

    // The monitor will handle updates through its scheduled updates
    this.logger.debug(`Triggered state update for pool ${poolId}`);
  }

  public async addPool(
    poolId: string,
    baseMint: string,
    quoteMint: string,
    baseDecimals: number,
    quoteDecimals: number,
    onUpdate?: (update: PoolSnapshot) => void
  ): Promise<void> {
    if (this.monitors.has(poolId)) {
      this.logger.log(`Pool ${poolId} is already being monitored`);
      return;
    }

    // Verify pool is ready in database
    const pool = await this.db.getPendingPool('ready');
    if (!pool || pool.pool_id !== poolId) {
      throw new Error(`Pool ${poolId} is not ready for monitoring`);
    }

    const monitor = new PoolMonitor(poolId);
    if (onUpdate) {
      monitor.setOnUpdate(onUpdate);
      this.subscribers.set(poolId, new Set([onUpdate]));
    }

    this.monitors.set(poolId, monitor);
    await monitor.start();
  }

  public async removePool(poolId: string): Promise<void> {
    const monitor = this.monitors.get(poolId);
    if (monitor) {
      await monitor.stop();
      this.monitors.delete(poolId);
      this.subscribers.delete(poolId);
    }
  }

  private notifySubscribers(poolId: string, update: PoolSnapshot): void {
    const poolSubscribers = this.subscribers.get(poolId);
    if (poolSubscribers) {
      for (const subscriber of poolSubscribers) {
        try {
          subscriber(update);
        } catch (err) {
          this.logger.error(`Error notifying subscriber for pool ${poolId}:`, err);
        }
      }
    }
  }

  public getPoolHistory(poolId: string, startTime?: number, endTime?: number): Promise<PoolSnapshot[]> {
    return this.db.getPoolSnapshots(poolId, startTime, endTime);
  }

  public getPoolStats(poolId: string): Promise<PoolStats> {
    return this.db.getPoolStats(poolId);
  }

  public subscribe(poolId: string, callback: (update: PoolSnapshot) => void): void {
    if (!this.subscribers.has(poolId)) {
      this.subscribers.set(poolId, new Set());
    }
    this.subscribers.get(poolId)?.add(callback);
  }

  public unsubscribe(poolId: string, callback: (update: PoolSnapshot) => void): void {
    this.subscribers.get(poolId)?.delete(callback);
  }

  async getInitialQuote(poolId: string, baseMint: string, quoteMint: string): Promise<{
    price: number | undefined;
    baseReserve: number | undefined;
    quoteReserve: number | undefined;
  }> {
    const MAX_RETRIES = 15;
    const RETRY_DELAY = 2000; // 2 seconds

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.log(`Attempt ${attempt}/${MAX_RETRIES} to get initial quote for pool ${poolId}`);

        // Get pool account
        const poolAccount = await this.connection.getAccountInfo(new PublicKey(poolId));
        if (!poolAccount) {
          this.logger.warn(`Pool account not found for ${poolId} on attempt ${attempt}`);
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            continue;
          }
          return { price: undefined, baseReserve: undefined, quoteReserve: undefined };
        }

        // Get vault accounts
        const poolState = await this.api.fetchPoolById({ ids: poolId });
        if (!poolState || !poolState[0]) {
          this.logger.warn(`Pool state not found for ${poolId} on attempt ${attempt}`);
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            continue;
          }
          return { price: undefined, baseReserve: undefined, quoteReserve: undefined };
        }

        const pool = poolState[0];
        const baseReserve = pool.mintAmountA || 0;
        const quoteReserve = pool.mintAmountB || 0;
        const price = pool.price || 0;

        if (baseReserve === 0 || quoteReserve === 0) {
          this.logger.warn(`Zero reserves for pool ${poolId} on attempt ${attempt}`);
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            continue;
          }
          return { price: undefined, baseReserve: undefined, quoteReserve: undefined };
        }

        this.logger.log(`✅ Got initial quote for pool ${poolId}:`);
        this.logger.log(`Price: ${price}`);
        this.logger.log(`Base Reserve: ${baseReserve}`);
        this.logger.log(`Quote Reserve: ${quoteReserve}`);

        return { price, baseReserve, quoteReserve };

      } catch (error) {
        this.logger.warn(`Error getting initial quote for pool ${poolId} on attempt ${attempt}:`, error);
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        this.logger.error(`Failed to get initial quote for pool ${poolId} after ${MAX_RETRIES} attempts`);
        this.logger.error('Last error:', error);
        return { price: undefined, baseReserve: undefined, quoteReserve: undefined };
      }
    }

    return { price: undefined, baseReserve: undefined, quoteReserve: undefined };
  }

  async getPoolInfo(poolId: string): Promise<any | null> {
    try {
      // Try to get pool info from Raydium API
      const poolState = await this.api.fetchPoolById({ ids: poolId });
      if (!poolState || !poolState[0]) {
        return null;
      }
      return poolState[0];
    } catch (error) {
      this.logger.debug(`Error getting pool info for ${poolId}:`, error);
      return null;
    }
  }
} 