import { Injectable, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { SocketService } from '../gateway/socket.service';
import { PendingPoolManager, PendingPool } from './pending-pool-manager';
import { PoolMonitorManager } from './pool-monitor-manager';
import { MINT_TO_TOKEN, TokenInfo, TokenMap, PoolReadyMessage, isTokenInfo } from './types';

@Injectable()
export class PoolMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolMonitorService.name);
  private pendingPoolManager: PendingPoolManager;
  private poolMonitorManager: PoolMonitorManager;
  private isInitialized = false;

  constructor(
    private readonly connection: Connection,
    private readonly socketService: SocketService
  ) {
    if (!process.env.HTTP_URL || !process.env.WSS_URL) {
      throw new Error('Required environment variables HTTP_URL and WSS_URL are not set');
    }

    this.logger.log('Initializing PoolMonitorService...');
    
    try {
      this.poolMonitorManager = new PoolMonitorManager(
        this.connection,
        this.socketService,
        null, // We'll set this after creating PendingPoolManager
        process.env.HTTP_URL,
        process.env.WSS_URL
      );

      this.pendingPoolManager = new PendingPoolManager(
        this.connection,
        this.handlePoolReady.bind(this),
        this.poolMonitorManager,
        this.socketService
      );

      this.logger.log('✅ PoolMonitorService constructed with SocketService and PendingPoolManager');
    } catch (error) {
      this.logger.error('Failed to initialize PoolMonitorService:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleInit() {
    try {
      // Wait for SocketService to be ready (up to 10 seconds)
      let attempts = 0;
      while (!this.socketService.isReady() && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
        this.logger.log(`Waiting for Socket.IO server... attempt ${attempts}/10`);
      }

      if (!this.socketService.isReady()) {
        throw new Error('Socket.IO server failed to initialize within 10 seconds');
      }

      // Initialize PoolMonitorManager first
      await this.poolMonitorManager.onModuleInit();
      
      // Set the pending pool manager in PoolMonitorManager
      this.poolMonitorManager.setPendingPoolManager(this.pendingPoolManager);
      
      // Initialize PendingPoolManager after PoolMonitorManager is ready
      await this.pendingPoolManager.onModuleInit();
      
      // Start the PendingPoolManager monitoring system
      this.pendingPoolManager.start();

      this.isInitialized = true;
      this.logger.log('PoolMonitorService initialized and ready to monitor new pools');
      this.logger.log(`Socket service initialized: ${this.socketService.isReady()}`);
    } catch (error) {
      this.logger.error('Failed to initialize PoolMonitorService:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down PoolMonitorService...');
    try {
      // Stop and cleanup PendingPoolManager
      if (this.pendingPoolManager) {
        this.pendingPoolManager.stop();
        await this.pendingPoolManager.onModuleDestroy();
      }
      
      // Cleanup will be handled by the managers' onModuleDestroy
      this.isInitialized = false;
    } catch (error) {
      this.logger.error('Error during PoolMonitorService shutdown:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private startRealTimeMonitoring(pool: PendingPool) {
    try {
      const tokenAInfo = this.getTokenInfo(pool.token_a.mint.toString());
      const tokenBInfo = this.getTokenInfo(pool.token_b.mint.toString());
      
      this.poolMonitorManager.addPool({
        pool_id: pool.pool_id,
        token_a: tokenAInfo,
        token_b: tokenBInfo
      });
    } catch (error) {
      this.logger.error(`Failed to start monitoring pool ${pool.pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private getTokenInfo(mint: string): TokenInfo {
    const tokenInfo = MINT_TO_TOKEN[mint];
    if (!tokenInfo) {
      throw new Error(`Token info not found for mint: ${mint}`);
    }
    return tokenInfo;
  }

  public handlePoolReady(pool: PendingPool): void {
    try {
      if (!this.isInitialized) {
        throw new Error('PoolMonitorService not initialized');
      }

      this.logger.log(`Pool ${pool.pool_id} is ready for trading`);
      
      const message: PoolReadyMessage = {
        event: 'pool_ready',
        pool_id: pool.pool_id,
        timestamp: Date.now(),
        data: {
          base_token: pool.token_a.symbol,
          quote_token: pool.token_b.symbol,
          trade_count: pool.trade_count,
          reserve_change_percent: pool.reserve_changes
        }
      };

      this.socketService.broadcastPoolReady(message);
      this.startRealTimeMonitoring(pool);
    } catch (error) {
      this.logger.error(`Error handling pool ready for ${pool.pool_id}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  public addPool(poolId: string, tokenA: string, tokenB: string): void {
    try {
      if (!this.isInitialized) {
        throw new Error('PoolMonitorService not initialized');
      }

      if (!poolId || !tokenA || !tokenB) {
        throw new Error('Invalid pool parameters: poolId, tokenA, and tokenB are required');
      }

      const tokenAInfo: TokenInfo = { 
        symbol: tokenA, 
        decimals: 9, 
        mint: tokenA 
      };
      
      const tokenBInfo: TokenInfo = { 
        symbol: tokenB, 
        decimals: 6, 
        mint: tokenB 
      };

      if (!isTokenInfo(tokenAInfo) || !isTokenInfo(tokenBInfo)) {
        throw new Error('Invalid token information');
      }

      this.pendingPoolManager.addPool(poolId, tokenAInfo, tokenBInfo);
    } catch (error) {
      this.logger.error(`Failed to add pool ${poolId}:`, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  public getPendingPools() {
    if (!this.isInitialized) {
      throw new Error('PoolMonitorService not initialized');
    }
    return this.pendingPoolManager.getAllPools();
  }

  public removePool(poolId: string) {
    try {
      if (!this.isInitialized) {
        throw new Error('PoolMonitorService not initialized');
      }

      if (!poolId) {
        throw new Error('Invalid poolId');
      }

      this.logger.log(`\n➖ Removing pool from monitor: ${poolId}`);
      this.pendingPoolManager.removePool(poolId);
    } catch (error) {
      this.logger.error(`Failed to remove pool ${poolId}:`, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  // NEW: Method to handle initialize2 detection (called by NestJS listener)
  public onInitialize2Detected(poolId: string, baseMint: string, quoteMint: string): void {
    try {
      if (!this.isInitialized) {
        throw new Error('PoolMonitorService not initialized');
      }

      this.logger.log(`[PoolMonitorService] 🏌️‍♂️ INITIALIZE2 DETECTED: ${poolId}`);
      this.logger.log(`[PoolMonitorService] Base mint: ${baseMint}`);
      this.logger.log(`[PoolMonitorService] Quote mint: ${quoteMint}`);

      // Create token info objects
      const tokenAInfo: TokenInfo = { 
        symbol: 'TOKEN_A', 
        decimals: 9, 
        mint: baseMint 
      };
      
      const tokenBInfo: TokenInfo = { 
        symbol: 'TOKEN_B', 
        decimals: 6, 
        mint: quoteMint 
      };

      // Add to pending pools (this will track for status 6)
      this.pendingPoolManager.addPool(poolId, tokenAInfo, tokenBInfo);
      
      this.logger.log(`[PoolMonitorService] ✅ Pool ${poolId} added to pending list - waiting for status 6`);

    } catch (error) {
      this.logger.error(`[PoolMonitorService] Error handling initialize2 for ${poolId}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // NEW: Get pending pools with their status
  public getPendingPoolsWithStatus() {
    if (!this.isInitialized) {
      throw new Error('PoolMonitorService not initialized');
    }
    
    const pools = this.pendingPoolManager.getAllPools();
    return pools.map(pool => ({
      pool_id: pool.pool_id,
      base_token: pool.token_a.symbol,
      quote_token: pool.token_b.symbol,
      base_mint: pool.token_a.mint,
      quote_mint: pool.token_b.mint,
      state: pool.state,
      initialize2_detected_at: new Date(pool.initialize2_detected_at).toISOString(),
      time_since_initialize2: Math.floor((Date.now() - pool.initialize2_detected_at) / 1000),
      status_6_detected: pool.status_6_detected_at ? true : false,
      status_6_detected_at: pool.status_6_detected_at ? new Date(pool.status_6_detected_at).toISOString() : null
    }));
  }
} 