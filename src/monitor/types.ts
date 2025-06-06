import { PublicKey } from '@solana/web3.js';

export enum TrendDirection {
  Up = 'up',
  Down = 'down',
  Sideways = 'sideways'
}

// PoolSnapshot: represents a single point-in-time state of a pool
export interface PoolSnapshot {
  poolId: string;
  timestamp: number;
  slot: number;
  baseReserve: number;
  quoteReserve: number;
  price: number;
  priceChange: number;
  tvl: number;
  marketCap: number;
  volumeChange: number;
  volume24h: number; // 24h volume in USD
  suspicious: boolean;
}

// MarketPressure: analytics for buy/sell pressure, rug risk, and trend
export interface MarketPressure {
  buyPressure: number;    // 0-100 scale
  sellPressure: number;   // 0-100 scale
  rugRisk: number;        // 0-100 scale
  trend: TrendDirection;
  value: number;          // Combined pressure value
  direction: 'up' | 'down' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
}

// PoolDiscoveryResult: for integration with listener
type PoolDiscoveryResult = {
  poolId: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  isViable: boolean;
};

export type { PoolDiscoveryResult };

export interface TokenInfo {
  symbol: string;
  decimals: number;
  mint: string;
}

export interface PoolInfo {
  poolId: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  isViable: boolean;
}

// Common token mints
export const MINT_TO_TOKEN: Record<string, TokenInfo> = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9, mint: 'So11111111111111111111111111111111111111112' },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  // Add more common tokens as needed
};

// Update callback type
export type PoolUpdateCallback = (
  snapshot: PoolSnapshot,
  pressure: MarketPressure,
  originPrice: number | null,
  originBaseReserve: number | null,
  originQuoteReserve: number | null,
  previousSnapshot: PoolSnapshot | null,
  poolId: string
) => void;

// Default update callback
export function conciseOnUpdate(
  snapshot: PoolSnapshot,
  pressure: MarketPressure,
  baseToken: TokenInfo,
  quoteToken: TokenInfo,
  originPrice: number | null,
  originBaseReserve: number | null,
  originQuoteReserve: number | null,
  previousSnapshot: PoolSnapshot | null,
  poolId: string
) {
  const priceChange = previousSnapshot ? ((snapshot.price - previousSnapshot.price) / previousSnapshot.price) * 100 : 0;
  const volumeChange = snapshot.volumeChange;
  const tvl = snapshot.tvl;
  
  console.log(
    `📊 ${baseToken.symbol}/${quoteToken.symbol} | ` +
    `Price: $${snapshot.price.toFixed(8)} (${priceChange.toFixed(2)}%) | ` +
    `Vol: $${volumeChange.toLocaleString()} | ` +
    `TVL: $${tvl.toLocaleString()} | ` +
    `Pressure: ${pressure.value.toFixed(2)} (${pressure.direction} - ${pressure.strength}) | ` +
    `Buy: ${pressure.buyPressure} | Sell: ${pressure.sellPressure} | Rug: ${pressure.rugRisk} | Trend: ${pressure.trend}`
  );
} 