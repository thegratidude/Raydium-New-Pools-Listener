import { Connection } from '@solana/web3.js';
import { PendingPoolManager } from './pending-pool-manager';
import { TokenInfo } from '../types/token';

// Mock SocketService implementation
class MockSocketService {
  private isServerReady = true;

  constructor() {
    console.log('MockSocketService initialized');
  }

  async broadcastPoolUpdate(pool_id: string, update: any) {
    console.log(`[MockSocketService] Broadcasting update for pool ${pool_id}:`, update);
  }

  async broadcastPoolReady(pool_id: string, token_a: TokenInfo, token_b: TokenInfo) {
    console.log(`[MockSocketService] Broadcasting ready for pool ${pool_id}: ${token_a.symbol}/${token_b.symbol}`);
  }

  isReady(): boolean {
    return this.isServerReady;
  }
}

async function testPendingPoolManager() {
  // Create a mock connection
  const connection = new Connection('https://api.mainnet-beta.solana.com');

  // Create a mock socket service
  const socketService = new MockSocketService();

  // Create the pending pool manager with a callback
  const pendingPoolManager = new PendingPoolManager(
    connection,
    (pool) => {
      console.log(`Pool ready callback called for ${pool.pool_id}`);
      // Broadcast pool ready event
      socketService.broadcastPoolReady(pool.pool_id, pool.token_a, pool.token_b);
    }
  );

  // Start the manager
  await pendingPoolManager.onModuleInit();
  pendingPoolManager.start();

  // Add some test pools
  const testPools = [
    {
      pool_id: 'test_pool_1',
      token_a: { symbol: 'TEST1', mint: 'mint1', decimals: 9 } as TokenInfo,
      token_b: { symbol: 'USDC', mint: 'mint2', decimals: 6 } as TokenInfo
    },
    {
      pool_id: 'test_pool_2',
      token_a: { symbol: 'TEST2', mint: 'mint3', decimals: 9 } as TokenInfo,
      token_b: { symbol: 'USDC', mint: 'mint2', decimals: 6 } as TokenInfo
    }
  ];

  // Add pools and simulate trade data
  for (const pool of testPools) {
    pendingPoolManager.addPool(pool.pool_id, pool.token_a, pool.token_b);

    // Simulate trade data after a delay
    setTimeout(() => {
      pendingPoolManager.notifyTradeData(pool.pool_id, {
        trade_count: 3,
        reserve_change_percent: 5.0,
        time_since_first_trade: 15000
      });
    }, 15000);
  }

  // Let the test run for a while
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Cleanup
  pendingPoolManager.stop();
  await pendingPoolManager.onModuleDestroy();
}

// Run the test
testPendingPoolManager().catch(console.error); 