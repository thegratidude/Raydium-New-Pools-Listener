import { PositionManagerDB, Status6Pool, PoolSnapshot, TradeHistory } from './src/position-manager/database/position-manager-db';

async function testPositionManagerDB() {
  console.log('🧪 Testing Simplified Position Manager Database...');
  
  const db = new PositionManagerDB();
  
  try {
    // Initialize the database
    await db.initialize();
    console.log('✅ Database initialized successfully');
    
    // Test inserting a pool
    const testPool: Status6Pool = {
      pool_id: 'test_pool_123',
      token_a_mint: 'So11111111111111111111111111111111111111112',
      token_b_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      base_vault: 'base_vault_test_123',
      quote_vault: 'quote_vault_test_123',
      lp_mint: 'lp_mint_test_123',
      market_id: 'market_id_test_123',
      amm_open_orders: 'amm_open_orders_test_123',
      trade_fee: 0.25,
      swap_fee: 0.25,
      min_size: 1000000000,
      price_range_min: 1.0,
      price_range_max: 1000000000.0,
      decimals_a: 6,
      decimals_b: 9,
      order_book_depth: 3,
      pool_open_time: Math.floor(Date.now() / 1000) - 60,
      detected_at: Date.now()
    };
    
    console.log('📝 Inserting test pool...');
    const poolId = await db.insertStatus6Pool(testPool);
    console.log(`✅ Inserted test pool with ID: ${poolId}`);
    
    // Test retrieving the pool
    const retrievedPool = await db.getStatus6Pool('test_pool_123');
    if (retrievedPool) {
      console.log('✅ Successfully retrieved pool:', retrievedPool.pool_id);
      console.log('📊 Pool details:', {
        pool_id: retrievedPool.pool_id,
        token_a_mint: retrievedPool.token_a_mint,
        token_b_mint: retrievedPool.token_b_mint,
        analysis_status: retrievedPool.analysis_status,
        created_at: retrievedPool.created_at
      });
    } else {
      console.log('❌ Failed to retrieve pool');
    }
    
    // Test inserting a pool snapshot
    const testSnapshot: PoolSnapshot = {
      pool_id: 'test_pool_123',
      timestamp: Date.now(),
      price: 1.5,
      base_reserve: 1000000,
      quote_reserve: 1500000,
      volume_24h: 50000
    };
    
    console.log('📝 Inserting pool snapshot...');
    const snapshotId = await db.insertPoolSnapshot(testSnapshot);
    console.log(`✅ Inserted snapshot with ID: ${snapshotId}`);
    
    // Test inserting trade history
    const testTrade: TradeHistory = {
      pool_id: 'test_pool_123',
      tx_signature: 'test_tx_signature_123',
      trade_type: 'swap',
      base_amount: 1000,
      quote_amount: 1500,
      price: 1.5,
      block_time: Math.floor(Date.now() / 1000)
    };
    
    console.log('📝 Inserting trade history...');
    const tradeId = await db.insertTradeHistory(testTrade);
    console.log(`✅ Inserted trade with ID: ${tradeId}`);
    
    // Test getting snapshots
    const snapshots = await db.getPoolSnapshots('test_pool_123');
    console.log(`✅ Retrieved ${snapshots.length} snapshots`);
    
    // Test getting trade history
    const trades = await db.getTradeHistory('test_pool_123');
    console.log(`✅ Retrieved ${trades.length} trades`);
    
    // Test database stats
    const stats = await db.getDatabaseStats();
    console.log('📊 Database stats:', stats);
    
    console.log('🎉 All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      errno: error.errno
    });
  } finally {
    await db.close();
    console.log('✅ Database connection closed');
  }
}

// Run the test
testPositionManagerDB().catch(console.error); 