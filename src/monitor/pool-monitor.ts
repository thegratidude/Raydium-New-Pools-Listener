import { Connection, PublicKey } from '@solana/web3.js';
import { PoolSnapshot, MarketPressure, TrendDirection } from './types';
import { DecimalHandler, ReserveMath } from './utils';
import BN from 'bn.js';
import { Api } from '@raydium-io/raydium-sdk-v2';
import { insertPoolHistory } from './pool-history-db';

interface TokenInfo {
  symbol: string;
  decimals: number;
  mint: string;
}

interface PoolMonitorOptions {
  poolId: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  httpUrl: string;
  wssUrl: string;
  onUpdate: (snapshot: PoolSnapshot, pressure: MarketPressure, originPrice: number | null, originBaseReserve: number | null, originQuoteReserve: number | null, prevSnapshot: PoolSnapshot | null) => void;
  historyLength?: number;
}

export class PoolMonitor {
  private connection: Connection;
  private poolId: string;
  private tokenA: TokenInfo;
  private tokenB: TokenInfo;
  private onUpdate: (snapshot: PoolSnapshot, pressure: MarketPressure, originPrice: number | null, originBaseReserve: number | null, originQuoteReserve: number | null, prevSnapshot: PoolSnapshot | null) => void;
  private history: PoolSnapshot[] = [];
  private readonly HISTORY_LENGTH: number;
  private subscriptionId: number | null = null;
  private firstSnapshotTimestamp: number | null = null;
  private originPrice: number | null = null;
  private originBaseReserve: number | null = null;
  private originQuoteReserve: number | null = null;
  private dbWriteTimer: NodeJS.Timeout | null = null;
  private prevSnapshot: PoolSnapshot | null = null;

  constructor(options: PoolMonitorOptions) {
    this.poolId = options.poolId;
    this.tokenA = options.tokenA;
    this.tokenB = options.tokenB;
    this.onUpdate = options.onUpdate;
    this.HISTORY_LENGTH = options.historyLength || 50;
    this.connection = new Connection(options.httpUrl, { wsEndpoint: options.wssUrl });
  }

  async start() {
    console.log(`[PoolMonitor] STARTED monitoring for pool: ${this.tokenA.symbol}/${this.tokenB.symbol} (${this.poolId})`);
    // Initial fetch for state
    const initialSnapshot = await this.getPoolSnapshot();
    if (initialSnapshot) {
      this.history.push(initialSnapshot);
      if (this.originPrice === null) {
        this.originPrice = initialSnapshot.price;
        this.originBaseReserve = initialSnapshot.baseReserve;
        this.originQuoteReserve = initialSnapshot.quoteReserve;
      }
      this.onUpdate(initialSnapshot, this.analyzeMarketPressure(initialSnapshot), this.originPrice, this.originBaseReserve, this.originQuoteReserve, null);
      this.prevSnapshot = initialSnapshot;
    }
    // Subscribe to state changes
    this.subscriptionId = this.connection.onAccountChange(
      new PublicKey(this.poolId),
      async (accountInfo, context) => {
        try {
          const snapshot = await this.processPoolUpdate(accountInfo.data, context.slot);
          if (snapshot) {
            if (this.originPrice === null) {
              this.originPrice = snapshot.price;
              this.originBaseReserve = snapshot.baseReserve;
              this.originQuoteReserve = snapshot.quoteReserve;
            }
            const pressure = this.analyzeMarketPressure(snapshot);
            this.onUpdate(snapshot, pressure, this.originPrice, this.originBaseReserve, this.originQuoteReserve, this.prevSnapshot);
            this.prevSnapshot = snapshot;
          }
        } catch (e) {
          console.error(`[PoolMonitor] Error processing update:`, e);
        }
      },
      'confirmed'
    );
  }

  async stop() {
    console.log(`[PoolMonitor] STOPPED monitoring for pool: ${this.tokenA.symbol}/${this.tokenB.symbol} (${this.poolId})`);
    if (this.subscriptionId !== null) {
      this.connection.removeAccountChangeListener(this.subscriptionId);
      this.subscriptionId = null;
    }
  }

  private async getPoolSnapshot(): Promise<PoolSnapshot | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(this.poolId));
      if (!accountInfo) return null;
      return this.processPoolUpdate(accountInfo.data, 0);
    } catch (e) {
      console.error(`[PoolMonitor] Error fetching initial state:`, e);
      return null;
    }
  }

  private async processPoolUpdate(data: Buffer, slot: number): Promise<PoolSnapshot | null> {
    // For now, assume Raydium V4 layout and fetch reserves from vaults
    // (In a full implementation, decode the pool state for vault addresses)
    // Here, we assume poolId is the state account and vaults are known
    // TODO: Replace with actual vault fetching logic
    const baseReserve = Math.random() * 10000 + 50000; // Simulated
    const quoteReserve = Math.random() * 10000 + 50000; // Simulated
    const price = ReserveMath.calculatePrice(baseReserve, quoteReserve);
    const previous = this.history[this.history.length - 1];
    const priceChange = previous ? ((price - previous.price) / previous.price) * 100 : 0;
    const tvl = quoteReserve * 2;
    const marketCap = price * 1000000; // Placeholder
    const volumeChange = previous ? Math.abs(baseReserve - previous.baseReserve) : 0;
    const suspicious = false; // Placeholder

    // Fetch 24h volume from Raydium SDK
    let volume24h = 0;
    try {
      const api = new Api({ cluster: 'mainnet', timeout: 30000 });
      const poolInfo = await api.fetchPoolById({ ids: this.poolId });
      if (Array.isArray(poolInfo) && poolInfo.length > 0 && poolInfo[0]) {
        volume24h = poolInfo[0].day?.volume || 0;
      }
    } catch (e) {
      // If Raydium API fails, leave volume24h as 0
    }

    const snapshot: PoolSnapshot = {
      poolId: this.poolId,
      timestamp: Date.now(),
      slot,
      baseReserve,
      quoteReserve,
      price,
      priceChange,
      tvl,
      marketCap,
      volumeChange,
      volume24h,
      suspicious,
    };
    this.history.push(snapshot);
    if (this.history.length > this.HISTORY_LENGTH) this.history.shift();

    return snapshot;
  }

  private analyzeMarketPressure(current: PoolSnapshot): MarketPressure {
    if (this.history.length < 2) {
      return { buyPressure: 50, sellPressure: 50, rugRisk: 0, trend: TrendDirection.Sideways };
    }
    const previous = this.history[this.history.length - 2];
    const priceChange = current.priceChange;
    let buyPressure = 50;
    let sellPressure = 50;
    if (priceChange > 0) {
      buyPressure = Math.min(100, 50 + priceChange * 10);
      sellPressure = Math.max(0, 50 - priceChange * 10);
    } else {
      sellPressure = Math.min(100, 50 + Math.abs(priceChange) * 10);
      buyPressure = Math.max(0, 50 - Math.abs(priceChange) * 10);
    }
    // Rug risk: placeholder logic
    const rugRisk = Math.abs(current.priceChange) > 20 ? 60 : 10;
    // Trend
    const trend = priceChange > 0.1 ? TrendDirection.Up : priceChange < -0.1 ? TrendDirection.Down : TrendDirection.Sideways;
    return { buyPressure, sellPressure, rugRisk, trend };
  }
} 