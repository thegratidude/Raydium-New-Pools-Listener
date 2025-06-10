import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Connection } from '@solana/web3.js';
import { PositionManagerService } from './src/position-manager/position-manager.service';

async function testUpdatedIntegration() {
  console.log('🧪 Testing Updated Integration with Comprehensive Pool Data...');
  
  const module: TestingModule = await Test.createTestingModule({
    imports: [
      EventEmitterModule.forRoot({
        wildcard: false,
        delimiter: '.',
        newListener: false,
        removeListener: false,
        maxListeners: 10,
        verboseMemoryLeak: false,
        ignoreErrors: false,
      }),
    ],
    providers: [
      PositionManagerService,
      {
        provide: Connection,
        useFactory: () => new Connection('https://api.mainnet-beta.solana.com', {
          commitment: 'confirmed'
        })
      }
    ],
  }).compile();

  const positionManager = module.get<PositionManagerService>(PositionManagerService);
  const eventEmitter = module.get<EventEmitter2>(EventEmitter2);

  try {
    // Initialize the position manager
    await positionManager.onModuleInit();
    console.log('✅ Position Manager initialized');

    // Simulate the updated data structure that the monitor now sends
    const mockUpdatedData = {
      pool_id: 'test_updated_pool_789',
      timestamp: Date.now(),
      data: {
        // Basic pool info (now included by the monitor)
        pool_id: 'test_updated_pool_789',
        token_a_mint: 'So11111111111111111111111111111111111111112',
        token_b_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        base_vault: 'base_vault_test_789',
        quote_vault: 'quote_vault_test_789',
        lp_mint: 'lp_mint_test_789',
        market_id: 'market_id_test_789',
        amm_open_orders: 'amm_open_orders_test_789',
        
        // Fee structure (calculated as percentages)
        trade_fee: 0.25,
        swap_fee: 0.25,
        
        // Trading parameters
        min_size: 1000000000,
        price_range_min: 1.0,
        price_range_max: 1000000000.0,
        decimals_a: 6,
        decimals_b: 9,
        order_book_depth: 3,
        pool_open_time: Math.floor(Date.now() / 1000) - 60,
        detected_at: Date.now(),
        analysis_status: 'pending',
        
        // Additional token info for compatibility
        token_a: { symbol: 'TOKEN_A', mint: 'So11111111111111111111111111111111111111112', decimals: 6 },
        token_b: { symbol: 'TOKEN_B', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 9 },
        
        // Additional metadata
        pool_age_seconds: 60
      }
    };

    console.log('📡 Emitting pool_status_6 event with updated comprehensive data structure...');
    console.log('📊 Mock data structure:', JSON.stringify(mockUpdatedData, null, 2));
    
    eventEmitter.emit('pool_status_6', mockUpdatedData);
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if the pool was stored in the database
    const storedPool = await positionManager.getPool('test_updated_pool_789');
    if (storedPool) {
      console.log('✅ Pool successfully stored in database!');
      console.log('📊 Stored pool details:', {
        pool_id: storedPool.pool_id,
        token_a_mint: storedPool.token_a_mint,
        token_b_mint: storedPool.token_b_mint,
        trade_fee: storedPool.trade_fee,
        swap_fee: storedPool.swap_fee,
        analysis_status: storedPool.analysis_status,
        pool_open_time: new Date(storedPool.pool_open_time * 1000).toISOString()
      });
    } else {
      console.log('❌ Pool was not stored in database');
    }
    
    // Get database stats
    const stats = await positionManager.getDatabaseStats();
    console.log('📊 Database stats:', stats);
    
    console.log('🎉 Updated integration test completed successfully!');

  } catch (error) {
    console.error('❌ Updated integration test failed:', error);
  } finally {
    await positionManager.onModuleDestroy();
    console.log('✅ Test completed');
  }
}

// Run the updated integration test
testUpdatedIntegration().catch(console.error); 