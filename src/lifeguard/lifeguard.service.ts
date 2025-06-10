import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PositionManagerService } from '../position-manager/position-manager.service';
import { Status6Pool, PoolSnapshot } from '../position-manager/database/position-manager-db';
import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@project-serum/anchor';

interface PoolMonitor {
  poolId: string;
  baseVault: string;
  quoteVault: string;
  baselineRatio: number;
  baselineTVL: number;
  baselinePrice: number; // Add baseline price in SOL
  startTime: number;
  timeoutId: NodeJS.Timeout;
  lastUpdate: number;
  priority: 'high' | 'medium' | 'low'; // Priority based on TVL/activity
  updateInterval: number; // Dynamic update interval
  consecutiveErrors: number; // Track errors for backoff
  lastPrice: number; // Track last price to detect changes
  lastTVL: number; // Track last TVL to detect changes
}

interface PoolMetrics {
  baseReserve: number;
  quoteReserve: number;
  reserveRatio: number;
  tvl: number;
  profitLossPercent: number;
  tvlChangePercent: number;
  timestamp: number;
}

interface RateLimitConfig {
  maxRequestsPerSecond: number;
  maxConcurrentRequests: number;
  batchSize: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

@Injectable()
export class LifeguardService implements OnModuleInit {
  private readonly logger = new Logger(LifeguardService.name);
  private readonly connection: Connection;
  private readonly monitoredPools = new Map<string, PoolMonitor>();
  private readonly MONITORING_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
  private readonly DEFAULT_UPDATE_INTERVAL = 2000; // 2 seconds default
  private isInitialized = false;

  // Rate limiting and optimization
  private readonly rateLimitConfig: RateLimitConfig = {
    maxRequestsPerSecond: 10, // Conservative RPC rate limit
    maxConcurrentRequests: 5,
    batchSize: 3, // Process pools in batches
    backoffMultiplier: 1.5,
    maxBackoffMs: 30000 // Max 30 second backoff
  };

  private requestQueue: Array<() => Promise<void>> = [];
  private activeRequests = 0;
  private lastRequestTime = 0;
  private requestCount = 0;
  private lastResetTime = Date.now();

  // Batch processing
  private batchUpdateTimer: NodeJS.Timeout | null = null;
  private pendingUpdates = new Set<string>();

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly positionManagerService: PositionManagerService,
  ) {
    let rpcUrl = process.env.HELIUS_RPC_URL;
    if (!rpcUrl || !rpcUrl.startsWith('http')) {
      rpcUrl = 'https://api.mainnet-beta.solana.com';
    }
    this.connection = new Connection(rpcUrl);
  }

  async onModuleInit() {
    this.logger.log('🏊‍♂️ Initializing Lifeguard Service...');
    
    // Wait for system to be fully initialized before starting monitoring
    await this.waitForSystemReady();
    
    // Listen for new Status 6 pools
    this.eventEmitter.on('pool_status_6', (data: any) => {
      this.handleNewPool(data);
    });

    // Start monitoring existing pending pools
    await this.loadExistingPools();
    
    this.isInitialized = true;
    this.logger.log('✅ Lifeguard Service initialized successfully');
  }

