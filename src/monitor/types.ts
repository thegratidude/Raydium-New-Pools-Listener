import { PublicKey } from '@solana/web3.js';
import { TokenInfo, TokenMap, isTokenInfo } from '../types/token';
import { PoolUpdate } from '../types/market';

// Re-export types for convenience
export { TokenInfo, TokenMap, isTokenInfo };

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
  baseDecimals: number;
  quoteDecimals: number;
  buySlippage: number;
  sellSlippage: number;
  reserveRatio: number;        // Current reserve ratio (quote/base)
  initialReserveRatio: number; // Initial reserve ratio when monitoring started
  ratioChange: number;         // Percentage change in reserve ratio
}

// MarketPressure: analytics for buy/sell pressure, rug risk, and trend
export type MarketPressure = {
  value: number;
  direction: TrendDirection;
  strength: number;
  buyPressure: number;
  sellPressure: number;
  rugRisk: number;
  trend: TrendDirection;
  severity: 'low' | 'medium' | 'high';
};

// PoolDiscoveryResult: for integration with listener
type PoolDiscoveryResult = {
  poolId: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  isViable: boolean;
};

export type { PoolDiscoveryResult };

export interface PoolInfo {
  poolId: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  isViable: boolean;
}

// Common token mints
export const MINT_TO_TOKEN: TokenMap = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9, mint: 'So11111111111111111111111111111111111111112' },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  // Add more common tokens as needed
};

export interface UpdateResult {
  consoleOutput: string;
  broadcastData: PoolBroadcastMessage;
}

export type PoolUpdateCallback = (
  snapshot: PoolSnapshot,
  pressure: MarketPressure,
  originPrice: number,
  originBaseReserve: number,
  originQuoteReserve: number,
  prevSnapshot: PoolSnapshot | null,
  poolId: string
) => UpdateResult;

export interface PoolBroadcastMessage {
  event: 'pool_update' | 'pool_ready';
  pool_id: string;
  timestamp: number;
  data: {
    price?: number;
    tvl?: number;
    market_pressure?: MarketPressure;
    base_token: string;
    quote_token: string;
    base_reserve?: number;
    quote_reserve?: number;
    trade_count?: number;
    reserve_change_percent?: number;
  };
}

export interface PoolReadyMessage {
  event: 'pool_ready';
  pool_id: string;
  timestamp: number;
  data: {
    base_token: string;
    quote_token: string;
    trade_count: number;
    reserve_change_percent: number;
  };
}

export const conciseOnUpdate = (
  snapshot: PoolSnapshot,
  pressure: MarketPressure,
  baseToken: TokenInfo,
  quoteToken: TokenInfo,
  originPrice: number | null,
  originBaseReserve: number | null,
  originQuoteReserve: number | null,
  prevSnapshot: PoolSnapshot | null,
  poolId: string
): { consoleOutput: string; broadcastData: PoolBroadcastMessage } => {
  const pair = `${baseToken.symbol}/${quoteToken.symbol}`;
  const priceChange = prevSnapshot ? ((snapshot.price - prevSnapshot.price) / prevSnapshot.price) * 100 : 0;
  
  // Format console output
  const consoleOutput = 
    `📊 ${pair} | ` +
    `Price: $${snapshot.price.toFixed(8)} (${priceChange.toFixed(2)}%) | ` +
    `Vol: $${snapshot.volume24h.toLocaleString()} | ` +
    `TVL: $${snapshot.tvl.toLocaleString()} | ` +
    `Pressure: ${pressure.buyPressure.toFixed(2)} (${pressure.trend} - ${pressure.rugRisk}) | ` +
    `Buy: ${pressure.buyPressure.toFixed(0)} | ` +
    `Sell: ${pressure.sellPressure.toFixed(0)} | ` +
    `Rug: ${pressure.rugRisk} | ` +
    `Trend: ${pressure.trend}`;

  // Format broadcast data
  const broadcastData: PoolBroadcastMessage = {
    event: 'pool_update',
    pool_id: poolId,
    timestamp: snapshot.timestamp,
    data: {
      price: snapshot.price,
      tvl: snapshot.tvl,
      market_pressure: {
        value: pressure.value,
        direction: pressure.direction,
        strength: pressure.strength,
        buyPressure: pressure.buyPressure,
        sellPressure: pressure.sellPressure,
        rugRisk: pressure.rugRisk,
        trend: pressure.trend,
        severity: pressure.severity
      },
      base_token: baseToken.symbol,
      quote_token: quoteToken.symbol,
      base_reserve: snapshot.baseReserve,
      quote_reserve: snapshot.quoteReserve
    }
  };

  return { consoleOutput, broadcastData };
};

// Type guard functions
export function isPoolUpdate(obj: unknown): obj is PoolUpdate {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'pool_id' in obj &&
    'price' in obj &&
    'tvl' in obj &&
    'market_pressure' in obj &&
    'base_token' in obj &&
    'quote_token' in obj &&
    'base_reserve' in obj &&
    'quote_reserve' in obj &&
    'has_trade_data' in obj
  );
}

export function isPoolBroadcastMessage(obj: unknown): obj is PoolBroadcastMessage {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'event' in obj &&
    'pool_id' in obj &&
    'timestamp' in obj &&
    'data' in obj &&
    typeof (obj as PoolBroadcastMessage).event === 'string' &&
    typeof (obj as PoolBroadcastMessage).pool_id === 'string' &&
    typeof (obj as PoolBroadcastMessage).timestamp === 'number' &&
    typeof (obj as PoolBroadcastMessage).data === 'object'
  );
} 