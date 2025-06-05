import { Api } from '@raydium-io/raydium-sdk-v2';
import * as dotenv from 'dotenv';

dotenv.config();

async function getReserves(poolAddress: string) {
  try {
    const api = new Api({ cluster: 'mainnet', timeout: 30000 });
    const poolInfo = await api.fetchPoolById({ ids: poolAddress });
    if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
      throw new Error('Pool not found or not yet indexed');
    }
    const pool = poolInfo[0];
    if (!pool.mintA || !pool.mintB) {
      throw new Error('Pool token data not available');
    }
    console.log('Reserves for pool:', poolAddress);
    console.log(`Token A: ${pool.mintA.symbol || 'Unknown'} | Amount: ${pool.mintAmountA}`);
    console.log(`Token B: ${pool.mintB.symbol || 'Unknown'} | Amount: ${pool.mintAmountB}`);
    console.log(`TVL: $${pool.tvl || 0}`);
  } catch (error: any) {
    if (error?.response?.status === 429 || (error?.message && error.message.includes('429'))) {
      console.warn('⚠️  Raydium API rate limited (429). Try again later.');
      return;
    }
    console.error('Error fetching reserves:', error?.message || error);
  }
}

// Example: SOL/USDC pool
const POOL_ADDRESS = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
getReserves(POOL_ADDRESS); 