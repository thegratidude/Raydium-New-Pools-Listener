import { Connection } from '@solana/web3.js';
import { PendingPoolManager } from './pending-pool-manager';
import { PoolMonitorService } from './pool-monitor.service';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

async function runTest() {
  const HTTP_URL = process.env.HTTP_URL!;
  const connection = new Connection(HTTP_URL);

  // Create NestJS app to get PoolMonitorService
  const app = await NestFactory.create(AppModule);
  await app.init();
  const poolMonitorService = app.get(PoolMonitorService);

  // Create manager with injected services
  const manager = new PendingPoolManager(connection, poolMonitorService);

  // Test pool
  const testPool = {
    poolId: 'test_pool_123',
    tokenA: 'So11111111111111111111111111111111111111112', // SOL
    tokenB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'  // USDC
  };

  // Add test pool
  manager.addPool(testPool.poolId, testPool.tokenA, testPool.tokenB);

  // Keep the process running
  console.log('Test pending pool manager running... Press Ctrl+C to stop');
  process.on('SIGINT', async () => {
    console.log('Stopping test pending pool manager...');
    await app.close();
    process.exit(0);
  });
}

runTest().catch(console.error); 