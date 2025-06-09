import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import { TokenInfo } from '../../types/token';
import { PoolUpdate } from '../../types/market';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 Simple Pool Monitor Test - SOL/USDC');
  console.log('=====================================');
  console.log('Monitoring SOL/USDC pool for 30 seconds');
  console.log('You should see price updates every 10 seconds\n');

  // Test with known active Raydium pool
  const KNOWN_ACTIVE_POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'; // SOL/USDC pool
  
  const tokenA: TokenInfo = {
    symbol: 'SOL',
    decimals: 9,
    mint: 'So11111111111111111111111111111111111111112'
  };
  
  const tokenB: TokenInfo = {
    symbol: 'USDC',
    decimals: 6,
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  };

  // Create a simple monitor that shows output immediately (no silent mode)
  class SimplePoolMonitor extends PoolMonitor {
    constructor(options: any) {
      super(options);
      // Force active mode for known pools
      this.isSilentMode = false;
      this.hasDetectedActivity = true;
    }

    async start() {
      console.log(`🚀 Starting monitor for ${this.tokenA.symbol}/${this.tokenB.symbol} pool`);
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
          console.error(`Error in polling interval:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }, this.updateInterval);
    }
  }

  const monitor = new SimplePoolMonitor({
    poolId: new PublicKey(KNOWN_ACTIVE_POOL),
    tokenA,
    tokenB,
    httpUrl: process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
    wssUrl: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
    onUpdate: (update: PoolUpdate) => {
      // This will only be called on reserve changes, but we want regular updates
      console.log(`🚨 RESERVE CHANGE: ${update.base_token}/${update.quote_token} - ${update.reserve_change_percent?.toFixed(4)}% change`);
    },
    isSimulation: false
  });

  try {
    await monitor.start();
    
    console.log(`⏱️  Monitoring for 30 seconds...`);
    console.log(`📊 You should see price updates every 10 seconds\n`);
    
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    monitor.stop();
    console.log(`\n⏹️  Stopped monitoring`);
    
  } catch (error) {
    console.error(`❌ Error:`, error);
    monitor.stop();
  }

  console.log('\n✅ Test complete!');
}

main().catch(console.error); 