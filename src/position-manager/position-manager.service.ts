import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PositionManagerDB, Status6Pool, PoolSnapshot } from './database/position-manager-db';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Re-export the Status6Pool type for other modules to use
export { Status6Pool } from './database/position-manager-db';

@Injectable()
export class PositionManagerService implements OnModuleInit, OnModuleDestroy {
  private db: PositionManagerDB;
  private isInitialized = false;

  constructor(private eventEmitter: EventEmitter2) {
    this.db = new PositionManagerDB();
  }

  async onModuleInit() {
    try {
      await this.db.initialize();
      this.isInitialized = true;
      console.log('✅ Position Manager Service initialized');
      
      // Listen for pool_status_6 events
      this.eventEmitter.on('pool_status_6', this.handlePoolStatus6.bind(this));
      
    } catch (error) {
      console.error('❌ Failed to initialize Position Manager Service:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.isInitialized) {
      await this.db.close();
      console.log('✅ Position Manager Service shut down');
    }
  }

  private async handlePoolStatus6(data: any) {
    if (!this.isInitialized) {
      console.warn('⚠️ Position Manager not initialized, skipping pool storage');
      return;
    }

    try {
      console.log(`🎯 Processing Status 6 pool: ${data.pool_id}`);
      const poolData = data.data;
      
      // Extract token information from nested objects if they exist
      const tokenAMint = poolData.token_a_mint || (poolData.token_a && poolData.token_a.mint);
      const tokenBMint = poolData.token_b_mint || (poolData.token_b && poolData.token_b.mint);
      const decimalsA = poolData.decimals_a || (poolData.token_a && poolData.token_a.decimals);
      const decimalsB = poolData.decimals_b || (poolData.token_b && poolData.token_b.decimals);
      
      // Validate required fields
      const requiredFields = [
        { field: 'token_a_mint', value: tokenAMint },
        { field: 'token_b_mint', value: tokenBMint },
        { field: 'base_vault', value: poolData.base_vault },
        { field: 'quote_vault', value: poolData.quote_vault },
        { field: 'lp_mint', value: poolData.lp_mint },
        { field: 'market_id', value: poolData.market_id },
        { field: 'amm_open_orders', value: poolData.amm_open_orders }
      ];
      
      const missingFields = requiredFields.filter(item => !item.value);
      if (missingFields.length > 0) {
        console.error(`❌ Missing required fields for pool ${data.pool_id}:`, missingFields.map(f => f.field));
        console.error(`❌ Pool data received:`, poolData);
        console.error(`❌ Extracted token info:`, { tokenAMint, tokenBMint, decimalsA, decimalsB });
        return;
      }
      
      // Check if pool already exists in database
      const existingPool = await this.db.getStatus6Pool(data.pool_id);
      if (existingPool) {
        console.log(`ℹ️ Pool ${data.pool_id} already exists in database, skipping duplicate insertion`);
        return;
      }
      
      // Convert the pool data to our comprehensive database format
      const status6Pool: Status6Pool = {
        pool_id: data.pool_id,
        token_a_mint: tokenAMint,
        token_b_mint: tokenBMint,
        base_vault: poolData.base_vault,
        quote_vault: poolData.quote_vault,
        lp_mint: poolData.lp_mint,
        market_id: poolData.market_id,
        amm_open_orders: poolData.amm_open_orders,
        trade_fee: poolData.trade_fee || 0,
        swap_fee: poolData.swap_fee || 0,
        min_size: poolData.min_size || 0,
        price_range_min: poolData.price_range_min || 0,
        price_range_max: poolData.price_range_max || 0,
        decimals_a: decimalsA || 9,
        decimals_b: decimalsB || 6,
        order_book_depth: poolData.order_book_depth || 0,
        pool_open_time: poolData.pool_open_time || Math.floor(Date.now() / 1000),
        detected_at: data.timestamp || Date.now(),
        analysis_status: 'pending'
      };

      // Store the pool in the database
      const poolId = await this.db.insertStatus6Pool(status6Pool);
      
      console.log(`💾 Stored Status 6 pool in database: ${data.pool_id} (ID: ${poolId})`);
      console.log(`📊 Pool details: ${status6Pool.token_a_mint} / ${status6Pool.token_b_mint}`);
      console.log(`💰 Fees: ${status6Pool.trade_fee}% trade, ${status6Pool.swap_fee}% swap`);
      console.log(`📈 Price range: ${status6Pool.price_range_min}x - ${status6Pool.price_range_max}x`);
      console.log(`🔢 Decimals: ${status6Pool.decimals_a}/${status6Pool.decimals_b}`);
      console.log(`🎯 Pool opens at: ${new Date(status6Pool.pool_open_time * 1000).toISOString()}`);
      
      // Emit event that pool has been stored
      this.eventEmitter.emit('pool_stored', {
        pool_id: data.pool_id,
        database_id: poolId,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error(`❌ Failed to store pool ${data.pool_id} in database:`, error);
      
      // Emit error event
      this.eventEmitter.emit('pool_storage_error', {
        pool_id: data.pool_id,
        error: error.message,
        timestamp: Date.now()
      });
    }
  }

  // Public methods for accessing the database
  async getPendingPools(): Promise<Status6Pool[]> {
    if (!this.isInitialized) {
      throw new Error('Position Manager not initialized');
    }
    return await this.db.getPendingPools();
  }

  async getRecentPools(limit: number = 50): Promise<Status6Pool[]> {
    if (!this.isInitialized) {
      throw new Error('Position Manager not initialized');
    }
    return await this.db.getRecentPools(limit);
  }

  async getPool(poolId: string): Promise<Status6Pool | null> {
    if (!this.isInitialized) {
      throw new Error('Position Manager not initialized');
    }
    return await this.db.getStatus6Pool(poolId);
  }

  async updatePoolAnalysis(poolId: string, updates: Partial<Status6Pool>): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Position Manager not initialized');
    }
    await this.db.updateStatus6Pool(poolId, updates);
  }

  async getDatabaseStats(): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('Position Manager not initialized');
    }
    return await this.db.getDatabaseStats();
  }

  // Health check method
  async getHealthStatus(): Promise<{ status: string; stats?: any }> {
    try {
      if (!this.isInitialized) {
        return { status: 'not_initialized' };
      }
      
      const stats = await this.getDatabaseStats();
      return { 
        status: 'healthy',
        stats 
      };
    } catch (error) {
      return { 
        status: 'error',
        stats: { error: error.message }
      };
    }
  }

  // Pool Snapshot methods
  async insertPoolSnapshot(snapshot: PoolSnapshot): Promise<number> {
    if (!this.isInitialized) {
      throw new Error('Position Manager not initialized');
    }
    return await this.db.insertPoolSnapshot(snapshot);
  }

  async getPoolSnapshots(poolId: string, limit: number = 100): Promise<PoolSnapshot[]> {
    if (!this.isInitialized) {
      throw new Error('Position Manager not initialized');
    }
    return await this.db.getPoolSnapshots(poolId, limit);
  }
} 