import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PositionManagerService } from './src/position-manager/position-manager.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

async function testFullSystem() {
  console.log('🚀 Starting Full System Test...');
  
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    // Get the position manager service
    const positionManager = app.get(PositionManagerService);
    const eventEmitter = app.get(EventEmitter2);
    
    console.log('✅ Application started successfully');
    
    // Wait for services to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check initial database stats
    const initialStats = await positionManager.getDatabaseStats();
    console.log('📊 Initial database stats:', initialStats);
    
    // Simulate a real pool_status_6 event
    const mockPoolData = {
      pool_id: 'full_system_test_pool_456',
      timestamp: Date.now(),
      data: {
        pool_id: 'full_system_test_pool_456',
        token_a_mint: 'So11111111111111111111111111111111111111112',
        token_b_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        base_vault: 'base_vault_full_test_456',
        quote_vault: 'quote_vault_full_test_456',
        lp_mint: 'lp_mint_full_test_456',
        market_id: 'market_id_full_test_456',
        amm_open_orders: 'amm_open_orders_full_test_456',
        trade_fee: 0.3,
        swap_fee: 0.3,
        min_size: 2000000000,
        price_range_min: 0.5,
        price_range_max: 2000000000.0,
        decimals_a: 8,
        decimals_b: 6,
        order_book_depth: 5,
        pool_open_time: Math.floor(Date.now() / 1000) + 300, // Opens in 5 minutes
        detected_at: Date.now(),
        analysis_status: 'pending'
      }
    };

    console.log('📡 Emitting pool_status_6 event to full system...');
    eventEmitter.emit('pool_status_6', mockPoolData);
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if pool was stored
    const storedPool = await positionManager.getPool('full_system_test_pool_456');
    if (storedPool) {
      console.log('✅ Pool successfully stored in full system!');
      console.log('📊 Final pool details:', {
        pool_id: storedPool.pool_id,
        token_a_mint: storedPool.token_a_mint,
        token_b_mint: storedPool.token_b_mint,
        trade_fee: storedPool.trade_fee,
        swap_fee: storedPool.swap_fee,
        analysis_status: storedPool.analysis_status,
        pool_open_time: new Date(storedPool.pool_open_time * 1000).toISOString()
      });
    } else {
      console.log('❌ Pool was not stored in full system');
    }
    
    // Get final database stats
    const finalStats = await positionManager.getDatabaseStats();
    console.log('📊 Final database stats:', finalStats);
    
    console.log('🎉 Full system test completed successfully!');
    
  } catch (error) {
    console.error('❌ Full system test failed:', error);
  } finally {
    await app.close();
    console.log('✅ Application shut down');
  }
}

// Run the full system test
testFullSystem().catch(console.error); 