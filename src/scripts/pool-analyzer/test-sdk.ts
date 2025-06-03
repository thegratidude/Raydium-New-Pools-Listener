import { Connection } from '@solana/web3.js';
import { Api, PoolFetchType } from '@raydium-io/raydium-sdk-v2';
import * as dotenv from 'dotenv';

dotenv.config();

async function testSdk() {
  if (!process.env.HTTP_URL) {
    throw new Error('HTTP_URL must be defined in .env file');
  }

  const connection = new Connection(process.env.HTTP_URL);
  
  // Create Api instance with minimal props
  const api = new Api({
    cluster: 'mainnet',
    timeout: 30000,
  });
  
  // BONK and USDC mint addresses
  const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  
  console.log('\nTesting Raydium SDK...');
  console.log('Searching for BONK/USDC pools...');
  
  try {
    // Search for pools with these mints
    const pools = await api.fetchPoolByMints({
      mint1: BONK_MINT,
      mint2: USDC_MINT,
      type: PoolFetchType.Standard, // Search Standard pools
      sort: 'liquidity',
      order: 'desc'
    });
    
    console.log('\nFound pools:', pools.length);
    if (pools.length > 0) {
      console.log('\nPool IDs:');
      pools.forEach((pool, i) => {
        console.log(`${i + 1}. ${pool.id} (${pool.type})`);
      });
      
      // Show details of the first pool
      const firstPool = pools[0];
      console.log('\nFirst Pool Details:');
      console.log('-------------------');
      console.log('Type:', firstPool.type);
      console.log('ID:', firstPool.id);
      console.log('Token A:', firstPool.mintA.symbol);
      console.log('Token B:', firstPool.mintB.symbol);
      console.log('TVL:', firstPool.tvl);
      console.log('24h Volume:', firstPool.day?.volume);
    }
  } catch (error) {
    console.error('Error testing SDK:', error);
  }
}

testSdk().catch(console.error); 