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