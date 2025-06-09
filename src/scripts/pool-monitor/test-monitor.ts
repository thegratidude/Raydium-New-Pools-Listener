import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const connection = new Connection(process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com');
  
  // Using the Raydium SOL/USDC pool
  const POOL_ID = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
  
  console.log('Starting monitor...');
  console.log(`Monitoring pool: ${POOL_ID}`);
  console.log('Press Ctrl+C to stop\n');

  const monitor = new PoolMonitor({
    connection,
    config: {
      poolAddress: new PublicKey(POOL_ID),
      updateInterval: 1000,
      tradeWindow: 3600,
      priceAlertThreshold: 5,
      liquidityAlertThreshold: 10,
      volumeAlertThreshold: 1000
    },
    onPriceUpdate: (price) => {
      console.log(`Price Update: ${price.priceChangePercent.toFixed(2)}% change`);
    }
  });

  try {
    await monitor.start();
  } catch (error) {
    console.error('Failed to start monitor:', error);
    process.exit(1);
  }

  process.on('SIGINT', () => {
    console.log('\nStopping monitor...');
    monitor.stop();
    process.exit(0);
  });
}

main().catch(console.error); 