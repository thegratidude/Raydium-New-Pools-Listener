import BN from 'bn.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { Api } from '@raydium-io/raydium-sdk-v2';

export class DecimalHandler {
  static toUIAmount(rawAmount: string | BN, decimals: number): number {
    const amount = typeof rawAmount === 'string' ? new BN(rawAmount) : rawAmount;
    return amount.toNumber() / Math.pow(10, decimals);
  }

  static toRawAmount(uiAmount: number, decimals: number): BN {
    return new BN(Math.floor(uiAmount * Math.pow(10, decimals)));
  }

  static formatPrice(price: number, decimals: number = 8): string {
    return price.toFixed(decimals);
  }
}

export class ReserveMath {
  private static async getTokenPriceInUsd(tokenMint: string, connection: Connection): Promise<number> {
    // For USDC, return 1
    if (tokenMint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
      return 1;
    }

    try {
      // Try to get price from Raydium API first
      const api = new Api({ cluster: 'mainnet', timeout: 30000 });
      const poolInfo = await api.fetchPoolById({ ids: tokenMint });
      if (Array.isArray(poolInfo) && poolInfo.length > 0 && poolInfo[0]) {
        return poolInfo[0].price || 0;
      }
    } catch (e) {
      console.error(`Failed to get price from Raydium API for ${tokenMint}:`, e);
    }

    // If Raydium API fails, try to find a USDC pool for this token
    try {
      const api = new Api({ cluster: 'mainnet', timeout: 30000 });
      // Use fetchPoolById with known USDC pools instead of fetchPools
      const usdcPools = [
        '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2', // SOL/USDC
        '6UmmUYo8wnKiq4r6vKqZQd6vXrPrqVJQQuXabKkLLU9U', // BONK/USDC
        '7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX', // RAY/USDC
        // Add more known USDC pools as needed
      ];
      
      for (const poolId of usdcPools) {
        const poolInfo = await api.fetchPoolById({ ids: poolId });
        if (Array.isArray(poolInfo) && poolInfo.length > 0 && poolInfo[0]) {
          const pool = poolInfo[0];
          if (pool.mintA && pool.mintB) {
            const isTokenA = pool.mintA.address === tokenMint;
            const isTokenB = pool.mintB.address === tokenMint;
            const isUsdcA = pool.mintA.address === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
            const isUsdcB = pool.mintB.address === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
            
            if ((isTokenA && isUsdcB) || (isTokenB && isUsdcA)) {
              return pool.price || 0;
            }
          }
        }
      }
    } catch (e) {
      console.error(`Failed to find USDC pool for ${tokenMint}:`, e);
    }

    return 0; // Return 0 if we can't find a price
  }

  static async calculatePrice(
    baseReserve: number,
    quoteReserve: number,
    baseMint: string,
    quoteMint: string,
    baseDecimals: number,
    quoteDecimals: number,
    connection: Connection
  ): Promise<number> {
    // Get the raw price ratio
    const rawPrice = quoteReserve / baseReserve;
    
    // Adjust for decimals
    const decimalAdjustedPrice = rawPrice * Math.pow(10, baseDecimals - quoteDecimals);
    
    // If quote token is USDC, we're done
    if (quoteMint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
      return decimalAdjustedPrice;
    }
    
    // Otherwise, get the quote token's USD price and multiply
    const quoteTokenUsdPrice = await this.getTokenPriceInUsd(quoteMint, connection);
    return decimalAdjustedPrice * quoteTokenUsdPrice;
  }

  static calculatePriceImpact(
    baseReserve: number,
    quoteReserve: number,
    tradeAmount: number,
    isBuy: boolean = true
  ): { newPrice: number; tokensReceived: number; priceImpact: number } {
    if (isBuy) {
      const tokensOut = (baseReserve * tradeAmount) / (quoteReserve + tradeAmount);
      const newBaseReserve = baseReserve - tokensOut;
      const newQuoteReserve = quoteReserve + tradeAmount;
      const newPrice = newQuoteReserve / newBaseReserve;
      const oldPrice = quoteReserve / baseReserve;
      const priceImpact = ((newPrice - oldPrice) / oldPrice) * 100;
      return { newPrice, tokensReceived: tokensOut, priceImpact };
    } else {
      const solOut = (quoteReserve * tradeAmount) / (baseReserve + tradeAmount);
      const newBaseReserve = baseReserve + tradeAmount;
      const newQuoteReserve = quoteReserve - solOut;
      const newPrice = newQuoteReserve / newBaseReserve;
      const oldPrice = quoteReserve / baseReserve;
      const priceImpact = ((newPrice - oldPrice) / oldPrice) * 100;
      return { newPrice, tokensReceived: solOut, priceImpact };
    }
  }

  static calculateSlippage(expectedPrice: number, actualPrice: number): number {
    return ((actualPrice - expectedPrice) / expectedPrice) * 100;
  }
}

// Simulate a round-trip trade: buy 1 base at origin, sell 1 base at current, including slippage and fee
export function simulateRoundTripTrade({
  originBase,
  originQuote,
  currentBase,
  currentQuote,
  tradeSize = 1,
  feeBps = 25, // 0.25% per trade
}: {
  originBase: number;
  originQuote: number;
  currentBase: number;
  currentQuote: number;
  tradeSize?: number;
  feeBps?: number;
}) {
  // Buy 1 base at origin
  const fee = (1 - feeBps / 10000);
  // AMM: x * y = k
  // To buy tradeSize base, need to solve for quoteIn:
  // (originBase - tradeSize) * (originQuote + quoteIn) = originBase * originQuote
  // => quoteIn = originQuote * tradeSize / (originBase - tradeSize)
  const quoteIn = originQuote * tradeSize / (originBase - tradeSize);
  const quoteInWithFee = quoteIn / fee;

  // Sell 1 base at current
  // tokensOut = currentQuote - (currentBase + tradeSize) * currentQuote / (currentBase)
  // But for AMM, selling tradeSize base:
  // newBase = currentBase + tradeSize
  // newQuote = k / newBase
  // quoteOut = currentQuote - newQuote
  const k = currentBase * currentQuote;
  const newBase = currentBase + tradeSize;
  const newQuote = k / newBase;
  const quoteOut = (currentQuote - newQuote) * fee;

  // Net profit in quote tokens
  const netProfit = quoteOut - quoteInWithFee;
  const profitPct = (netProfit / quoteInWithFee) * 100;
  return { netProfit, profitPct, quoteIn: quoteInWithFee, quoteOut };
} 