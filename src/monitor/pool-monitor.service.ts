import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { PendingPoolManager, PendingPool } from './pending-pool-manager.js';
import { SocketService } from '../gateway/socket.service.js';
import { PoolMonitorManager } from './pool-monitor-manager.js';
import { MINT_TO_TOKEN, TokenInfo, conciseOnUpdate, MarketPressure, TrendDirection, PoolSnapshot } from './types.js';
import { getCurrentTimestamp } from './db-schema.js';
import { DatabaseManager } from './db-manager.js';
import { decodeRaydiumPoolState } from './raydium-layout.js';

@Injectable()
export class PoolMonitorService implements OnModuleInit {
  private readonly logger = new Logger(PoolMonitorService.name);
  private readonly pendingPoolManager: PendingPoolManager;
  private readonly poolMonitorManager: PoolMonitorManager;
  private readonly db: DatabaseManager;
  private isInitialized = false;

  constructor(
    private readonly connection: Connection,
    private readonly socketService: SocketService
  ) {
    this.logger.debug('Initializing PoolMonitorService...');
    this.db = new DatabaseManager();
    this.pendingPoolManager = new PendingPoolManager(connection);
    this.poolMonitorManager = new PoolMonitorManager(connection);
    
    // Set up callbacks
    this.pendingPoolManager.setCallbacks(
      this.handlePoolExists.bind(this),
      this.handlePoolReady.bind(this)
    );
    
    this.logger.debug('PoolMonitorService constructed');
  }

  async onModuleInit() {
    await this.db.init();
    await this.pendingPoolManager.init();
    await this.poolMonitorManager.onModuleInit();
    
    // Wait for SocketService to be ready (up to 10 seconds)
    let attempts = 0;
    while (!this.socketService.isReady() && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
      this.logger.debug(`Waiting for Socket.IO server... ${attempts}/10`);
    }

    if (!this.socketService.isReady()) {
      this.logger.error('Socket.IO server failed to initialize within 10 seconds');
      return;
    }

    this.isInitialized = true;
    this.logger.log('PoolMonitorService ready');
    this.logger.debug(`Socket service status: ${this.socketService.isReady()}`);
  }

  private async startRealTimeMonitoring(pool: PendingPool) {
    const tokenAInfo = MINT_TO_TOKEN[pool.base_mint] || { symbol: pool.base_mint, decimals: pool.base_decimals, mint: pool.base_mint };
    const tokenBInfo = MINT_TO_TOKEN[pool.quote_mint] || { symbol: pool.quote_mint, decimals: pool.quote_decimals, mint: pool.quote_mint };
    
    await this.poolMonitorManager.addPool(
      pool.pool_id,
      pool.base_mint,
      pool.quote_mint,
      pool.base_decimals,
      pool.quote_decimals,
      (snapshot: PoolSnapshot) => {
        // Broadcast update via socket
        this.socketService.broadcastPoolUpdate(pool.pool_id, {
          price: snapshot.price,
          baseReserve: snapshot.base_reserve,
          quoteReserve: snapshot.quote_reserve,
          tvl: snapshot.tvl || 0,
          volume24h: snapshot.volume_24h || 0,
          priceChange: snapshot.price_change || 0,
          timestamp: snapshot.timestamp
        });

        // Log update using conciseOnUpdate
        conciseOnUpdate(
          snapshot,
          snapshot.pressure || { 
            direction: TrendDirection.SIDEWAYS,
            strength: 0,
            value: 0,
            buyPressure: 0,
            sellPressure: 0,
            rugRisk: 0,
            trend: TrendDirection.SIDEWAYS,
            severity: 'low'
          },
          tokenAInfo,
          tokenBInfo,
          snapshot.originPrice || null,
          snapshot.originBaseReserve || null,
          snapshot.originQuoteReserve || null,
          snapshot.previousSnapshot || null,
          pool.pool_id
        );
      }
    );
  }

  private async handlePoolExists(pool: PendingPool) {
    this.logger.log(`Pool ${pool.pool_id} exists, starting real-time monitoring`);
    await this.startRealTimeMonitoring(pool);
    this.socketService.broadcastPoolExists(pool.pool_id, pool.base_mint, pool.quote_mint);
  }

  private async handlePoolReady(pool: PendingPool) {
    this.logger.log(`Pool ${pool.pool_id} is ready, starting real-time monitoring`);
    await this.startRealTimeMonitoring(pool);
    this.socketService.broadcastNewPool(
      pool.pool_id,
      pool.base_mint,
      pool.quote_mint,
      pool.base_decimals,
      pool.quote_decimals,
      pool.initial_price || undefined
    );
  }

  private async getPoolState(poolId: string): Promise<PoolSnapshot | null> {
    // Get latest snapshot from database
    const snapshots = await this.db.getPoolSnapshots(poolId, undefined, undefined, 1);
    if (snapshots.length === 0) {
      return null;
    }

    return snapshots[0];
  }

  private async getPoolInfo(poolId: string): Promise<PendingPool | null> {
    const pool = await this.db.getPendingPool('ready');
    if (!pool || pool.pool_id !== poolId) {
      return null;
    }
    return pool;
  }

  public async addPool(poolId: string, tokenA: string, tokenB: string): Promise<void> {
    this.logger.log(`Adding pool ${poolId} to pending pool manager for readiness check`);
    
    try {
      // Get pool account info
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(poolId));
      if (!accountInfo || !accountInfo.data) {
        throw new Error(`Pool account not found: ${poolId}`);
      }

      // Decode pool state to get token decimals
      const poolState = decodeRaydiumPoolState(accountInfo.data);
      
      // Get token info from MINT_TO_TOKEN or create new entries
      const baseToken = MINT_TO_TOKEN[tokenA] || { 
        symbol: tokenA, 
        decimals: poolState.baseDecimal, 
        mint: tokenA 
      };
      const quoteToken = MINT_TO_TOKEN[tokenB] || { 
        symbol: tokenB, 
        decimals: poolState.quoteDecimal, 
        mint: tokenB 
      };

      // Update MINT_TO_TOKEN mapping for future use
      if (!MINT_TO_TOKEN[tokenA]) {
        MINT_TO_TOKEN[tokenA] = baseToken;
        this.logger.log(`Added new token to mapping: ${tokenA} (${baseToken.decimals} decimals)`);
      }
      if (!MINT_TO_TOKEN[tokenB]) {
        MINT_TO_TOKEN[tokenB] = quoteToken;
        this.logger.log(`Added new token to mapping: ${tokenB} (${quoteToken.decimals} decimals)`);
      }
      
      // Add pool to pending pool manager which will handle readiness checks
      await this.pendingPoolManager.addPool(
        poolId,
        tokenA,
        tokenB,
        baseToken.decimals,
        quoteToken.decimals
      );

      // The pool will be automatically monitored once it becomes ready
      // through the handlePoolReady callback we set up in the constructor
    } catch (error) {
      this.logger.error(`Error adding pool ${poolId}:`, error);
      throw error;
    }
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