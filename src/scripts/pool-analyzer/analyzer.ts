import { Connection } from '@solana/web3.js';
import { Api } from '@raydium-io/raydium-sdk-v2';
import * as dotenv from 'dotenv';

dotenv.config();

export interface PoolAnalysis {
  poolAddress: string;
  tokenA: {
    symbol: string;
    address: string;
    amount: number;
  };
  tokenB: {
    symbol: string;
    address: string;
    amount: number;
  };
  price: number;
  tvl: number;
  volume24h: number;
  feeRate: number;
  isViable: boolean;
  reason?: string;
}

export async function analyzePool(poolAddress: string): Promise<PoolAnalysis> {
  if (!process.env.HTTP_URL) {
    throw new Error('HTTP_URL must be defined in .env file');
  }

  const connection = new Connection(process.env.HTTP_URL);
  
  // Create Api instance with required props
  const api = new Api({
    cluster: 'mainnet',
    timeout: 30000,
  });
  
  try {
    const poolInfo = await api.fetchPoolById({ ids: poolAddress });
    
    if (!Array.isArray(poolInfo) || poolInfo.length === 0) {
      return {
        poolAddress,
        tokenA: { symbol: '', address: '', amount: 0 },
        tokenB: { symbol: '', address: '', amount: 0 },
        price: 0,
        tvl: 0,
        volume24h: 0,
        feeRate: 0,
        isViable: false,
        reason: 'Pool not found'
      };
    }

    const pool = poolInfo[0];
    
    // Extract pool data
    const tokenA = {
      symbol: pool.mintA.symbol,
      address: pool.mintA.address,
      amount: pool.mintAmountA
    };
    
    const tokenB = {
      symbol: pool.mintB.symbol,
      address: pool.mintB.address,
      amount: pool.mintAmountB
    };

    // Calculate viability based on:
    // 1. TVL > $100k
    // 2. 24h volume > $10k
    // 3. Price impact < 1% for $1k trade
    const tvl = pool.tvl;
    const volume24h = pool.day.volume;
    const feeRate = pool.feeRate;
    
    // Calculate price impact for $1k trade
    // This is a simplified calculation - in reality you'd need to use the actual AMM formula
    const priceImpact = (1000 / tvl) * 100; // Simple percentage of TVL
    
    const isViable = tvl > 100000 && volume24h > 10000 && priceImpact < 1;
    
    return {
      poolAddress,
      tokenA,
      tokenB,
      price: pool.price,
      tvl,
      volume24h,
      feeRate,
      isViable,
      reason: isViable ? undefined : 
        tvl <= 100000 ? 'TVL too low' :
        volume24h <= 10000 ? '24h volume too low' :
        priceImpact >= 1 ? 'Price impact too high' : undefined
    };
  } catch (error) {
    console.error('Error analyzing pool:', error);
    throw error;
  }
}

// Example usage:
// const analysis = await analyzePool("pool_address_here");
// if (analysis) {
//   console.log(`Pool ${analysis.poolAddress} has:`);
//   console.log(`Token A (${analysis.tokenA.symbol}): ${analysis.tokenA.amount}`);
//   console.log(`Token B (${analysis.tokenB.symbol}): ${analysis.tokenB.amount}`);
//   console.log(`Price: ${analysis.price}`);
//   console.log(`TVL: ${analysis.tvl}`);
//   console.log(`24h Volume: ${analysis.volume24h}`);
//   console.log(`Fee Rate: ${analysis.feeRate}`);
//   console.log(`Viable: ${analysis.isViable}`);
//   if (analysis.reason) {
//     console.log(`Reason: ${analysis.reason}`);
//   }
// } 