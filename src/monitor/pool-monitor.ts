import { Connection, PublicKey } from '@solana/web3.js';
import { Api } from '@raydium-io/raydium-sdk-v2';
import { PoolMonitorManager } from './pool-monitor-manager';
import { MarketPressure, TrendDirection, PoolSnapshot } from './types';
import { DecimalHandler, ReserveMath } from './utils';
import BN from 'bn.js';
import { insertPoolHistory } from './pool-history-db';

interface TokenInfo {
  symbol: string;
  decimals: number;
  mint: string;
}

export class PoolMonitor {
  private api: Api;
  private lastUpdate: number = 0;
  private updateInterval: number;
  private isRunning: boolean = false;
  private onUpdateCallback: ((snapshot: PoolSnapshot) => void) | null = null;
  private tokenA: TokenInfo;
  private tokenB: TokenInfo;
  private onUpdate: (snapshot: PoolSnapshot, pressure: MarketPressure, originPrice: number | null, originBaseReserve: number | null, originQuoteReserve: number | null, prevSnapshot: PoolSnapshot | null) => void;
  private readonly HISTORY_LENGTH: number;
  private subscriptionId: number | null = null;
  private dbWriteTimer: NodeJS.Timeout | null = null;
  private prevSnapshot: PoolSnapshot | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly poolId: string,
    private readonly baseMint: string,
    private readonly quoteMint: string,
    private readonly manager: PoolMonitorManager,
    updateInterval: number = 1000 // 1 second default
  ) {
    this.tokenA = { symbol: '', decimals: 0, mint: baseMint };
    this.tokenB = { symbol: '', decimals: 0, mint: quoteMint };
    this.onUpdate = (snapshot: PoolSnapshot, pressure: MarketPressure, originPrice: number | null, originBaseReserve: number | null, originQuoteReserve: number | null, prevSnapshot: PoolSnapshot | null) => {};
    this.HISTORY_LENGTH = 50;
    this.updateInterval = updateInterval;
    this.api = new Api({ cluster: 'mainnet', timeout: 30000 });
  }

  public setOnUpdate(callback: (snapshot: PoolSnapshot) => void): void {
    this.onUpdateCallback = callback;
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`Monitor for ${this.poolId} is already running`);
      return;
    }

    try {
      // Initialize market using Raydium SDK v2
      const poolInfo = await this.api.fetchPoolById({ ids: this.poolId });
      if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
        throw new Error(`Market info not found for ${this.poolId}`);
      }

      // Update token info with actual symbols and decimals
      if (poolInfo[0].mintA && poolInfo[0].mintB) {
        this.tokenA = {
          symbol: poolInfo[0].mintA.symbol || 'Unknown',
          decimals: poolInfo[0].mintA.decimals || 9,
          mint: this.baseMint
        };
        this.tokenB = {
          symbol: poolInfo[0].mintB.symbol || 'Unknown',
          decimals: poolInfo[0].mintB.decimals || 6,
          mint: this.quoteMint
        };
      }

      this.isRunning = true;
      this.lastUpdate = Date.now();
      this.scheduleNextUpdate();
      console.log(`Started monitoring ${this.poolId}`);
    } catch (error) {
      console.error(`Failed to start monitoring ${this.poolId}:`, error);
      this.manager.removePool(this.poolId);
    }
  }

  public stop(): void {
    this.isRunning = false;
    console.log(`Stopped monitoring ${this.poolId}`);
  }

  private scheduleNextUpdate(): void {
    if (!this.isRunning) return;

    setTimeout(async () => {
      if (!this.isRunning) return;

      try {
        const snapshot = await this.fetchSnapshot();
        if (this.onUpdateCallback) {
          this.onUpdateCallback(snapshot);
        }
      } catch (error) {
        console.error(`Error updating ${this.poolId}:`, error);
      }

      this.lastUpdate = Date.now();
      this.scheduleNextUpdate();
    }, this.updateInterval);
  }

  private async fetchSnapshot(): Promise<PoolSnapshot> {
    const poolInfo = await this.api.fetchPoolById({ ids: this.poolId });
    if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
      throw new Error(`Market info not found for ${this.poolId}`);
    }

    const pool = poolInfo[0];
    const price = pool.price || 0;
    const baseReserve = pool.mintAmountA || 0;
    const quoteReserve = pool.mintAmountB || 0;
    const tvl = pool.tvl || 0;
    const volume24h = pool.day?.volume || 0;

    // Calculate price change if we have a previous snapshot
    const priceChange = this.prevSnapshot ? ((price - this.prevSnapshot.price) / this.prevSnapshot.price) * 100 : 0;

    // Calculate market pressure based on recent trades
    const buyPressure = priceChange > 0 ? Math.min(100, 50 + priceChange * 10) : Math.max(0, 50 - Math.abs(priceChange) * 10);
    const sellPressure = priceChange < 0 ? Math.min(100, 50 + Math.abs(priceChange) * 10) : Math.max(0, 50 - priceChange * 10);
    const rugRisk = Math.abs(priceChange) > 20 ? 60 : 10;
    let trend: TrendDirection = TrendDirection.Sideways;
    if (priceChange > 0.1) trend = TrendDirection.Up;
    else if (priceChange < -0.1) trend = TrendDirection.Down;

    let direction: 'up' | 'down' | 'neutral' = 'neutral';
    if (priceChange > 0.1) direction = 'up';
    else if (priceChange < -0.1) direction = 'down';

    let strength: 'strong' | 'moderate' | 'weak' = 'moderate';
    if (Math.abs(priceChange) > 5) strength = 'strong';
    else if (Math.abs(priceChange) < 1) strength = 'weak';

    const value = (buyPressure - sellPressure) / 100;

    const pressure: MarketPressure = {
      buyPressure,
      sellPressure,
      rugRisk,
      trend,
      value,
      direction,
      strength
    };

    const snapshot: PoolSnapshot = {
      poolId: this.poolId,
      timestamp: Date.now(),
      slot: 0, // TODO: Get actual slot
      baseReserve,
      quoteReserve,
      price,
      priceChange,
      tvl,
      marketCap: 0, // TODO: Calculate market cap
      volumeChange: 0, // TODO: Calculate volume change
      volume24h,
      suspicious: false // TODO: Implement suspicious detection
    };

    this.prevSnapshot = snapshot;
    return snapshot;
  }
} 