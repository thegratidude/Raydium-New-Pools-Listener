import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import { TokenInfo } from '../../types/token';
import { PoolUpdate } from '../../types/market';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 Testing Pool Monitor with Different Volatility Levels');
  console.log('======================================================');
  console.log('Monitoring multiple pools to show price changes');
  console.log('Press Ctrl+C to stop\n');

  // Test pools with different volatility levels
  const testPools = [
    {
      name: 'SOL/USDC (Stable)',
      poolId: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
      tokenA: { symbol: 'SOL', decimals: 9, mint: 'So11111111111111111111111111111111111111112' },
      tokenB: { symbol: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
    },
    {
      name: 'BONK/USDC (More Volatile)',
      poolId: '6UmmUYo8wnKiq4r6vKqZQd6vXrPrqVJQQuXabKkLLU9U',
      tokenA: { symbol: 'BONK', decimals: 5, mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
      tokenB: { symbol: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
    },
    {
      name: 'RAY/USDC (Medium Volatility)',
      poolId: '7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX',
      tokenA: { symbol: 'RAY', decimals: 6, mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' },
      tokenB: { symbol: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
    }
  ];

  // Create a simple monitor that shows output immediately (no silent mode)
  class VolatilityTestMonitor extends PoolMonitor {
    private poolName: string;

    constructor(options: any, poolName: string) {
      super(options);
      this.poolName = poolName;
      // Force active mode for known pools
      this.isSilentMode = false;
      this.hasDetectedActivity = true;
    }

    async start() {
      console.log(`🚀 Starting monitor for ${this.poolName}`);
      console.log(`Pool ID: ${this.poolId.toBase58()}\n`);
      
      // Start in active mode (not silent)
      this.isSilentMode = false;
      this.hasDetectedActivity = true;

      // Initial state fetch
      await this.processPoolUpdate();

      // Start polling every 1 second
      this.intervalId = setInterval(async () => {
        try {
          await this.processPoolUpdate();
        } catch (error) {
          console.error(`Error in polling interval for ${this.poolName}:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }, this.updateInterval);
    }
  }

  const monitors: VolatilityTestMonitor[] = [];

  // Create monitors for each pool
  for (const pool of testPools) {
    const monitor = new VolatilityTestMonitor({
      poolId: new PublicKey(pool.poolId),
      tokenA: pool.tokenA,
      tokenB: pool.tokenB,
      httpUrl: process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
      wssUrl: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
      onUpdate: (update: PoolUpdate) => {
        // This will only be called on reserve changes
        console.log(`🚨 RESERVE CHANGE: ${update.base_token}/${update.quote_token} - ${update.reserve_change_percent?.toFixed(4)}% change`);
      },
      isSimulation: false
    }, pool.name);

    monitors.push(monitor);
  }

  try {
    // Start all monitors
    for (const monitor of monitors) {
      await monitor.start();
      // Small delay between starts to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`⏱️  Monitoring ${monitors.length} pools for 60 seconds...`);
    console.log(`📊 You should see price updates every 1 second with colored percentage changes\n`);
    
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    // Stop all monitors
    for (const monitor of monitors) {
      monitor.stop();
    }
    console.log(`\n⏹️  Stopped all monitors`);
    
  } catch (error) {
    console.error(`❌ Error:`, error);
    for (const monitor of monitors) {
      monitor.stop();
    }
  }

  console.log('\n✅ Volatility test complete!');
  console.log('Summary:');
  console.log('- SOL/USDC: Usually very stable (minimal price changes)');
  console.log('- BONK/USDC: More volatile (should show more price movement)');
  console.log('- RAY/USDC: Medium volatility (moderate price changes)');
  console.log('- Green percentages = price increase from baseline');
  console.log('- Red percentages = price decrease from baseline');
}

main().catch(console.error); 