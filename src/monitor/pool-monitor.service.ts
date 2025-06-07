import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { PendingPoolManager, PendingPool } from './pending-pool-manager';
import { SocketService } from '../gateway/socket.service';
import { PoolMonitorManager } from './pool-monitor-manager';
import { MINT_TO_TOKEN, TokenInfo, conciseOnUpdate, MarketPressure, TrendDirection } from './types';

@Injectable()
export class PoolMonitorService implements OnModuleInit {
  private readonly logger = new Logger(PoolMonitorService.name);
  private pendingPoolManager: PendingPoolManager;
  private isInitialized = false;

  constructor(
    private readonly connection: Connection,
    private readonly socketService: SocketService,
    private readonly poolMonitorManager: PoolMonitorManager
  ) {
    this.logger.log('Initializing PoolMonitorService...');
    this.pendingPoolManager = new PendingPoolManager(this.connection, this);
    this.logger.log('✅ PoolMonitorService constructed with SocketService and PendingPoolManager');
  }

  async onModuleInit() {
    // Wait for SocketService to be ready (up to 10 seconds)
    let attempts = 0;
    while (!this.socketService.isReady() && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
      this.logger.log(`Waiting for Socket.IO server... attempt ${attempts}/10`);
    }

    if (!this.socketService.isReady()) {
      this.logger.error('Socket.IO server failed to initialize within 10 seconds');
      return;
    }

    this.isInitialized = true;
    this.logger.log('PoolMonitorService initialized and ready to monitor new pools');
    this.logger.log(`Socket service initialized: ${this.socketService.isReady()}`);
  }

  private startRealTimeMonitoring(pool: PendingPool) {
    const tokenAInfo = MINT_TO_TOKEN[pool.tokenA] || { symbol: pool.tokenA, decimals: 9, mint: pool.tokenA };
    const tokenBInfo = MINT_TO_TOKEN[pool.tokenB] || { symbol: pool.tokenB, decimals: 6, mint: pool.tokenB };
    
    this.poolMonitorManager.addPool(
      {
        poolId: pool.poolId,
        baseMint: pool.tokenA,
        quoteMint: pool.tokenB,
        lpMint: '',
        isViable: true
      },
      tokenAInfo,
      tokenBInfo,
      (snapshot) => {
        // Broadcast update via socket
        this.socketService.broadcastPoolUpdate(pool.poolId, {
          price: snapshot.price,
          baseReserve: snapshot.baseReserve,
          quoteReserve: snapshot.quoteReserve,
          tvl: snapshot.tvl,
          volume24h: snapshot.volume24h || 0,
          priceChange: snapshot.priceChange,
          timestamp: snapshot.timestamp
        });

        // Log update using conciseOnUpdate
        conciseOnUpdate(
          snapshot,
          snapshot.pressure || { 
            direction: TrendDirection.Sideways,
            strength: 0,
            value: 0,
            buyPressure: 0,
            sellPressure: 0,
            rugRisk: 0,
            trend: TrendDirection.Sideways,
            severity: 'low'
          },
          tokenAInfo,
          tokenBInfo,
          snapshot.originPrice || null,
          snapshot.originBaseReserve || null,
          snapshot.originQuoteReserve || null,
          snapshot.previousSnapshot || null,
          pool.poolId
        );
      }
    );
  }

  public async handlePoolExists(pool: PendingPool) {
    try {
      this.logger.log(`\n🔍 Pool ${pool.poolId} exists on-chain, starting real-time monitoring`);
      
      // Start real-time monitoring immediately
      this.startRealTimeMonitoring(pool);
      this.logger.log(`✅ Real-time monitoring started for pool ${pool.poolId}`);

      // Broadcast pool exists event (but not ready to trade yet)
      if (this.socketService.isReady()) {
        this.socketService.broadcastPoolExists(
          pool.poolId,
          pool.tokenA,
          pool.tokenB
        );
        this.logger.log(`✅ Pool exists broadcast sent for ${pool.poolId}`);
      }
    } catch (error) {
      this.logger.error(`❌ Error starting monitoring for pool ${pool.poolId}:`, error);
    }
  }

