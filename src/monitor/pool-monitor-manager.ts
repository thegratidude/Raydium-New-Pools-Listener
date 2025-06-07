import { Injectable, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './pool-monitor';
import { PoolInfo, TokenInfo, PoolUpdateCallback, PoolSnapshot, MarketPressure, TrendDirection } from './types';
import { Api } from '@raydium-io/raydium-sdk-v2';

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

  constructor(private readonly connection: Connection) {
    this.api = new Api({ cluster: 'mainnet', timeout: 30000 });
    this.setupConnectionHandlers();
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
        const healthCheckPromise = this.connection.getRecentBlockhash();
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

  async addPool(
    poolInfo: PoolInfo,
    baseToken: TokenInfo,
    quoteToken: TokenInfo,
    onUpdate: PoolUpdateCallback
  ) {
    try {
      // Verify pool exists and is accessible before adding
      const poolState = await this.connection.getAccountInfo(new PublicKey(poolInfo.poolId));
      if (!poolState) {
        this.logger.warn(`Pool ${poolInfo.poolId} not found on chain, skipping`);
        return;
      }

      // Check if pool is already being monitored
      if (this.pools.has(poolInfo.poolId)) {
        this.logger.log(`Pool ${poolInfo.poolId} is already being monitored`);
        return;
      }

      this.logger.log(`Adding pool ${poolInfo.poolId} to real-time monitoring`);
      this.logger.log(`Pair: ${baseToken.symbol}/${quoteToken.symbol}`);

      // Subscribe to logs for this specific pool, but only process relevant ones
      this.connection.onLogs(
        new PublicKey(poolInfo.poolId),
        (logs) => {
          // Skip if logs don't contain our program
          if (!logs.logs.some(log => log.includes('RaydiumSwap'))) {
            return;
          }

          // Check for program errors
          if (logs.err) {
            // Only log specific errors we care about
            const error = logs.err as any;
            if (error.InstructionError) {
              const [instructionIndex, errorCode] = error.InstructionError;
              
              // Skip common Custom:30 errors (these are normal during pool operations)
              if (errorCode.Custom === 30) {
                return;
              }

              // Log other program errors that might be important
              if (errorCode.Custom) {
                this.logger.debug(
                  `Program instruction ${instructionIndex} error for pool ${poolInfo.poolId}: Custom(${errorCode.Custom})`
                );
                return;
              }

              // Log other types of errors
              this.logger.warn(
                `Program error in logs for pool ${poolInfo.poolId}: ${JSON.stringify(error, null, 2)}`
              );
            }
            return;
          }

          // Process successful pool operations
          const relevantLogs = logs.logs.filter(log => 
            // Look for specific pool operations we care about
            log.includes('Swap') || 
            log.includes('AddLiquidity') || 
            log.includes('RemoveLiquidity') ||
            log.includes('Initialize')
          );

          if (relevantLogs.length > 0) {
            this.logger.debug(`Pool ${poolInfo.poolId} operation: ${relevantLogs.join(', ')}`);
            // Trigger a state update through the monitor's callback
            const pool = this.pools.get(poolInfo.poolId);
            if (pool?.monitor) {
              // The monitor will handle the update through its scheduled updates
              this.logger.debug(`Triggered state update for pool ${poolInfo.poolId}`);
            }
          }
        },
        'confirmed'
      );

      const monitor = new PoolMonitor(
        this.connection,
        poolInfo.poolId,
        poolInfo.baseMint,
        poolInfo.quoteMint,
        this,
        1000 // 1 second update interval
      );

      // Set the update callback
      monitor.setOnUpdate(onUpdate);

      // Store pool info
      this.pools.set(poolInfo.poolId, {
        poolInfo,
        baseToken,
        quoteToken,
        onUpdate,
        lastUpdate: Date.now(),
        monitor
      });

      await monitor.start();
      this.logger.log(`✅ Pool ${poolInfo.poolId} added to real-time monitoring`);
    } catch (error) {
      this.logger.error(`Failed to start monitoring ${poolInfo.poolId}: ${error.message}`);
      // Clean up if monitor was created but failed to start
      if (this.pools.has(poolInfo.poolId)) {
        this.pools.delete(poolInfo.poolId);
      }
    }
  }

  private handlePoolUpdate(
    poolId: string,
    snapshot: PoolSnapshot,
    pressure: MarketPressure
  ): void {
    // Handle pool updates here
    // This could include broadcasting updates, storing data, etc.
    this.logger.log(`Pool ${poolId} update received:`, {
      price: snapshot.price,
      priceChange: snapshot.priceChange,
      tvl: snapshot.tvl,
      pressure: pressure.value
    });
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