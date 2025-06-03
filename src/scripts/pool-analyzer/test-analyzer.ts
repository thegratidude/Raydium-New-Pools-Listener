import { analyzePool } from './analyzer';

async function testAnalyzer() {
  // Test pool address (new pool)
  const poolAddress = "YqnLQWNFWN72RLfVnZXDqZrUTxtEjdTsb86MVKKx3yd";
  
  console.log('\nTesting Pool Analyzer...');
  console.log('Pool Address:', poolAddress);
  
  try {
    const analysis = await analyzePool(poolAddress);
    console.log('\nAnalysis Results:');
    console.log('----------------');
    console.log(`Token A: ${analysis.tokenA.symbol} (${analysis.tokenA.address})`);
    console.log(`Amount A: ${analysis.tokenA.amount.toLocaleString()}`);
    console.log(`Token B: ${analysis.tokenB.symbol} (${analysis.tokenB.address})`);
    console.log(`Amount B: ${analysis.tokenB.amount.toLocaleString()}`);
    console.log(`Price: $${analysis.price.toFixed(8)}`);
    console.log(`TVL: $${analysis.tvl.toLocaleString()}`);
    console.log(`24h Volume: $${analysis.volume24h.toLocaleString()}`);
    console.log(`Fee Rate: ${(analysis.feeRate * 100).toFixed(2)}%`);
    console.log(`Viable: ${analysis.isViable ? 'Yes' : 'No'}`);
    if (analysis.reason) {
      console.log(`Reason: ${analysis.reason}`);
    }
  } catch (error) {
    console.error('Error testing analyzer:', error);
  }
}

testAnalyzer().catch(console.error); 