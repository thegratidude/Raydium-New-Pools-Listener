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
enum TrendDirection {
  Up = 'up',
  Down = 'down',
  Sideways = 'sideways',
}

export interface MarketPressure {
  buyPressure: number;    // 0-100 scale
  sellPressure: number;   // 0-100 scale
  rugRisk: number;        // 0-100 scale
  trend: TrendDirection;
}

// PoolDiscoveryResult: for integration with listener
type PoolDiscoveryResult = {
  poolId: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  isViable: boolean;
};

export { TrendDirection, PoolDiscoveryResult }; 