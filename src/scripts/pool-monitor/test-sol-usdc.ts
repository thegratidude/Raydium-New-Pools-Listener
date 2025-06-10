import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import { TokenInfo } from '../../types/token';
import { PoolUpdate } from '../../types/market';
import { Api } from '@raydium-io/raydium-sdk-v2';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 SOL-USDC Pool Monitor Test');
  console.log('=============================');
  console.log('Testing with SOL-USDC pool (should show some activity)');
  console.log('Press Ctrl+C to stop\n');

  // Test with SOL-USDC pool
  const SOL_USDC_POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
  
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

  console.log(`🚀 Testing SOL-USDC pool`);
  console.log(`Pool ID: ${SOL_USDC_POOL}\n`);

  let lastBaseReserve: number | null = null;
  let lastQuoteReserve: number | null = null;
  let pollCount = 0;

  const api = new Api({ cluster: 'mainnet', timeout: 30000 });

  const interval = setInterval(async () => {
    try {
      pollCount++;
      const now = new Date().toLocaleTimeString();
      
      console.log(`\n🔄 Poll #${pollCount} at ${now}`);
      console.log(`📡 Calling Raydium API for pool ${SOL_USDC_POOL}...`);
      
      const poolInfo = await api.fetchPoolById({ ids: SOL_USDC_POOL });
      
      if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
        console.log(`❌ Pool not found or not indexed`);
        return;
      }

      const pool = poolInfo[0];
      console.log(`✅ Pool found`);
      
      if (!pool.mintA || !pool.mintB) {
        console.log(`❌ Missing mint data`);
        return;
      }

      const baseReserve = pool.mintAmountA || 0;
      const quoteReserve = pool.mintAmountB || 0;
      const currentPrice = quoteReserve / baseReserve;
      
      console.log(`📊 Raw Data:`);
      console.log(`   Base Reserve: ${baseReserve.toFixed(2)} ${tokenA.symbol}`);
      console.log(`   Quote Reserve: ${quoteReserve.toFixed(2)} ${tokenB.symbol}`);
      console.log(`   Current Price: $${currentPrice.toFixed(8)}`);
      
      if (lastBaseReserve !== null && lastQuoteReserve !== null) {
        const baseChange = ((baseReserve - lastBaseReserve) / lastBaseReserve) * 100;
        const quoteChange = ((quoteReserve - lastQuoteReserve) / lastQuoteReserve) * 100;
        const priceChange = ((currentPrice - (lastQuoteReserve / lastBaseReserve)) / (lastQuoteReserve / lastBaseReserve)) * 100;
        
        console.log(`📈 Changes from last poll:`);
        console.log(`   Base Reserve: ${baseChange.toFixed(8)}%`);
        console.log(`   Quote Reserve: ${quoteChange.toFixed(8)}%`);
        console.log(`   Price: ${priceChange.toFixed(8)}%`);
        
        if (baseChange !== 0 || quoteChange !== 0) {
          console.log(`🎯 CHANGES DETECTED!`);
        } else {
          console.log(`⏸️  No changes detected`);
        }
      } else {
        console.log(`📈 First reading - baseline set`);
      }
      
      lastBaseReserve = baseReserve;
      lastQuoteReserve = quoteReserve;
      
    } catch (error: any) {
      console.error(`❌ Error:`, error?.message || error);
    }
  }, 5000); // Poll every 5 seconds

  console.log(`⏱️  Monitoring for 60 seconds (12 polls)...`);
  console.log(`📊 Raw data will be shown every 5 seconds\n`);
  
  // Stop after 60 seconds
  setTimeout(() => {
    clearInterval(interval);
    console.log(`\n⏹️  Stopped monitoring`);
    console.log('\n✅ SOL-USDC test complete!');
  }, 60000);
}

main().catch(console.error); 