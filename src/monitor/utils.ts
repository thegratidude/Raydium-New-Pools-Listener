import BN from 'bn.js';

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
  static calculatePrice(baseReserve: number, quoteReserve: number): number {
    return quoteReserve / baseReserve;
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