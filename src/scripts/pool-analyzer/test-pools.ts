import { Connection } from '@solana/web3.js';
import { analyzePool } from './analyzer.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function testPools() {
  if (!process.env.HTTP_URL) {
    throw new Error('HTTP_URL must be defined in .env file');
  }

  console.log('\n🔍 Testing Pool Analysis with Price Impact');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('Testing pools with different characteristics to verify price impact calculations');
  console.log('Price impact is calculated for 1 SOL trade using constant product formula');
  console.log('\nThresholds optimized for small trades (≤1 SOL):');
  console.log('• TVL > $45K (catching edge cases below common $50K threshold)');
  console.log('• 24h Volume > $5K (suitable for new pools)');
  console.log('• Price Impact < 2% for 1 SOL trade');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  // Update test pools with more variety
  const TEST_POOLS = [
    {
      address: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
      name: 'SOL/USDC (Major Pool)'
    },
    {
      address: 'HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ',
      name: 'BONK/SOL (Current Pool)'
    },
    {
      address: 'Ho913FqdVwrnnUFxTk96SdAPPyaGMH4RXXwxforbbYRB',
      name: 'Furby/WSOL (New Pool)'
    },
    {
      address: '7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX',
      name: 'BOME/SOL (Recent Meme)'
    }
  ];

  for (const pool of TEST_POOLS) {
    console.log(`\n📊 Testing ${pool.name}:`);
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log(`Address: ${pool.address}`);
    
    try {
      const analysis = await analyzePool(pool.address);
      
      console.log('\nPool Analysis Results:');
      console.log('════════════════════════════════════════════════════════════════════════════════');
      console.log(`🪙 Pair: ${analysis.tokenA.symbol}/${analysis.tokenB.symbol}`);
      console.log(`💰 Price: $${analysis.price.toFixed(8)}`);
      console.log(`💎 TVL: $${analysis.tvl.toLocaleString()}`);
      console.log(`📈 24h Volume: $${analysis.volume24h.toLocaleString()}`);
      console.log(`💸 Fee Rate: ${(analysis.feeRate * 100).toFixed(2)}%`);
      console.log(`📊 Price Impact (1 SOL): ${analysis.priceImpact.toFixed(4)}%`);
      console.log(`✅ Viable: ${analysis.isViable ? 'Yes' : 'No'}`);
      if (analysis.reason) {
        console.log(`⚠️  Reason: ${analysis.reason}`);
      }
      
      // Additional pool details
      console.log('\nPool Details:');
      console.log(`Token A (${analysis.tokenA.symbol}): ${analysis.tokenA.amount.toLocaleString()} tokens`);
      console.log(`Token B (${analysis.tokenB.symbol}): ${analysis.tokenB.amount.toLocaleString()} tokens`);
      
      console.log('════════════════════════════════════════════════════════════════════════════════');
      console.log(`🔗 Explorer: https://explorer.solana.com/address/${pool.address}`);
      console.log('════════════════════════════════════════════════════════════════════════════════\n');
    } catch (error) {
      console.error(`❌ Error analyzing ${pool.name}:`, error instanceof Error ? error.message : error);
      console.log('════════════════════════════════════════════════════════════════════════════════\n');
    }
  }
}

// Run the test
testPools().catch(console.error); 