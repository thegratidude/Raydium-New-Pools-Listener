// Market pressure types with consistent snake_case naming for API compatibility
export interface MarketPressure {
  buy_pressure: number;
  sell_pressure: number;
  trend: 'up' | 'down' | 'neutral';
  rug_risk: number;
}

export interface PoolUpdate {
  pool_id: string;
  base_token: string;
  quote_token: string;
  base_reserve: number;
  quote_reserve: number;
  price: number;
  tvl: number;
  market_pressure: number;
  trade_count: number;
  reserve_change_percent: number;
  time_since_first_trade: number;
  has_trade_data: boolean;
  timestamp: number;
}

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

export interface PoolSnapshot {
  pool_id: string;
  timestamp: number;
  slot: number;
  base_reserve: number;
  quote_reserve: number;
  price: number;
  price_change: number;
  tvl: number;
  market_cap: number;
  volume_change: number;
  volume_24h: number; // 24h volume in USD
  suspicious: boolean;
  base_decimals: number;
  quote_decimals: number;
  buy_slippage: number;
  sell_slippage: number;
  reserve_ratio: number;        // Current reserve ratio (quote/base)
  initial_reserve_ratio: number; // Initial reserve ratio when monitoring started
  ratio_change: number;         // Percentage change in reserve ratio
}

// Type guard functions
export function isMarketPressure(obj: unknown): obj is MarketPressure {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'buy_pressure' in obj &&
    'sell_pressure' in obj &&
    'trend' in obj &&
    'rug_risk' in obj &&
    typeof (obj as MarketPressure).buy_pressure === 'number' &&
    typeof (obj as MarketPressure).sell_pressure === 'number' &&
    typeof (obj as MarketPressure).trend === 'string' &&
    typeof (obj as MarketPressure).rug_risk === 'number'
  );
}

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

// Helper function to convert numeric market pressure to structured format
export function createMarketPressure(pressure: number): MarketPressure {
  return {
    buy_pressure: pressure > 0 ? pressure : 0,
    sell_pressure: pressure < 0 ? -pressure : 0,
    trend: pressure > 0 ? 'up' : pressure < 0 ? 'down' : 'neutral',
    rug_risk: Math.abs(pressure) > 50 ? 1 : Math.abs(pressure) / 50
  };
} 