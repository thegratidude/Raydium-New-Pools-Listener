import { Connection } from '@solana/web3.js';
import { getPoolMonitor } from './pool-monitor';
import * as dotenv from 'dotenv';

dotenv.config();

async function testIntegratedMonitor() {
  if (!process.env.HTTP_URL) {
    throw new Error('HTTP_URL must be defined in .env file');
  }

  console.log('\n🔍 Testing Integrated Pool Monitor');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('Testing the integration of pool discovery and real-time monitoring');
  console.log('Using SOL/USDC pool as a known good test case');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  const connection = new Connection(process.env.HTTP_URL);
  const monitor = getPoolMonitor(connection);

  // Test pool: SOL/USDC
  const TEST_POOL = {
    address: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
    tokenA: 'WSOL',
    tokenB: 'USDC'
  };

  try {
    // Add the pool to monitor
    await monitor.addPool(TEST_POOL.address, TEST_POOL.tokenA, TEST_POOL.tokenB);

    // Let it run for 2 minutes to see the monitoring in action
    console.log('\n⏳ Monitoring for 2 minutes...');
    console.log('Press Ctrl+C to stop\n');

    // Keep the script running
    await new Promise(resolve => setTimeout(resolve, 120000));

  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    // Clean up
    await monitor.stopAllMonitoring();
    console.log('\n✅ Test completed');
  }
}

// Run the test
testIntegratedMonitor().catch(console.error); 