  public async handlePoolReady(pool: PendingPool) {
    try {
      this.logger.log(`\n🚀 Pool ${pool.poolId} is ready to trade!`);
      
      // Get current pool state
      const poolState = await this.getPoolState(pool.poolId);
      if (!poolState) {
        throw new Error('Pool state not available');
      }

      // Get token info
      const tokenAInfo = MINT_TO_TOKEN[pool.tokenA] || { symbol: pool.tokenA, decimals: 9, mint: pool.tokenA };
      const tokenBInfo = MINT_TO_TOKEN[pool.tokenB] || { symbol: pool.tokenB, decimals: 6, mint: pool.tokenB };

      // Broadcast ready to trade signal
      if (this.socketService.isReady()) {
        this.socketService.broadcastNewPool(
          pool.poolId,
          pool.tokenA,
          pool.tokenB,
          tokenAInfo.decimals,
          tokenBInfo.decimals,
          poolState.price
        );
        this.logger.log(`✅ Ready to trade broadcast sent for pool ${pool.poolId}`);

        // Broadcast initial state
        this.socketService.broadcastPoolUpdate(pool.poolId, {
          price: poolState.price,
          baseReserve: poolState.baseReserve,
          quoteReserve: poolState.quoteReserve,
          tvl: poolState.baseReserve * poolState.price + poolState.quoteReserve,
          volume24h: 0,
          priceChange: 0,
          timestamp: Date.now()
        });
        this.logger.log(`✅ Initial state broadcast for pool ${pool.poolId}`);
      } else {
        this.logger.error('❌ Socket service not ready, cannot broadcast ready signal');
      }
    } catch (error) {
      this.logger.error(`❌ Error processing ready state for pool ${pool.poolId}:`, error);
    }
  }

  // New methods for readiness checks
  public async getPoolState(poolId: string): Promise<{
    price: number;
    baseReserve: number;
    quoteReserve: number;
  } | null> {
    try {
      const quoteResult = await this.poolMonitorManager.getInitialQuote(
        poolId,
        MINT_TO_TOKEN[poolId]?.mint || poolId,
        'So11111111111111111111111111111111111111112' // SOL mint
      );
      
      if (quoteResult.price && quoteResult.baseReserve && quoteResult.quoteReserve) {
        return {
          price: quoteResult.price,
          baseReserve: quoteResult.baseReserve,
          quoteReserve: quoteResult.quoteReserve
        };
      }
      return null;
    } catch (error) {
      this.logger.debug(`Error getting pool state for ${poolId}:`, error);
      return null;
    }
  }

  public async isPoolIndexed(poolId: string): Promise<boolean> {
    try {
      // Try to get pool info from Raydium API
      const poolInfo = await this.poolMonitorManager.getPoolInfo(poolId);
      return !!poolInfo;
    } catch (error) {
      this.logger.debug(`Error checking if pool ${poolId} is indexed:`, error);
      return false;
    }
  }

  public async getPoolInfo(poolId: string): Promise<any | null> {
    try {
      // Get detailed pool info from Raydium API
      const poolInfo = await this.poolMonitorManager.getPoolInfo(poolId);
      if (!poolInfo) {
        this.logger.debug(`Pool ${poolId} not found in Raydium API`);
        return null;
      }
      return poolInfo;
    } catch (error) {
      this.logger.debug(`Error getting pool info for ${poolId}:`, error);
      return null;
    }
  }

  // Method to add new pools for monitoring
  addNewPool(poolId: string, tokenA: string, tokenB: string) {
    this.logger.log(`\n➕ Adding new pool to monitor: ${poolId}`);
    this.logger.log(`Token A: ${tokenA}`);
    this.logger.log(`Token B: ${tokenB}`);
    this.logger.log(`PendingPoolManager state: ${this.pendingPoolManager ? 'initialized' : 'not initialized'}`);
    
    this.pendingPoolManager.addPool(poolId, tokenA, tokenB);
    this.logger.log(`✅ Pool ${poolId} added to PendingPoolManager for monitoring`);
  }

  // Method to get current pending pools
  getPendingPools() {
    return this.pendingPoolManager.getPendingPools();
  }

  // Method to stop monitoring a specific pool
  removePool(poolId: string) {
    this.logger.log(`\n➖ Removing pool from monitor: ${poolId}`);
    this.pendingPoolManager.removePool(poolId);
  }
} 