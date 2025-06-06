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
  priceImpact: number;
  isViable: boolean;
  reason?: string;
}

/**
 * Analyzes a Raydium pool for trading viability.
 * Thresholds are optimized for small trades (≤1 SOL):
 * - TVL > $45K (lower than common $50K to catch edge cases)
 * - 24h Volume > $5K (suitable for new pools)
 * - Price Impact < 2% for 1 SOL trade
 */
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
    
    // Check if we got valid pool data
    if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
      throw new Error('Pool not found or not yet indexed');
    }

    const pool = poolInfo[0];
    
    // Validate required pool data
    if (!pool.mintA || !pool.mintB) {
      throw new Error('Pool token data not available');
    }

    // Extract pool data
    const tokenA = {
      symbol: pool.mintA.symbol || 'Unknown',
      address: pool.mintA.address,
      amount: pool.mintAmountA || 0
    };
    
    const tokenB = {
      symbol: pool.mintB.symbol || 'Unknown',
      address: pool.mintB.address,
      amount: pool.mintAmountB || 0
    };

    // Get pool metrics
    const tvl = pool.tvl || 0;
    const volume24h = pool.day?.volume || 0;
    const feeRate = pool.feeRate || 0;
    const price = pool.price || 0;

    // Calculate price impact for 1 SOL worth of tokens
    // First determine which token is SOL/WSOL
    const isTokenASol = tokenA.symbol === 'WSOL' || tokenA.symbol === 'SOL';
    const isTokenBSol = tokenB.symbol === 'WSOL' || tokenB.symbol === 'SOL';
    
    let solAmount: number;
    let otherTokenAmount: number;
    let isSolTokenA: boolean;

    if (isTokenASol) {
      solAmount = tokenA.amount;
      otherTokenAmount = tokenB.amount;
      isSolTokenA = true;
    } else if (isTokenBSol) {
      solAmount = tokenB.amount;
      otherTokenAmount = tokenA.amount;
      isSolTokenA = false;
    } else {
      // If neither token is SOL, we can't calculate price impact
      throw new Error('Pool does not contain SOL/WSOL');
    }

    // Calculate price impact for 1 SOL
    // Using constant product formula: (x * y = k)
    // Impact = (1 / (solAmount + 1)) * 100
    const priceImpact = (1 / (solAmount + 1)) * 100;
    
    // A pool is viable if:
    // 1. TVL > $45k (optimized for small trades, catching edge cases below common $50k threshold)
    // 2. 24h volume > $5k (suitable for new pools)
    // 3. Price impact < 2% for 1 SOL trade
    const isViable = tvl > 45000 && volume24h > 5000 && priceImpact < 2;
    
    return {
      poolAddress,
      tokenA,
      tokenB,
      price,
      tvl,
      volume24h,
      feeRate,
      priceImpact,
      isViable,
      reason: isViable ? undefined : 
        tvl <= 45000 ? 'TVL too low (needs >$45K for small trades)' :
        volume24h <= 5000 ? '24h volume too low (needs >$5K for new pools)' :
        priceImpact >= 2 ? 'Price impact too high (needs <2% for 1 SOL trade)' : undefined
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to analyze pool: ${error.message}`);
    }
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