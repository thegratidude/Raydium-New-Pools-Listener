import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './src/scripts/pool-monitor/monitor';
import { TokenInfo } from './src/types/token';
import * as dotenv from 'dotenv';

dotenv.config();

async function testPool() {
  const connection = new Connection(process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com');
  
  // Test one of the pools from the logs - using the first one
  const poolId = '2VWoZ8Lz56GphirUSsKdTesRVdghFv8Gtw75JHGfMBDS';
  const tokenAMint = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
  const tokenBMint = 'FjPAB3tz7pHPHVYn7HUmGcepodSNfdGXMhZs8395z3AR';
  
  // For testing, let's use the actual token info
  const tokenA: TokenInfo = {
    symbol: 'TOKEN_A',
    mint: tokenAMint,
    decimals: 9
  };
  
  const tokenB: TokenInfo = {
    symbol: 'TOKEN_B',
    mint: tokenBMint,
    decimals: 6
  };

  console.log(`🧪 Testing pool: ${poolId}`);
  console.log(`Token A: ${tokenA.symbol} (${tokenA.mint})`);
  console.log(`Token B: ${tokenB.symbol} (${tokenB.mint})`);
  console.log('Starting monitor for 30 seconds...\n');

  let updateCount = 0;
  
  const monitor = new PoolMonitor({
    poolId: new PublicKey(poolId),
    tokenA,
    tokenB,
    httpUrl: process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
    wssUrl: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
    onUpdate: (update) => {
      updateCount++;
      console.log(`🚨 ACTIVITY DETECTED! Update #${updateCount}:`);
      console.log(`  Pool: ${update.pool_id}`);
      console.log(`  Price: $${update.price.toFixed(8)}`);
      console.log(`  Base Reserve: ${update.base_reserve}`);
      console.log(`  Quote Reserve: ${update.quote_reserve}`);
      console.log(`  TVL: $${update.tvl.toFixed(2)}`);
      console.log(`  Trade Count: ${update.trade_count}`);
      console.log(`  Reserve Change: ${update.reserve_change_percent.toFixed(4)}%`);
      console.log(`  Time Since First Trade: ${update.time_since_first_trade}ms`);
      console.log('---');
    },
    isSimulation: false
  });

  // Add a manual API call to see what data we're getting
  console.log('🔍 Making manual Raydium API call to check pool data...');
  const { Api } = await import('@raydium-io/raydium-sdk-v2');
  const api = new Api({ cluster: 'mainnet', timeout: 30000 });
  
  try {
    const poolInfo = await api.fetchPoolById({ ids: poolId });
    console.log('📊 Raydium API Response:');
    console.log(JSON.stringify(poolInfo, null, 2));
  } catch (error) {
    console.log('❌ Raydium API Error:', error);
  }

  await monitor.start();

  // Run for 30 seconds
  setTimeout(async () => {
    console.log('\n⏰ Test complete after 30 seconds');
    console.log(`Total updates received: ${updateCount}`);
    console.log(`Silent mode: ${monitor.isInSilentMode()}`);
    console.log(`Has detected activity: ${monitor.getHasDetectedActivity()}`);
    
    monitor.stop();
    process.exit(0);
  }, 30000);
}

testPool().catch(console.error); 