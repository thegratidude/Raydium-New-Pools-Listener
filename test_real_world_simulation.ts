import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Connection } from '@solana/web3.js';
import { PositionManagerService } from './src/position-manager/position-manager.service';

async function testRealWorldSimulation() {
  console.log('🧪 Testing Real-World Data Structure...');
  
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

    // Simulate the exact data structure that might be coming from the monitor
    // This simulates what happens when the monitor processes a real pool
    const mockRealWorldData = {
      pool_id: '4NWcKhUxzZJo1DgHAN7VqguVXpBwP8WpwEzx8AbGqSDv',
      timestamp: Date.now(),
      data: {
        // This is what the monitor might be sending
        pool_id: '4NWcKhUxzZJo1DgHAN7VqguVXpBwP8WpwEzx8AbGqSDv',
        token_a: { symbol: 'TOKEN_A', mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
        token_b: { symbol: 'TOKEN_B', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
        time_to_status_6_ms: 10000,
        // These might be missing or null in real data
        token_a_mint: null, // This could be the issue!
        token_b_mint: null, // This could be the issue!
        base_vault: null,
        quote_vault: null,
        lp_mint: null,
        market_id: null,
        amm_open_orders: null,
        trade_fee: null,
        swap_fee: null,
        min_size: null,
        price_range_min: null,
        price_range_max: null,
        decimals_a: null,
        decimals_b: null,
        order_book_depth: null,
        pool_open_time: null,
        detected_at: null,
        analysis_status: null
      }
    };

    console.log('📡 Emitting pool_status_6 event with potentially null fields...');
    console.log('📊 Mock data structure:', JSON.stringify(mockRealWorldData, null, 2));
    
    eventEmitter.emit('pool_status_6', mockRealWorldData);
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('✅ Test completed - check logs for validation errors');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await positionManager.onModuleDestroy();
    console.log('✅ Test completed');
  }
}

// Run the test
testRealWorldSimulation().catch(console.error); 