  private async waitForSystemReady() {
    this.logger.log('⏳ Waiting for system to be fully initialized...');
    
    // Wait for database to be ready
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max wait
    
    while (attempts < maxAttempts) {
      try {
        const stats = await this.positionManagerService.getDatabaseStats();
        if (stats && stats.total_pools !== undefined) {
          this.logger.log('✅ Database is ready');
          break;
        }
      } catch (error) {
        // Database not ready yet
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
      
      if (attempts % 5 === 0) {
        this.logger.log(`⏳ Still waiting for system initialization... (${attempts}s)`);
      }
    }
    
    if (attempts >= maxAttempts) {
      this.logger.warn('⚠️ System initialization timeout, proceeding anyway');
    }
  }

  private async handleNewPool(data: any) {
    if (!this.isInitialized) return;

    const poolId = data.pool_id;
    const poolData = data.data;

    try {
      // Wait for the pool to be stored in the database (race condition fix)
      let pool = null;
      let attempts = 0;
      const maxAttempts = 10; // Wait up to 10 seconds
      
      while (attempts < maxAttempts) {
        pool = await this.positionManagerService.getPool(poolId);
        if (pool) {
          break;
        }
        
        // Wait 1 second before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
        
        if (attempts % 3 === 0) {
          this.logger.log(`⏳ Waiting for pool ${poolId} to be stored in database... (attempt ${attempts}/${maxAttempts})`);
        }
      }
      
      if (!pool) {
        this.logger.warn(`Pool ${poolId} not found in database after ${maxAttempts} attempts`);
        return;
      }

      // Check if pool is within the 15-minute monitoring window
      const poolAge = Date.now() - pool.detected_at;
      const fifteenMinutes = 15 * 60 * 1000; // 15 minutes in milliseconds
      
      if (poolAge > fifteenMinutes) {
        this.logger.warn(`Pool ${poolId} is older than 15 minutes (age: ${Math.round(poolAge / 1000 / 60)}m), skipping monitoring`);
        return;
      }

      // Start monitoring this pool
      this.logger.log(`🆕 New pool detected: ${poolId} (age: ${Math.round(poolAge / 1000 / 60)}m)`);
      await this.startMonitoring(pool);
      
    } catch (error) {
      this.logger.error(`Error handling new pool ${poolId}:`, error);
    }
  }

  private async loadExistingPools() {
    try {
      const pendingPools = await this.positionManagerService.getPendingPools();
      
      let monitoredCount = 0;
      let cleanedCount = 0;
      const now = Date.now();
      
      for (const pool of pendingPools) {
        const poolAge = now - pool.detected_at;
        const thirtyMinutes = 30 * 60 * 1000; // 30 minutes in milliseconds
        const fifteenMinutes = 15 * 60 * 1000; // 15 minutes in milliseconds
        
        if (poolAge > thirtyMinutes) {
          // Pool is older than 30 minutes - clean it up
          this.logger.log(`🧹 Cleaning up old pool ${pool.pool_id} (age: ${Math.round(poolAge / 1000 / 60)}m)`);
          await this.positionManagerService.updatePoolAnalysis(pool.pool_id, { analysis_status: 'ignored' });
          cleanedCount++;
        } else if (poolAge < fifteenMinutes) {
          // Pool is less than 15 minutes old - start monitoring
          this.logger.log(`🏊‍♂️ Starting monitoring for recent pool ${pool.pool_id} (age: ${Math.round(poolAge / 1000 / 60)}m)`);
          await this.startMonitoring(pool);
          monitoredCount++;
        } else {
          // Pool is between 15-30 minutes old - skip monitoring but keep in database
          this.logger.log(`⏰ Skipping pool ${pool.pool_id} (age: ${Math.round(poolAge / 1000 / 60)}m) - monitoring window expired`);
        }
      }
      
      this.logger.log(`📊 Pool cleanup complete: ${monitoredCount} pools started monitoring, ${cleanedCount} old pools cleaned up (out of ${pendingPools.length} total)`);
    } catch (error) {
      this.logger.error('Error loading existing pools:', error);
    }
  }

  private async startMonitoring(pool: Status6Pool) {
    if (this.monitoredPools.has(pool.pool_id)) {
      this.logger.warn(`Pool ${pool.pool_id} is already being monitored`);
      return;
    }

    try {
      // Get initial baseline metrics with rate limiting
      const baselineMetrics = await this.fetchPoolMetricsWithRateLimit(pool.base_vault, pool.quote_vault);
      
      if (!baselineMetrics) {
        this.logger.warn(`Could not fetch baseline metrics for pool ${pool.pool_id}`);
        return;
      }

      // Determine priority and update interval based on TVL
      const priority = this.determinePriority(baselineMetrics.tvl);
      const updateInterval = this.calculateUpdateInterval(priority, baselineMetrics.tvl);

      // Calculate remaining monitoring time (15 minutes from detection)
      const poolAge = Date.now() - pool.detected_at;
      const fifteenMinutes = 15 * 60 * 1000; // 15 minutes in milliseconds
      const remainingTime = Math.max(0, fifteenMinutes - poolAge);

      if (remainingTime <= 0) {
        this.logger.warn(`Pool ${pool.pool_id} monitoring window has expired, skipping`);
        return;
      }

      const monitor: PoolMonitor = {
        poolId: pool.pool_id,
        baseVault: pool.base_vault,
        quoteVault: pool.quote_vault,
        baselineRatio: baselineMetrics.reserveRatio,
        baselineTVL: baselineMetrics.tvl,
        baselinePrice: baselineMetrics.quoteReserve / baselineMetrics.baseReserve,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        priority,
        updateInterval,
        consecutiveErrors: 0,
        timeoutId: setTimeout(() => this.stopMonitoring(pool.pool_id), remainingTime),
        lastPrice: baselineMetrics.quoteReserve / baselineMetrics.baseReserve,
        lastTVL: baselineMetrics.tvl
      };

      this.monitoredPools.set(pool.pool_id, monitor);

      // Log baseline with priority info and remaining time
      this.logger.log(`🏊‍♂️ Started monitoring pool ${pool.pool_id} | Priority: ${priority} | Interval: ${updateInterval}ms | Remaining: ${Math.round(remainingTime / 1000 / 60)}m | Baseline: ${baselineMetrics.reserveRatio.toFixed(6)} ratio, ${(baselineMetrics.quoteReserve / baselineMetrics.baseReserve).toFixed(8)} SOL price, ${baselineMetrics.tvl.toFixed(2)} TVL`);

      // Add to batch update system
      this.scheduleBatchUpdate(pool.pool_id, updateInterval);

    } catch (error) {
      this.logger.error(`Error starting monitoring for pool ${pool.pool_id}:`, error);
    }
  }

  private determinePriority(tvl: number): 'high' | 'medium' | 'low' {
    if (tvl > 10000) return 'high'; // High TVL pools get priority
    if (tvl > 1000) return 'medium';
    return 'low';
  }

  private calculateUpdateInterval(priority: 'high' | 'medium' | 'low', tvl: number): number {
    const baseInterval = this.DEFAULT_UPDATE_INTERVAL;
    
    switch (priority) {
      case 'high':
        return Math.max(1000, baseInterval * 0.5); // 1-2 seconds for high priority
      case 'medium':
        return baseInterval; // 2 seconds for medium priority
      case 'low':
        return baseInterval * 2; // 4 seconds for low priority
      default:
        return baseInterval;
    }
  }

  private scheduleBatchUpdate(poolId: string, interval: number) {
    // Add to pending updates
    this.pendingUpdates.add(poolId);
    
    // Schedule batch processing if not already scheduled
    if (!this.batchUpdateTimer) {
      this.batchUpdateTimer = setTimeout(() => {
        this.processBatchUpdates();
      }, 100); // Process batches every 100ms
    }
  }

  private async processBatchUpdates() {
    this.batchUpdateTimer = null;
    
    if (this.pendingUpdates.size === 0) return;

    // Get pools to update in this batch
    const poolsToUpdate = Array.from(this.pendingUpdates).slice(0, this.rateLimitConfig.batchSize);
    
    // Remove from pending
    poolsToUpdate.forEach(poolId => this.pendingUpdates.delete(poolId));

    // Process batch with rate limiting
    await this.processBatchWithRateLimit(poolsToUpdate);

    // Schedule next batch if there are more pending updates
    if (this.pendingUpdates.size > 0) {
      this.batchUpdateTimer = setTimeout(() => {
        this.processBatchUpdates();
      }, 100);
    }
  }

  private async processBatchWithRateLimit(poolIds: string[]) {
    for (const poolId of poolIds) {
      const monitor = this.monitoredPools.get(poolId);
      if (!monitor) continue;

      // Check if it's time to update this pool
      const timeSinceLastUpdate = Date.now() - monitor.lastUpdate;
      if (timeSinceLastUpdate < monitor.updateInterval) {
        // Reschedule for later
        this.pendingUpdates.add(poolId);
        continue;
      }

      // Add to rate-limited queue
      this.requestQueue.push(async () => {
        await this.updatePoolMetrics(poolId);
      });

      // Process queue with rate limiting
      await this.processRequestQueue();
    }
  }

  private async processRequestQueue() {
    // Reset request count every second
    const now = Date.now();
    if (now - this.lastResetTime >= 1000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }

    // Check rate limits
    if (this.requestCount >= this.rateLimitConfig.maxRequestsPerSecond) {
      const waitTime = 1000 - (now - this.lastResetTime);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      this.requestCount = 0;
      this.lastResetTime = Date.now();
    }

    // Process requests up to concurrent limit
    while (this.requestQueue.length > 0 && this.activeRequests < this.rateLimitConfig.maxConcurrentRequests) {
      const request = this.requestQueue.shift();
      if (request) {
        this.activeRequests++;
        this.requestCount++;
        
        request().finally(() => {
          this.activeRequests--;
        });
      }
    }
  }

  private async updatePoolMetrics(poolId: string) {
    const monitor = this.monitoredPools.get(poolId);
    if (!monitor) return;

    try {
      const currentMetrics = await this.fetchPoolMetricsWithRateLimit(monitor.baseVault, monitor.quoteVault);
      
      if (currentMetrics) {
        // Calculate base token price in SOL (quoteReserve / baseReserve)
        const currentPrice = currentMetrics.quoteReserve / currentMetrics.baseReserve;
        
        // Calculate price change percentage using stored baseline price
        const priceChangePercent = ((currentPrice - monitor.baselinePrice) / monitor.baselinePrice) * 100;
        
        // TVL is in SOL (quoteReserve)
        const tvlSOL = currentMetrics.quoteReserve;
        const baselineTVLSOL = monitor.baselineTVL; // This is already in SOL
        
        // TVL change percentage
        const tvlChangePercent = ((tvlSOL - baselineTVLSOL) / baselineTVLSOL) * 100;

        // Check if there's a significant change since last update (0.1% threshold)
        const priceChangeSinceLast = Math.abs((currentPrice - monitor.lastPrice) / monitor.lastPrice) * 100;
        const tvlChangeSinceLast = Math.abs((tvlSOL - monitor.lastTVL) / monitor.lastTVL) * 100;
        const hasSignificantChange = priceChangeSinceLast > 0.1 || tvlChangeSinceLast > 0.1;

        // Update last update time
        monitor.lastUpdate = Date.now();
        monitor.consecutiveErrors = 0; // Reset error count on success

        // Only log if there's a significant change or if it's the first update
        if (hasSignificantChange || monitor.lastPrice === monitor.baselinePrice) {
          // Log concise one-line update with priority indicator
          const priceColor = priceChangePercent >= 0 ? '🟢' : '🔴';
          const tvlColor = tvlChangePercent >= -5 ? '🟢' : '🔴';
          const priorityIcon = monitor.priority === 'high' ? '🔥' : monitor.priority === 'medium' ? '⚡' : '💤';
          
          // New format: Price in SOL with percentage change, TVL in SOL
          console.log(`${priorityIcon} ${priceColor} ${poolId.slice(0, 8)} | Price: ${currentPrice.toFixed(8)} SOL (${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%) | ${tvlColor} TVL: ${tvlSOL.toFixed(2)} SOL | Ratio: ${currentMetrics.reserveRatio.toFixed(6)}`);
        }

        // Update last values for next comparison
        monitor.lastPrice = currentPrice;
        monitor.lastTVL = tvlSOL;

        // Store snapshot in database
        await this.storeSnapshot(poolId, {
          baseReserve: currentMetrics.baseReserve,
          quoteReserve: currentMetrics.quoteReserve,
          reserveRatio: currentMetrics.reserveRatio,
          tvl: currentMetrics.tvl,
          profitLossPercent: priceChangePercent, // Store price change as profit/loss
          tvlChangePercent,
          timestamp: Date.now()
        });

        // Check for extreme conditions
        if (tvlChangePercent < -20) {
          this.logger.warn(`🚨 RUG DETECTED! Pool ${poolId} TVL dropped ${tvlChangePercent.toFixed(2)}%`);
        }

        // Adjust update interval based on activity
        this.adjustUpdateInterval(monitor, priceChangePercent, tvlChangePercent);

        // Reschedule next update
        this.scheduleBatchUpdate(poolId, monitor.updateInterval);

      } else {
        // Handle failed fetch
        monitor.consecutiveErrors++;
        this.handleFetchError(monitor);
      }

    } catch (error) {
      monitor.consecutiveErrors++;
      this.handleFetchError(monitor);
      this.logger.error(`Error updating metrics for pool ${poolId}:`, error);
    }
  }

  private adjustUpdateInterval(monitor: PoolMonitor, profitLossPercent: number, tvlChangePercent: number) {
    const baseInterval = this.calculateUpdateInterval(monitor.priority, monitor.baselineTVL);
    
    // Increase frequency for high activity
    if (Math.abs(profitLossPercent) > 5 || Math.abs(tvlChangePercent) > 10) {
      monitor.updateInterval = Math.max(500, baseInterval * 0.5); // More frequent updates
    } else if (Math.abs(profitLossPercent) < 1 && Math.abs(tvlChangePercent) < 2) {
      // Decrease frequency for low activity
      monitor.updateInterval = Math.min(10000, baseInterval * 2); // Less frequent updates
    } else {
      monitor.updateInterval = baseInterval; // Reset to base interval
    }
  }

  private handleFetchError(monitor: PoolMonitor) {
    // Implement exponential backoff
    const backoffMs = Math.min(
      this.rateLimitConfig.maxBackoffMs,
      Math.pow(this.rateLimitConfig.backoffMultiplier, monitor.consecutiveErrors) * 1000
    );
    
    monitor.updateInterval = Math.max(monitor.updateInterval, backoffMs);
    
    if (monitor.consecutiveErrors > 5) {
      this.logger.warn(`⚠️ Pool ${monitor.poolId} has ${monitor.consecutiveErrors} consecutive errors, increasing backoff to ${backoffMs}ms`);
    }
  }

  private async fetchPoolMetricsWithRateLimit(baseVault: string, quoteVault: string): Promise<{ baseReserve: number; quoteReserve: number; reserveRatio: number; tvl: number } | null> {
    // Add to rate-limited queue
    return new Promise((resolve) => {
      this.requestQueue.push(async () => {
        const result = await this.fetchPoolMetrics(baseVault, quoteVault);
        resolve(result);
      });
      
      this.processRequestQueue();
    });
  }

  private async fetchPoolMetrics(baseVault: string, quoteVault: string): Promise<{ baseReserve: number; quoteReserve: number; reserveRatio: number; tvl: number } | null> {
    try {
      // Fetch account data for both vaults
      const [baseAccount, quoteAccount] = await Promise.all([
        this.connection.getAccountInfo(new PublicKey(baseVault)),
        this.connection.getAccountInfo(new PublicKey(quoteVault))
      ]);

      if (!baseAccount || !quoteAccount) {
        return null;
      }

      // Parse token account data to get balances
      const baseBalance = this.parseTokenAccountBalance(baseAccount.data);
      const quoteBalance = this.parseTokenAccountBalance(quoteAccount.data);

      if (baseBalance === null || quoteBalance === null) {
        return null;
      }

      const reserveRatio = baseBalance / quoteBalance;
      const tvl = quoteBalance * 2; // Simple TVL estimation

      return {
        baseReserve: baseBalance,
        quoteReserve: quoteBalance,
        reserveRatio,
        tvl
      };

    } catch (error) {
      this.logger.error('Error fetching pool metrics:', error);
      return null;
    }
  }

  private parseTokenAccountBalance(data: Buffer): number | null {
    try {
      // Parse SPL Token Account data structure
      // Token account layout: mint (32) + owner (32) + amount (8) + delegate (36) + state (1) + is_native (37) + delegated_amount (8) + close_authority (36)
      const amountBuffer = data.slice(64, 72); // amount field starts at offset 64
      const amount = amountBuffer.readBigUInt64LE();
      
      // Convert to number (assuming 9 decimals for most tokens)
      return Number(amount) / Math.pow(10, 9);
    } catch (error) {
      return null;
    }
  }

  private async storeSnapshot(poolId: string, metrics: PoolMetrics) {
    try {
      const snapshot: PoolSnapshot = {
        pool_id: poolId,
        timestamp: metrics.timestamp,
        price: metrics.reserveRatio,
        base_reserve: metrics.baseReserve,
        quote_reserve: metrics.quoteReserve,
        volume_24h: metrics.tvl // Using TVL as volume for now
      };

      await this.positionManagerService.insertPoolSnapshot(snapshot);
    } catch (error) {
      this.logger.error(`Error storing snapshot for pool ${poolId}:`, error);
    }
  }

  private stopMonitoring(poolId: string) {
    const monitor = this.monitoredPools.get(poolId);
    if (!monitor) return;

    // Clear timeout
    clearTimeout(monitor.timeoutId);
    
    // Remove from monitoring
    this.monitoredPools.delete(poolId);

    // Update pool status to 'analyzed' (not 'ignored') to keep it for analysis
    this.positionManagerService.updatePoolAnalysis(poolId, { analysis_status: 'analyzed' }).catch(error => {
      this.logger.error(`Error updating pool status for ${poolId}:`, error);
    });

    this.logger.log(`⏰ Stopped monitoring pool ${poolId} (15min monitoring window completed)`);
  }

  // Public methods for external access
  getMonitoredPoolsCount(): number {
    return this.monitoredPools.size;
  }

  getMonitoredPools(): string[] {
    return Array.from(this.monitoredPools.keys());
  }

  async forceStopMonitoring(poolId: string) {
    this.stopMonitoring(poolId);
  }

  // New monitoring statistics and health methods
  getMonitoringStats() {
    const pools = Array.from(this.monitoredPools.values());
    const highPriority = pools.filter(p => p.priority === 'high').length;
    const mediumPriority = pools.filter(p => p.priority === 'medium').length;
    const lowPriority = pools.filter(p => p.priority === 'low').length;

    return {
      totalPools: this.monitoredPools.size,
      priorityBreakdown: {
        high: highPriority,
        medium: mediumPriority,
        low: lowPriority
      },
      queueStats: {
        pendingUpdates: this.pendingUpdates.size,
        requestQueueLength: this.requestQueue.length,
        activeRequests: this.activeRequests
      },
      rateLimitStats: {
        requestsPerSecond: this.requestCount,
        maxRequestsPerSecond: this.rateLimitConfig.maxRequestsPerSecond,
        maxConcurrentRequests: this.rateLimitConfig.maxConcurrentRequests
      },
      averageUpdateIntervals: {
        high: pools.filter(p => p.priority === 'high').reduce((sum, p) => sum + p.updateInterval, 0) / Math.max(highPriority, 1),
        medium: pools.filter(p => p.priority === 'medium').reduce((sum, p) => sum + p.updateInterval, 0) / Math.max(mediumPriority, 1),
        low: pools.filter(p => p.priority === 'low').reduce((sum, p) => sum + p.updateInterval, 0) / Math.max(lowPriority, 1)
      },
      monitoringWindows: [] // Will be populated in getHealthStatus
    };
  }

  getPoolDetails(poolId: string) {
    const monitor = this.monitoredPools.get(poolId);
    if (!monitor) return null;

    return {
      poolId: monitor.poolId,
      priority: monitor.priority,
      updateInterval: monitor.updateInterval,
      consecutiveErrors: monitor.consecutiveErrors,
      timeSinceLastUpdate: Date.now() - monitor.lastUpdate,
      monitoringDuration: Date.now() - monitor.startTime,
      baselineRatio: monitor.baselineRatio,
      baselineTVL: monitor.baselineTVL
    };
  }

  // Health check method
  async getHealthStatus(): Promise<{ status: string; stats: any; issues: string[] }> {
    const issues: string[] = [];
    const stats = this.getMonitoringStats();

    // Check for rate limiting issues
    if (stats.queueStats.requestQueueLength > 50) {
      issues.push(`High request queue: ${stats.queueStats.requestQueueLength} requests pending`);
    }

    if (stats.queueStats.activeRequests >= this.rateLimitConfig.maxConcurrentRequests) {
      issues.push(`At concurrent request limit: ${stats.queueStats.activeRequests}/${this.rateLimitConfig.maxConcurrentRequests}`);
    }

    // Check for pools with many consecutive errors
    const errorPools = Array.from(this.monitoredPools.values()).filter(p => p.consecutiveErrors > 3);
    if (errorPools.length > 0) {
      issues.push(`${errorPools.length} pools with >3 consecutive errors`);
    }

    // Check for stale pools (no updates in last 30 seconds)
    const stalePools = Array.from(this.monitoredPools.values()).filter(p => Date.now() - p.lastUpdate > 30000);
    if (stalePools.length > 0) {
      issues.push(`${stalePools.length} pools haven't updated in >30s`);
    }

    // Add monitoring window information
    const now = Date.now();
    const poolsWithRemainingTime = Array.from(this.monitoredPools.values()).map(monitor => {
      const poolAge = now - monitor.startTime;
      const remainingTime = Math.max(0, this.MONITORING_DURATION - poolAge);
      return {
        poolId: monitor.poolId,
        remainingMinutes: Math.round(remainingTime / 1000 / 60),
        priority: monitor.priority
      };
    });

    stats.monitoringWindows = poolsWithRemainingTime;

    const status = issues.length === 0 ? 'healthy' : 'warning';
    
    return { status, stats, issues };
  }

  // Manual cleanup method
  async cleanupOldPools(): Promise<{ cleaned: number; total: number }> {
    this.logger.log('🧹 Starting manual cleanup of old pools...');
    
    try {
      const pendingPools = await this.positionManagerService.getPendingPools();
      let cleanedCount = 0;
      const now = Date.now();
      const thirtyMinutes = 30 * 60 * 1000; // 30 minutes in milliseconds
      
      for (const pool of pendingPools) {
        const poolAge = now - pool.detected_at;
        
        if (poolAge > thirtyMinutes) {
          this.logger.log(`🧹 Cleaning up old pool ${pool.pool_id} (age: ${Math.round(poolAge / 1000 / 60)}m)`);
          await this.positionManagerService.updatePoolAnalysis(pool.pool_id, { analysis_status: 'ignored' });
          cleanedCount++;
        }
      }
      
      this.logger.log(`✅ Manual cleanup complete: ${cleanedCount} pools cleaned up`);
      return { cleaned: cleanedCount, total: pendingPools.length };
    } catch (error) {
      this.logger.error('Error during manual cleanup:', error);
      return { cleaned: 0, total: 0 };
    }
  }

  // Optimization methods
  optimizeMonitoring() {
    this.logger.log('🔧 Running monitoring optimization...');
    
    const pools = Array.from(this.monitoredPools.values());
    let optimizations = 0;

    // Adjust priorities based on current TVL (if we have recent data)
    pools.forEach(monitor => {
      // This would require fetching current TVL, but for now we'll use baseline
      const newPriority = this.determinePriority(monitor.baselineTVL);
      if (newPriority !== monitor.priority) {
        monitor.priority = newPriority;
        monitor.updateInterval = this.calculateUpdateInterval(newPriority, monitor.baselineTVL);
        optimizations++;
      }
    });

    // Clean up pools with too many errors
    const errorThreshold = 10;
    const poolsToRemove = pools.filter(p => p.consecutiveErrors > errorThreshold);
    poolsToRemove.forEach(pool => {
      this.logger.warn(`🔄 Removing pool ${pool.poolId} due to ${pool.consecutiveErrors} consecutive errors`);
      this.stopMonitoring(pool.poolId);
      optimizations++;
    });

    this.logger.log(`✅ Optimization complete: ${optimizations} changes made`);
    return optimizations;
  }

  // Emergency stop for all monitoring
  emergencyStop() {
    this.logger.warn('🚨 EMERGENCY STOP: Stopping all pool monitoring');
    
    // Clear all timers
    if (this.batchUpdateTimer) {
      clearTimeout(this.batchUpdateTimer);
      this.batchUpdateTimer = null;
    }

    // Stop all pool monitoring
    const poolIds = Array.from(this.monitoredPools.keys());
    poolIds.forEach(poolId => this.stopMonitoring(poolId));

    // Clear queues
    this.requestQueue = [];
    this.pendingUpdates.clear();
    this.activeRequests = 0;

    this.logger.log(`✅ Emergency stop complete: ${poolIds.length} pools stopped`);
  }

  // Resume monitoring after emergency stop
  async resumeMonitoring() {
    this.logger.log('🔄 Resuming pool monitoring...');
    
    try {
      // Reload existing pools from database
      await this.loadExistingPools();
      this.logger.log('✅ Monitoring resumed successfully');
    } catch (error) {
      this.logger.error('❌ Failed to resume monitoring:', error);
    }
  }
} 