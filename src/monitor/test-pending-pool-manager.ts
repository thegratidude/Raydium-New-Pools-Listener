import { config } from 'dotenv';
config();
import { Connection } from '@solana/web3.js';
import { PendingPoolManager } from './pending-pool-manager';

const HTTP_URL = process.env.HTTP_URL!;
const connection = new Connection(HTTP_URL);

const knownPool = {
  poolId: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2', // SOL/USDC
  tokenA: 'SOL',
  tokenB: 'USDC',
};
const fakePool = {
  poolId: '2uL5j6h8k9m1p3r5t7w9z1x3v5b7n9q2s4u6w8y1a3c5e',
  tokenA: 'FAKE',
  tokenB: 'USDC',
};

let resolved = 0;

const manager = new PendingPoolManager({
  connection,
  checkInterval: 10_000, // 10s for test
  maxAttempts: 3,        // quick fail for fake
  onPoolReady: (pool) => {
    console.log(`✅ Indexed: ${pool.tokenA}/${pool.tokenB} (${pool.poolId}) after ${pool.attempts} attempts`);
    resolved++;
    if (resolved === 2) {
      manager.stop();
      process.exit(0);
    }
  },
});

manager.addPool(knownPool.poolId, knownPool.tokenA, knownPool.tokenB);
manager.addPool(fakePool.poolId, fakePool.tokenA, fakePool.tokenB);

// Also log failures
setInterval(() => {
  const failed = manager.getPendingPools().filter(p => p.state === 'failed');
  for (const pool of failed) {
    console.log(`❌ Failed: ${pool.tokenA}/${pool.tokenB} (${pool.poolId}) after ${pool.attempts} attempts`);
    resolved++;
    manager.removePool(pool.poolId);
    if (resolved === 2) {
      manager.stop();
      process.exit(0);
    }
  }
}, 2000); 