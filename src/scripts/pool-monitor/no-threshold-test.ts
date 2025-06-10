import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import { TokenInfo } from '../../types/token';
import { PoolUpdate } from '../../types/market';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 No-Threshold Pool Monitor Test');
  console.log('=================================');
  console.log('Testing with NO thresholds - will show every change');
  console.log('Press Ctrl+C to stop\n');

  // Test with POPCAT-SOL pool
  const POPCAT_SOL_POOL = 'FRhB8L7Y9Qq41qZXYLtC2nw8An1RJfLLxRF2x9RwLLMo';
  
  const tokenA: TokenInfo = {
    symbol: 'POPCAT',
    decimals: 9,
    mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'
  };
  
  const tokenB: TokenInfo = {
    symbol: 'SOL',
    decimals: 9,
    mint: 'So11111111111111111111111111111111111111112'
  };

  // Create a simple monitor that shows output immediately (no silent mode)
  class NoThresholdMonitor extends PoolMonitor {
    constructor(options: any) {
      super(options);
      this.isSilentMode = false;
      this.hasDetectedActivity = true;
    }

    async start() {
      console.log(`🚀 Starting no-threshold monitor for ${this.tokenA.symbol}/${this.tokenB.symbol}`);
      console.log(`Pool ID: ${this.poolId.toBase58()}`);
      console.log(`📊 Will show output for ANY change (no thresholds)`);
      console.log(`💓 Heartbeat every 60 seconds when no changes occur\n`);
      
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
          console.error(`Error in polling interval:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }, this.updateInterval);
    }
  }

  const monitor = new NoThresholdMonitor({
    poolId: new PublicKey(POPCAT_SOL_POOL),
    tokenA,
    tokenB,
    httpUrl: process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
    wssUrl: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
    onUpdate: (update: PoolUpdate) => {
      // This will only be called on reserve changes
      console.log(`🚨 RESERVE CHANGE: ${update.base_token}/${update.quote_token} - ${update.reserve_change_percent?.toFixed(4)}% change`);
    },
    isSimulation: false
  });

  try {
    await monitor.start();
    
    console.log(`⏱️  Monitoring for 60 seconds...`);
    console.log(`📊 You should see output for ANY price or reserve change\n`);
    
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    monitor.stop();
    console.log(`\n⏹️  Stopped monitoring`);
    
  } catch (error) {
    console.error(`❌ Error:`, error);
    monitor.stop();
  }

  console.log('\n✅ No-threshold test complete!');
  console.log('Summary:');
  console.log('- All thresholds disabled');
  console.log('- Should show every price/reserve change');
  console.log('- Green percentages = price increase from baseline');
  console.log('- Red percentages = price decrease from baseline');
}

main().catch(console.error); 