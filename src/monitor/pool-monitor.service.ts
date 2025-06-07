import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { PendingPoolManager, PendingPool } from './pending-pool-manager';
import { SocketService } from '../gateway/socket.service';
import { PoolMonitorManager } from './pool-monitor-manager';
import { MINT_TO_TOKEN, TokenInfo, conciseOnUpdate, MarketPressure } from './types';

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
      (snapshot, pressure: MarketPressure, originPrice, originBaseReserve, originQuoteReserve) => {
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

        // Call original update handler
        return conciseOnUpdate(
          snapshot,
          pressure,
          tokenAInfo,
          tokenBInfo,
          originPrice,
          originBaseReserve,
          originQuoteReserve,
          null,
          pool.poolId
        );
      }
    );
  }

  public async handlePoolReady(pool: PendingPool) {
    try {
      this.logger.log(`\n🔍 Processing pool ready event for ${pool.poolId}`);
      this.logger.log(`Token A: ${pool.tokenA}`);
      this.logger.log(`Token B: ${pool.tokenB}`);
      
      // Double-check that the pool is actually indexed
      this.logger.log(`Verifying pool ${pool.poolId} exists on-chain...`);
      const poolAccount = await this.connection.getAccountInfo(new PublicKey(pool.poolId));
      
      if (!poolAccount) {
        this.logger.warn(`❌ Pool ${pool.poolId} was marked as ready but account not found, skipping broadcast`);
        return;
      }

      // Get token info with decimals
      const tokenAInfo = MINT_TO_TOKEN[pool.tokenA] || { symbol: pool.tokenA, decimals: 9, mint: pool.tokenA };
      const tokenBInfo = MINT_TO_TOKEN[pool.tokenB] || { symbol: pool.tokenB, decimals: 6, mint: pool.tokenB };

      // Calculate initial price if possible
      let initialPrice: number | undefined;
      try {
        const quoteResult = await this.poolMonitorManager.getInitialQuote(pool.poolId, pool.tokenA, pool.tokenB);
        if (quoteResult && quoteResult.price) {
          initialPrice = quoteResult.price;
        }
      } catch (error) {
        this.logger.warn(`Could not calculate initial price for pool ${pool.poolId}: ${error}`);
      }

      // Only broadcast if we have confirmed the pool exists
      this.logger.log(`✅ Pool ${pool.poolId} verified as indexed and ready for trading`);
      this.logger.log(`📢 Preparing to broadcast new pool (${pool.poolId})`);
      
      // Check socket service state before broadcasting
      if (!this.socketService.isReady()) {
        this.logger.error('❌ Socket service not initialized, cannot broadcast');
        this.logger.error('Socket service state:', {
          isInitialized: this.socketService.isReady(),
          server: this.socketService['server'] ? 'present' : 'missing'
        });
        return;
      }
      
      this.logger.log(`Socket service ready, broadcasting pool ${pool.poolId}...`);
      this.socketService.broadcastNewPool(
        pool.poolId,
        pool.tokenA,
        pool.tokenB,
        tokenAInfo.decimals,
        tokenBInfo.decimals,
        initialPrice
      );
      this.logger.log(`✅ Broadcast sent for pool ${pool.poolId}`);

      // Start real-time monitoring after successful broadcast
      this.logger.log(`Starting real-time monitoring for pool ${pool.poolId}...`);
      this.startRealTimeMonitoring(pool);
      this.logger.log(`✅ Real-time monitoring started for pool ${pool.poolId}`);
      
    } catch (error) {
      this.logger.error(`❌ Error verifying pool ${pool.poolId}:`, error);
      this.logger.error('Error details:', {
        poolId: pool.poolId,
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
        error: error instanceof Error ? error.message : String(error)
      });
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