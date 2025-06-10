import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import { TokenInfo } from '../../types/token';
import { PoolUpdate } from '../../types/market';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 POPCAT-SOL Pool Monitor Test');
  console.log('===============================');
  console.log('Testing with a more volatile pool that should show price changes');
  console.log('Press Ctrl+C to stop\n');

  // POPCAT-SOL pool
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
  class PopcatMonitor extends PoolMonitor {
    constructor(options: any) {
      super(options);
      // Force active mode for known pools
      this.isSilentMode = false;
      this.hasDetectedActivity = true;
    }

    async start() {
      console.log(`🚀 Starting POPCAT-SOL monitor`);
      console.log(`Pool ID: ${this.poolId.toBase58()}`);
      console.log(`Base Token: ${this.tokenA.symbol} (${this.tokenA.mint})`);
      console.log(`Quote Token: ${this.tokenB.symbol} (${this.tokenB.mint})`);
      console.log(`📊 Will only show output when price or reserves change`);
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

  const monitor = new PopcatMonitor({
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
    
    console.log(`⏱️  Monitoring for 120 seconds...`);
    console.log(`📊 You should see colored output when price changes occur`);
    console.log(`💓 Heartbeat every 60 seconds if no changes\n`);
    
    await new Promise(resolve => setTimeout(resolve, 120000));
    
    monitor.stop();
    console.log(`\n⏹️  Stopped monitoring`);
    
  } catch (error) {
    console.error(`❌ Error:`, error);
    monitor.stop();
  }

  console.log('\n✅ POPCAT-SOL test complete!');
  console.log('Summary:');
  console.log('- POPCAT-SOL should be more volatile than SOL/USDC');
  console.log('- Green percentages = price increase from baseline');
  console.log('- Red percentages = price decrease from baseline');
  console.log('- Heartbeat shows monitoring is still active');
}

main().catch(console.error); 