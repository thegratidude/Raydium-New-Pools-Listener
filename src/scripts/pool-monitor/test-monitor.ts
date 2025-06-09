import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import { TokenInfo } from '../../types/token';
import { PoolUpdate } from '../../types/market';
import { conciseOnUpdate } from './types/types';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const connection = new Connection(process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com');
  
  // Test with a known active Raydium pool
  const KNOWN_ACTIVE_POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'; // SOL/USDC pool
  
  console.log('🔍 Testing Active Pool Monitor with 1-Second Updates');
  console.log('====================================================');
  console.log('Monitoring SOL/USDC pool for 30 seconds');
  console.log('You should see concise updates every 10 seconds');
  console.log('Press Ctrl+C to stop\n');

  // Test with known active pool
  console.log('🧪 TESTING ACTIVE SOL/USDC POOL');
  console.log('─'.repeat(60));
  console.log(`Pool: ${KNOWN_ACTIVE_POOL} (SOL/USDC - should be indexed)`);
  
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

  const activeMonitor = new PoolMonitor({
    poolId: new PublicKey(KNOWN_ACTIVE_POOL),
    tokenA,
    tokenB,
    httpUrl: process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
    wssUrl: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
    onUpdate: (update: PoolUpdate) => {
      // Use the concise output format
      const { consoleOutput } = conciseOnUpdate(
        {
          poolId: update.pool_id,
          timestamp: update.timestamp,
          slot: 0,
          baseReserve: update.base_reserve,
          quoteReserve: update.quote_reserve,
          price: update.price,
          priceChange: 0,
          tvl: update.tvl,
          marketCap: 0,
          volumeChange: 0,
          volume24h: 0,
          suspicious: false,
          baseDecimals: 9,
          quoteDecimals: 6,
          buySlippage: 0,
          sellSlippage: 0,
          reserveRatio: update.quote_reserve / update.base_reserve,
          initialReserveRatio: update.quote_reserve / update.base_reserve,
          ratioChange: 0
        },
        {
          value: update.market_pressure,
          direction: 'up' as any,
          strength: Math.abs(update.market_pressure),
          buyPressure: update.market_pressure > 0 ? 50 + update.market_pressure : 50,
          sellPressure: update.market_pressure < 0 ? 50 + Math.abs(update.market_pressure) : 50,
          rugRisk: 0,
          trend: 'up' as any,
          severity: 'low'
        },
        tokenA,
        tokenB,
        update.price,
        update.base_reserve,
        update.quote_reserve,
        null,
        update.pool_id
      );
      
      console.log(`✅ ACTIVE POOL: ${consoleOutput}`);
    },
    isSimulation: false
  });

  try {
    await activeMonitor.start();
    
    // Monitor active pool for 30 seconds
    console.log(`⏱️  Monitoring active pool for 30 seconds...`);
    console.log(`📊 You should see updates every 10 seconds showing % changes in reserves`);
    console.log(`🚨 If any reserve changes are detected, you'll see immediate alerts\n`);
    
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    activeMonitor.stop();
    console.log(`⏹️  Stopped monitoring active pool`);
    
  } catch (error) {
    console.error(`❌ Error monitoring active pool:`, error);
    activeMonitor.stop();
  }

  console.log('\n🎯 Pool testing complete!');
  console.log('Summary:');
  console.log('- Active pools show real-time % changes every 10 seconds');
  console.log('- Reserve changes trigger immediate alerts');
  console.log('- Silent background monitoring for new pools');
}

main().catch(console.error); 