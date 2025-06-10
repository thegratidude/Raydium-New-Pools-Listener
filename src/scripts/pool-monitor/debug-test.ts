import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import { TokenInfo } from '../../types/token';
import { PoolUpdate } from '../../types/market';
import { Api } from '@raydium-io/raydium-sdk-v2';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 Debug Pool Monitor Test');
  console.log('==========================');
  console.log('Testing with ultra-sensitive thresholds and debug output');
  console.log('Press Ctrl+C to stop\n');

  // Test with multiple pools
  const testPools = [
    {
      name: 'POPCAT-SOL',
      poolId: 'FRhB8L7Y9Qq41qZXYLtC2nw8An1RJfLLxRF2x9RwLLMo',
      tokenA: { symbol: 'POPCAT', decimals: 9, mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' },
      tokenB: { symbol: 'SOL', decimals: 9, mint: 'So11111111111111111111111111111111111111112' }
    },
    {
      name: 'BONK-USDC',
      poolId: '6UmmUYo8wnKiq4r6vKqZQd6vXrPrqVJQQuXabKkLLU9U',
      tokenA: { symbol: 'BONK', decimals: 5, mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
      tokenB: { symbol: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
    }
  ];

  // Create a debug monitor with ultra-sensitive thresholds
  class DebugMonitor extends PoolMonitor {
    private poolName: string;

    constructor(options: any, poolName: string) {
      super(options);
      this.poolName = poolName;
      this.isSilentMode = false;
      this.hasDetectedActivity = true;
      
      // Override thresholds to be ultra-sensitive
      this.RESERVE_CHANGE_THRESHOLD = 0.00001; // 0.001% instead of 0.05%
    }

    protected detectPriceChange(currentPrice: number): boolean {
      // If this is the first time we're seeing a price, it's not a change
      if (this.baselinePrice === null) {
        this.baselinePrice = currentPrice;
        return false;
      }

      // Calculate percentage change from baseline
      const priceChange = Math.abs((currentPrice - this.baselinePrice) / this.baselinePrice);
      
      // Ultra-sensitive detection - detect changes as small as 0.001%
      return priceChange > 0.00001; // 0.001% change threshold
    }

    protected isNewChange(currentPrice: number): boolean {
      // If we haven't shown any price yet, this is a new change
      if (this.lastShownPrice === null) {
        return true;
      }
      
      // Check if this price is significantly different from the last shown price
      const priceDifference = Math.abs(currentPrice - this.lastShownPrice);
      const percentageDifference = priceDifference / this.lastShownPrice;
      
      // Ultra-sensitive - show if there's at least a 0.0001% change from last shown
      return percentageDifference > 0.000001;
    }

    protected async processPoolUpdate() {
      try {
        // Track polling frequency
        this.pollCount++;
        const now = Date.now();
        
        // Use Raydium API for reliable pool data
        const api = new Api({ cluster: 'mainnet', timeout: 30000 });
        const poolInfo = await api.fetchPoolById({ ids: this.poolId.toBase58() });
        
        if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
          console.log(`❌ ${this.poolName}: Pool not indexed by Raydium API`);
          return;
        }

        const pool = poolInfo[0];
        if (!pool.mintA || !pool.mintB) {
          console.log(`❌ ${this.poolName}: Missing mint data`);
          return;
        }

        const baseReserve = pool.mintAmountA || 0;
        const quoteReserve = pool.mintAmountB || 0;
        
        // Check if we have valid reserves
        if (baseReserve <= 0 || quoteReserve <= 0) {
          console.log(`❌ ${this.poolName}: Invalid reserves: ${baseReserve} / ${quoteReserve}`);
          return;
        }

        // Calculate current price and check for changes
        const currentPrice = quoteReserve / baseReserve;
        const hasPriceChange = this.detectPriceChange(currentPrice);
        const hasReserveChange = this.detectReserveChange(baseReserve, quoteReserve);
        const isNewChange = this.isNewChange(currentPrice);
        
        // Debug output every 10 seconds
        if (this.pollCount % 10 === 0) {
          console.log(`🔍 ${this.poolName} | Poll #${this.pollCount} | Price: $${currentPrice.toFixed(8)} | Base: ${baseReserve.toFixed(2)} | Quote: ${quoteReserve.toFixed(2)}`);
          console.log(`   Price change: ${hasPriceChange} | Reserve change: ${hasReserveChange} | New change: ${isNewChange}`);
          
          if (this.baselinePrice !== null) {
            const priceChange = ((currentPrice - this.baselinePrice) / this.baselinePrice) * 100;
            console.log(`   Baseline: $${this.baselinePrice.toFixed(8)} | Change from baseline: ${priceChange.toFixed(6)}%`);
          }
          
          if (this.lastBaseReserve !== null && this.lastQuoteReserve !== null) {
            const baseChange = ((baseReserve - this.lastBaseReserve) / this.lastBaseReserve) * 100;
            const quoteChange = ((quoteReserve - this.lastQuoteReserve) / this.lastQuoteReserve) * 100;
            console.log(`   Reserve changes: Base ${baseChange.toFixed(6)}% | Quote ${quoteChange.toFixed(6)}%`);
          }
          console.log('');
        }
        
        // Only show output if there are actual changes AND it's a new change from last shown
        if ((hasPriceChange || hasReserveChange) && isNewChange) {
          // Calculate % change in reserves
          let baseChange = 0;
          let quoteChange = 0;
          
          if (this.lastBaseReserve !== null && this.lastQuoteReserve !== null) {
            baseChange = ((baseReserve - this.lastBaseReserve) / this.lastBaseReserve) * 100;
            quoteChange = ((quoteReserve - this.lastQuoteReserve) / this.lastQuoteReserve) * 100;
          }
          
          // Show colored output only when there are new changes
          const pricePercentage = this.getColoredPercentage(currentPrice);
          console.log(`📊 ${this.poolName} | Price: $${currentPrice.toFixed(8)} ${pricePercentage} | Base: ${baseChange.toFixed(6)}% | Quote: ${quoteChange.toFixed(6)}%`);
          
          // Update last shown price to prevent repeating
          this.lastShownPrice = currentPrice;
        } else {
          // No changes detected - check for heartbeat
          if (!this.lastHeartbeat || (now - this.lastHeartbeat) > this.HEARTBEAT_INTERVAL) {
            console.log(`💓 ${this.poolName} | Still monitoring... (${this.pollCount} polls, no changes in 60s)`);
            this.lastHeartbeat = now;
          }
        }

        // Update last reserves for next comparison
        this.lastBaseReserve = baseReserve;
        this.lastQuoteReserve = quoteReserve;
        
        // Set initial ratio if not set
        if (this.initialReserveRatio === null) {
          this.initialReserveRatio = quoteReserve / baseReserve;
          console.log(`📈 ${this.poolName}: Set initial ratio: ${this.initialReserveRatio}`);
        }

      } catch (error: any) {
        console.error(`❌ ${this.poolName} ERROR:`, error?.message || error);
      }
    }

    async start() {
      console.log(`🚀 Starting debug monitor for ${this.poolName}`);
      console.log(`Pool ID: ${this.poolId.toBase58()}`);
      console.log(`Ultra-sensitive thresholds: 0.001% for price, 0.001% for reserves\n`);
      
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

  const monitors: DebugMonitor[] = [];

  // Create monitors for each pool
  for (const pool of testPools) {
    const monitor = new DebugMonitor({
      poolId: new PublicKey(pool.poolId),
      tokenA: pool.tokenA,
      tokenB: pool.tokenB,
      httpUrl: process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
      wssUrl: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
      onUpdate: (update: PoolUpdate) => {
        // Not used in debug mode
      },
      isSimulation: false
    }, pool.name);

    monitors.push(monitor);
  }

  try {
    // Start all monitors
    for (const monitor of monitors) {
      await monitor.start();
      // Small delay between starts
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`⏱️  Monitoring ${monitors.length} pools for 60 seconds...`);
    console.log(`🔍 Debug output every 10 seconds showing all thresholds\n`);
    
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

  console.log('\n✅ Debug test complete!');
}

main().catch(console.error); 