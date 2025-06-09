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
  event: 'pool_update';
  pool_id: string;
  timestamp: number;
  data: {
    pair: string;
    price: number;
    price_change: number;
    tvl: number;
    volume_24h: number;
    market_pressure: {
      buy_pressure: number;
      sell_pressure: number;
      trend: string;
      rug_risk: number;
    };
    reserves: {
      base_reserve: number;
      quote_reserve: number;
      base_symbol: string;
      quote_symbol: string;
    };
    origin_data: {
      price: number;
      base_reserve: number;
      quote_reserve: number;
      timestamp: number;
    };
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
      pair,
      price: snapshot.price,
      price_change: priceChange,
      tvl: snapshot.tvl,
      volume_24h: snapshot.volume24h,
      market_pressure: {
        buy_pressure: pressure.buyPressure,
        sell_pressure: pressure.sellPressure,
        trend: pressure.trend,
        rug_risk: pressure.rugRisk
      },
      reserves: {
        base_reserve: snapshot.baseReserve,
        quote_reserve: snapshot.quoteReserve,
        base_symbol: baseToken.symbol,
        quote_symbol: quoteToken.symbol
      },
      origin_data: {
        price: originPrice,
        base_reserve: originBaseReserve,
        quote_reserve: originQuoteReserve,
        timestamp: snapshot.timestamp
      }
    }
  };

  return { consoleOutput, broadcastData };
}; 