import { Connection, PublicKey } from '@solana/web3.js';
import {
  PoolMonitorOptions,
  PoolMonitorState,
  MonitorConfig,
  MonitorAlert,
  PoolReserves,
  TradeActivity,
  PriceState
} from './types/monitor.types';
import { Api } from '@raydium-io/raydium-sdk-v2';

/**
 * Real-time pool monitor for tracking liquidity, trades, and price movements
 */
export class PoolMonitor {
  private connection: Connection;
  private config: MonitorConfig;
  private state: PoolMonitorState | null = null;
  private isMonitoring: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private previousState: { [pool: string]: any } = {};
  private firstUpdate: { [pool: string]: boolean } = {};

  // Callbacks
  private onReserveUpdate?: (reserves: PoolReserves) => void;
  private onTradeUpdate?: (trades: TradeActivity) => void;
  private onPriceUpdate?: (price: PriceState) => void;
  private onAlert?: (alert: MonitorAlert) => void;

  constructor(options: PoolMonitorOptions) {
    this.connection = options.connection;
    this.config = options.config;
    this.onReserveUpdate = options.onReserveUpdate;
    this.onTradeUpdate = options.onTradeUpdate;
    this.onPriceUpdate = options.onPriceUpdate;
    this.onAlert = options.onAlert;
  }

  /**
   * Start monitoring the pool
   */
  public async start(): Promise<void> {
    if (this.isMonitoring) {
      console.log('Monitor is already running');
      return;
    }

    console.log(`Starting monitor for pool: ${this.config.poolAddress.toString()}`);
    this.isMonitoring = true;

    // Debug: indicate polling has started
    console.log(`Monitor polling started for pool: ${this.config.poolAddress.toString()}`);

    // Set update interval to 1 second
    this.config.updateInterval = 1000;
    this.firstUpdate[this.config.poolAddress.toString()] = true;
    this.previousState[this.config.poolAddress.toString()] = null;

    // Initial state fetch
    await this.updateState();

    // Start periodic updates
    this.updateInterval = setInterval(
      () => this.updateState(),
      this.config.updateInterval
    );

    // Subscribe to account changes
    this.subscribeToAccountChanges();
  }

