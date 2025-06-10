import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Connection } from '@solana/web3.js';
import { UnifiedPoolMonitorService } from './src/monitor/unified-pool-monitor.service';
import { PositionManagerService } from './src/position-manager/position-manager.service';
import { SocketService } from './src/gateway/socket.service';
import { GatewayService } from './src/gateway/gateway.service';

async function testIntegration() {
  console.log('🧪 Testing Monitor → Position Manager Integration...');
  
  // Create a test module
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
      UnifiedPoolMonitorService,
      PositionManagerService,
      SocketService,
      GatewayService,
      {
        provide: Connection,
        useFactory: () => new Connection('https://api.mainnet-beta.solana.com', {
          commitment: 'confirmed'
        })
      }
    ],
  }).compile();

  const monitorService = module.get<UnifiedPoolMonitorService>(UnifiedPoolMonitorService);
  const positionManagerService = module.get<PositionManagerService>(PositionManagerService);
  const eventEmitter = module.get<EventEmitter2>(EventEmitter2);

  try {
    // Initialize the position manager
    await positionManagerService.onModuleInit();
    console.log('✅ Position Manager initialized');

    // Simulate a pool_status_6 event
    const mockPoolData = {
      pool_id: 'test_integration_pool_123',
      timestamp: Date.now(),
      data: {
        pool_id: 'test_integration_pool_123',
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
        detected_at: Date.now(),
        analysis_status: 'pending'
      }
    };

    console.log('📡 Emitting pool_status_6 event...');
    eventEmitter.emit('pool_status_6', mockPoolData);

    // Wait a moment for the event to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check if the pool was stored in the database
    const storedPool = await positionManagerService.getPool('test_integration_pool_123');
    if (storedPool) {
      console.log('✅ Pool successfully stored in database!');
      console.log('📊 Stored pool details:', {
        pool_id: storedPool.pool_id,
        token_a_mint: storedPool.token_a_mint,
        token_b_mint: storedPool.token_b_mint,
        trade_fee: storedPool.trade_fee,
        swap_fee: storedPool.swap_fee,
        analysis_status: storedPool.analysis_status
      });
    } else {
      console.log('❌ Pool was not stored in database');
    }

    // Get database stats
    const stats = await positionManagerService.getDatabaseStats();
    console.log('📊 Database stats:', stats);

  } catch (error) {
    console.error('❌ Integration test failed:', error);
  } finally {
    // Cleanup
    await positionManagerService.onModuleDestroy();
    console.log('✅ Integration test completed');
  }
}

// Run the integration test
testIntegration().catch(console.error); 