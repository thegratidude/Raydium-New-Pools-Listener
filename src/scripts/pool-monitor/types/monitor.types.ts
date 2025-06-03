import { PublicKey } from '@solana/web3.js';

/**
 * Represents a token in the pool with its current state
 */
export interface TokenState {
  address: PublicKey;
  symbol: string;
  amount: number;
  usdValue: number;
  lastUpdate: Date;
}

/**
 * Represents the current state of a pool's reserves
 */
export interface PoolReserves {
  tokenA: TokenState;
  tokenB: TokenState;
  totalLiquidity: number;  // in USD
  lastUpdate: Date;
}

/**
 * Represents a single trade in the pool
 */
export interface PoolTrade {
  timestamp: Date;
  tokenIn: {
    symbol: string;
    amount: number;
    usdValue: number;
  };
  tokenOut: {
    symbol: string;
    amount: number;
    usdValue: number;
  };
  priceImpact: number;
  type: 'buy' | 'sell';
}

/**
 * Represents the trading activity in a time window
 */
export interface TradeActivity {
  trades: PoolTrade[];
  volume: number;  // in USD
  tradeCount: number;
  averagePriceImpact: number;
  timeWindow: number;  // in seconds
  lastUpdate: Date;
}

/**
 * Represents the current price state of the pool
 */
export interface PriceState {
  currentPrice: number;
  priceChange24h: number;
  priceChange1h: number;
  high24h: number;
  low24h: number;
  lastUpdate: Date;
}

/**
 * Represents the complete state of a monitored pool
 */
export interface PoolMonitorState {
  poolAddress: PublicKey;
  reserves: PoolReserves;
  trades: TradeActivity;
  price: PriceState;
  lastUpdate: Date;
}

/**
 * Configuration for monitoring a pool
 */
export interface MonitorConfig {
  poolAddress: PublicKey;
  updateInterval: number;  // in milliseconds
  tradeWindow: number;    // in seconds
  priceAlertThreshold: number;  // percentage
  liquidityAlertThreshold: number;  // percentage
  volumeAlertThreshold: number;  // in USD
}

/**
 * Alert types for pool monitoring
 */
export type AlertType = 
  | 'LIQUIDITY_CHANGE'
  | 'PRICE_MOVEMENT'
  | 'VOLUME_SPIKE'
  | 'TRADE_ANOMALY'
  | 'EXIT_SIGNAL';

/**
 * Represents an alert from the monitor
 */
export interface MonitorAlert {
  type: AlertType;
  poolAddress: PublicKey;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: Date;
  data: {
    currentValue: number;
    threshold: number;
    change?: number;
  };
}

/**
 * Callback types for monitor events
 */
export type ReserveUpdateCallback = (reserves: PoolReserves) => void;
export type TradeUpdateCallback = (trades: TradeActivity) => void;
export type PriceUpdateCallback = (price: PriceState) => void;
export type AlertCallback = (alert: MonitorAlert) => void;

/**
 * Options for creating a pool monitor
 */
export interface PoolMonitorOptions {
  connection: any;  // Solana connection
  config: MonitorConfig;
  onReserveUpdate?: ReserveUpdateCallback;
  onTradeUpdate?: TradeUpdateCallback;
  onPriceUpdate?: PriceUpdateCallback;
  onAlert?: AlertCallback;
} 