  /**
   * Stop monitoring the pool
   */
  public stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    console.log(`Stopping monitor for pool: ${this.config.poolAddress.toString()}`);
    this.isMonitoring = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Unsubscribe from account changes
    this.unsubscribeFromAccountChanges();
  }

  /**
   * Get the current state of the monitored pool
   */
  public getState(): PoolMonitorState | null {
    return this.state;
  }

  /**
   * Update the monitor configuration
   */
  public updateConfig(newConfig: Partial<MonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Restart monitoring if interval changed
    if (newConfig.updateInterval && this.isMonitoring) {
      this.stop();
      this.start();
    }
  }

  /**
   * Update the complete pool state
   */
  private async updateState(): Promise<void> {
    try {
      const reserves = await this.updateReserves();
      const trades = await this.updateTrades();
      const price = await this.updatePrice();
      if (!reserves || !trades || !price) {
        console.warn(`⚠️  Incomplete data for pool: ${this.config.poolAddress.toString()}`);
        return;
      }

      // Analyzer logic for SOL/WSOL detection and viability
      const tokenA = reserves.tokenA;
      const tokenB = reserves.tokenB;
      const isTokenASol = tokenA.symbol === 'WSOL' || tokenA.symbol === 'SOL';
      const isTokenBSol = tokenB.symbol === 'WSOL' || tokenB.symbol === 'SOL';
      let solAmount: number, otherTokenAmount: number, isSolTokenA: boolean;
      let baseSymbol: string, quoteSymbol: string;
      if (isTokenASol) {
        solAmount = tokenA.amount;
        otherTokenAmount = tokenB.amount;
        isSolTokenA = true;
        baseSymbol = tokenA.symbol;
        quoteSymbol = tokenB.symbol;
      } else if (isTokenBSol) {
        solAmount = tokenB.amount;
        otherTokenAmount = tokenA.amount;
        isSolTokenA = false;
        baseSymbol = tokenB.symbol;
        quoteSymbol = tokenA.symbol;
      } else {
        console.warn(`⚠️  Pool does not contain SOL/WSOL: ${this.config.poolAddress.toString()}`);
        return;
      }

      // Defensive: skip if reserves are zero
      if (!solAmount || !otherTokenAmount || reserves.totalLiquidity === 0) {
        return;
      }

      // Calculate price impact for 1 SOL
      const priceImpact = (1 / (solAmount + 1)) * 100;
      // Viability logic
      const tvl = reserves.totalLiquidity;
      const volume24h = trades.volume;
      const isViable = tvl > 45000 && volume24h > 5000 && priceImpact < 2;

      // Only display monitoring results for viable pools
      if (!isViable) {
        return;
      }

      // Prepare output
      const poolKey = this.config.poolAddress.toString();
      const prev = this.previousState[poolKey];
      const first = this.firstUpdate[poolKey];
      this.previousState[poolKey] = { 
        priceChangePercent: price.priceChangePercent,
        tvl, 
        volume24h 
      };
      this.firstUpdate[poolKey] = false;

      if (first) {
        console.log(`\n════════════════════════════════════════════════════════════════════════════════`);
        console.log(`🪙 Pair: ${baseSymbol}/${quoteSymbol}`);
        console.log(`📈 Price Change: ${price.priceChangePercent.toFixed(2)}%`);
        console.log(`💎 TVL: $${tvl.toLocaleString()}`);
        console.log(`📊 Price Impact (1 ${baseSymbol}): ${priceImpact.toFixed(3)}%`);
        console.log(`════════════════════════════════════════════════════════════════════════════════\n`);
      } else {
        const priceDelta = price.priceChangePercent - (prev?.priceChangePercent || 0);
        const sign = (n: number) => n > 0 ? '+' : (n < 0 ? '-' : '');
        console.log(
          `📊 ${baseSymbol}/${quoteSymbol} | ` +
          `P: ${price.priceChangePercent.toFixed(2)}%${sign(priceDelta)} | ` +
          `TVL: $${tvl.toLocaleString()} | ` +
          `Impact: ${priceImpact.toFixed(2)}%`
        );
      }

      // Callbacks
      this.onReserveUpdate?.(reserves);
      this.onTradeUpdate?.(trades);
      this.onPriceUpdate?.(price);
      this.checkAlerts();
    } catch (error) {
      console.error('Error updating pool state:', error);
      this.emitAlert({
        type: 'TRADE_ANOMALY',
        poolAddress: this.config.poolAddress,
        message: 'Failed to update pool state',
        severity: 'warning',
        timestamp: new Date(),
        data: {
          currentValue: 0,
          threshold: 0
        }
      });
    }
  }

  /**
   * Update pool reserves
   */
  private async updateReserves(): Promise<PoolReserves | null> {
    try {
      const api = new Api({ cluster: 'mainnet', timeout: 30000 });
      const poolInfo = await api.fetchPoolById({ ids: this.config.poolAddress.toString() });
      if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
        throw new Error('Pool not found or not yet indexed');
      }
      const pool = poolInfo[0];
      if (!pool.mintA || !pool.mintB) {
        throw new Error('Pool token data not available');
      }
      return {
        tokenA: {
          address: new PublicKey(pool.mintA.address),
          symbol: pool.mintA.symbol || 'Unknown',
          amount: pool.mintAmountA || 0,
          usdValue: (pool.mintAmountA || 0) * (pool.price || 0),
          lastUpdate: new Date()
        },
        tokenB: {
          address: new PublicKey(pool.mintB.address),
          symbol: pool.mintB.symbol || 'Unknown',
          amount: pool.mintAmountB || 0,
          usdValue: (pool.mintAmountB || 0) * (pool.price ? 1 : 0),
          lastUpdate: new Date()
        },
        totalLiquidity: pool.tvl || 0,
        lastUpdate: new Date()
      };
    } catch (error: any) {
      if (error?.response?.status === 429 || (error?.message && error.message.includes('429'))) {
        console.warn('⚠️  Raydium API rate limited (429). Skipping this update.');
        // Optionally, add a short delay before next attempt
        await new Promise(resolve => setTimeout(resolve, 2000));
        return null;
      }
      // Only log concise error message
      console.error('Error fetching pool reserves:', error?.message || error);
      return null;
    }
  }

  /**
   * Update trade activity
   */
  private async updateTrades(): Promise<TradeActivity | null> {
    try {
      const api = new Api({ cluster: 'mainnet', timeout: 30000 });
      const poolInfo = await api.fetchPoolById({ ids: this.config.poolAddress.toString() });
      if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
        throw new Error('Pool not found or not yet indexed');
      }
      const pool = poolInfo[0];
      // Raydium SDK does not provide individual trades, so we use 24h volume and estimate trade count
      return {
        trades: [], // No individual trades available
        volume: pool.day?.volume || 0,
        tradeCount: 0, // Not available
        averagePriceImpact: 0, // Not available
        timeWindow: 86400, // 24h
        lastUpdate: new Date()
      };
    } catch (error: any) {
      if (error?.response?.status === 429 || (error?.message && error.message.includes('429'))) {
        console.warn('⚠️  Raydium API rate limited (429). Skipping this update.');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return null;
      }
      console.error('Error fetching pool trades:', error?.message || error);
      return null;
    }
  }

  /**
   * Update price state
   */
  private async updatePrice(): Promise<PriceState | null> {
    try {
      const api = new Api({ cluster: 'mainnet', timeout: 30000 });
      const poolInfo = await api.fetchPoolById({ ids: this.config.poolAddress.toString() });
      if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
        throw new Error('Pool not found or not yet indexed');
      }
      const pool = poolInfo[0];

      // Get current reserves
      const quoteReserve = pool.mintAmountB || 0;  // SOL
      const baseReserve = pool.mintAmountA || 0;   // Base token
      
      // Calculate current ratio
      const currentRatio = quoteReserve / baseReserve;
      
      // Get or set initial ratio
      const poolKey = this.config.poolAddress.toString();
      if (!this.previousState[poolKey]?.initialRatio) {
        this.previousState[poolKey] = {
          ...this.previousState[poolKey],
          initialRatio: currentRatio
        };
      }
      
      const initialRatio = this.previousState[poolKey].initialRatio;
      
      // Calculate % change
      const priceChangePercent = ((currentRatio / initialRatio) - 1) * 100;

      return {
        priceChangePercent,
        initialRatio,
        currentRatio,
        lastUpdate: new Date()
      };
    } catch (error: any) {
      if (error?.response?.status === 429) {
        console.warn('⚠️  Rate limited. Skipping update.');
        return null;
      }
      console.error('Error updating price:', error?.message || error);
      return null;
    }
  }

  /**
   * Subscribe to account changes
   */
  private subscribeToAccountChanges(): void {
    // TODO: Implement account subscription
  }

  /**
   * Unsubscribe from account changes
   */
  private unsubscribeFromAccountChanges(): void {
    // TODO: Implement account unsubscription
  }

  /**
   * Check for alerts based on current state
   */
  private checkAlerts(): void {
    if (!this.state) return;

    // TODO: Implement alert checks
  }

  /**
   * Emit an alert
   */
  private emitAlert(alert: MonitorAlert): void {
    this.onAlert?.(alert);
  }
} 