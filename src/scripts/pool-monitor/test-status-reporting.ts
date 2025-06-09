import { Connection } from '@solana/web3.js';
import { PoolMonitorManager } from '../../monitor/pool-monitor-manager';
import { SocketService } from '../../gateway/socket.service';
import { PendingPoolManager } from '../../monitor/pending-pool-manager';
import { TokenInfo } from '../../types/token';
import * as dotenv from 'dotenv';

dotenv.config();

// Test status reporting functionality
class StatusReportingTest {
  private connection: Connection;
  private socketService: SocketService;
  private pendingPoolManager: PendingPoolManager;
  private poolMonitorManager: PoolMonitorManager;

  constructor() {
    this.connection = new Connection(process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com');
    this.socketService = new SocketService();
    
    // Create pool monitor manager first
    this.poolMonitorManager = new PoolMonitorManager(
      this.connection,
      this.socketService,
      null // Will be set after pending pool manager is created
    );
    
    // Create pending pool manager with reference to pool monitor manager
    this.pendingPoolManager = new PendingPoolManager(
      this.connection,
      () => {}, // Empty callback for testing
      this.poolMonitorManager
    );
    
    // Set the pending pool manager in the pool monitor manager
    this.poolMonitorManager.setPendingPoolManager(this.pendingPoolManager);
  }

  async run() {
    console.log('🏭 STATUS REPORTING TEST');
    console.log('='.repeat(60));
    console.log('Testing periodic status reporting every minute...');
    console.log('This will show pools being monitored silently vs actively');
    console.log('='.repeat(60));

    try {
      // Initialize the manager
      await this.poolMonitorManager.onModuleInit();

      // Add some test pools
      const testPools = [
        {
          pool_id: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2', // SOL/USDC
          token_a: { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112' } as TokenInfo,
          token_b: { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } as TokenInfo
        },
        {
          pool_id: '7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX', // RAY/USDC
          token_a: { symbol: 'RAY', mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' } as TokenInfo,
          token_b: { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } as TokenInfo
        },
        {
          pool_id: '8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaTUapubyvu', // SRM/USDC
          token_a: { symbol: 'SRM', mint: 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt' } as TokenInfo,
          token_b: { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } as TokenInfo
        }
      ];

      console.log('📊 Adding test pools...');
      for (const pool of testPools) {
        await this.poolMonitorManager.addPool(pool);
        console.log(`  ✅ Added ${pool.token_a.symbol}/${pool.token_b.symbol}`);
      }

      console.log('\n⏰ Status reports will appear every minute...');
      console.log('Press Ctrl+C to stop after seeing a few reports\n');

      // Let it run for 3 minutes to show multiple status reports
      await new Promise(resolve => setTimeout(resolve, 180000));

    } catch (error) {
      console.error('❌ Error during test:', error);
    } finally {
      // Cleanup
      await this.poolMonitorManager.onModuleDestroy();
      console.log('\n✅ Test completed');
    }
  }
}

// Run the test
const test = new StatusReportingTest();
test.run().catch(console.error); 