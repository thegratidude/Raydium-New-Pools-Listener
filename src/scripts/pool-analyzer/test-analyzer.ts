import { Connection, PublicKey } from '@solana/web3.js';
import { analyzePool } from './analyzer.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkPoolExistence(connection: Connection, poolAddress: string) {
  try {
    const accountInfo = await connection.getAccountInfo(new PublicKey(poolAddress));
    if (!accountInfo) {
      return { exists: false, reason: 'Account does not exist on-chain' };
    }
    return { exists: true, owner: accountInfo.owner.toBase58() };
  } catch (error) {
    return { exists: false, reason: `Error checking account: ${error instanceof Error ? error.message : error}` };
  }
}

async function testPoolAnalysis() {
  if (!process.env.HTTP_URL) {
    throw new Error('HTTP_URL must be defined in .env file');
  }

  const connection = new Connection(process.env.HTTP_URL);
  
  // Test both a new pool and a known good pool
  const pools = [
    {
      address: 'Ho913FqdVwrnnUFxTk96SdAPPyaGMH4RXXwxforbbYRB',
      name: 'New Pool'
    },
    {
      address: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2', // SOL/USDC pool
      name: 'Known Good Pool'
    }
  ];

  for (const pool of pools) {
    console.log(`\n🔍 Testing ${pool.name}:`);
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log(`Address: ${pool.address}`);
    
    // First check if the pool exists on-chain
    console.log('\n1️⃣ Checking on-chain existence...');
    const existenceCheck = await checkPoolExistence(connection, pool.address);
    if (existenceCheck.exists) {
      console.log('✅ Pool exists on-chain');
      console.log(`📝 Owner program: ${existenceCheck.owner}`);
    } else {
      console.log('❌ Pool not found on-chain');
      console.log(`Reason: ${existenceCheck.reason}`);
      continue; // Skip Raydium analysis if pool doesn't exist
    }

    // Then try Raydium analysis
    console.log('\n2️⃣ Attempting Raydium analysis...');
    try {
      const analysis = await analyzePool(pool.address);
      
      console.log('\n📊 Pool Analysis Results:');
      console.log('════════════════════════════════════════════════════════════════════════════════');
      console.log(`🪙 Pair: ${analysis.tokenA.symbol}/${analysis.tokenB.symbol}`);
      console.log(`💰 Price: $${analysis.price.toFixed(8)}`);
      console.log(`💎 TVL: $${analysis.tvl.toLocaleString()}`);
      console.log(`📈 24h Volume: $${analysis.volume24h.toLocaleString()}`);
      console.log(`💸 Fee Rate: ${(analysis.feeRate * 100).toFixed(2)}%`);
      console.log(`✅ Viable: ${analysis.isViable ? 'Yes' : 'No'}`);
      if (analysis.reason) {
        console.log(`⚠️  Reason: ${analysis.reason}`);
      }
    } catch (error) {
      console.error('❌ Raydium Analysis Error:', error instanceof Error ? error.message : error);
      
      // Additional error context
      if (error instanceof Error) {
        if (error.message.includes('not found or not yet indexed')) {
          console.log('\n💡 This likely means:');
          console.log('1. The pool exists on-chain (we confirmed this)');
          console.log('2. But Raydium\'s API hasn\'t indexed it yet');
          console.log('3. This is normal for new pools - try again in a few minutes');
        } else if (error.message.includes('token data not available')) {
          console.log('\n💡 This likely means:');
          console.log('1. The pool exists in Raydium\'s API');
          console.log('2. But some token data is missing');
          console.log('3. This could indicate an API issue or incomplete pool data');
        }
      }
    }
    
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log(`🔗 Explorer: https://explorer.solana.com/address/${pool.address}`);
    console.log('════════════════════════════════════════════════════════════════════════════════\n');
  }
}

// Run the test
testPoolAnalysis().catch(console.error); 