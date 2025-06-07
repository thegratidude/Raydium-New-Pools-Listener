import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { Api } from '@raydium-io/raydium-sdk-v2';
import { PoolMonitorManager } from './pool-monitor-manager';
import { PoolSnapshot, MarketPressure, TokenInfo, RaydiumPoolState, TrendDirection, PoolUpdateCallback } from './types';
import { decodeRaydiumPoolState } from './raydium-layout';

export class PoolMonitor {
  private api: Api;
  private lastUpdate: number = 0;
  private updateInterval: number;
  private isRunning: boolean = false;
  private onUpdateCallback: PoolUpdateCallback | null = null;
  private tokenA: TokenInfo;
  private tokenB: TokenInfo;
  private onUpdate: (snapshot: PoolSnapshot, pressure: MarketPressure, originPrice: number | null, originBaseReserve: number | null, originQuoteReserve: number | null, prevSnapshot: PoolSnapshot | null) => void;
  private readonly HISTORY_LENGTH: number = 50;
  private subscriptionId: number | null = null;
  private dbWriteTimer: NodeJS.Timeout | null = null;
  private prevSnapshot: PoolSnapshot | null = null;
  private poolHistory: PoolSnapshot[] = [];
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY = 5000; // 5 seconds

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
    this.updateInterval = updateInterval;
    this.api = new Api({ cluster: 'mainnet', timeout: 30000 });
  }

  public setOnUpdate(callback: PoolUpdateCallback): void {
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

    // Determine trend using TrendDirection enum
    let trend: TrendDirection = TrendDirection.Sideways;
    if (priceChange > 0.1) trend = TrendDirection.Up;
    else if (priceChange < -0.1) trend = TrendDirection.Down;

    // Create snapshot
    const snapshot: PoolSnapshot = {
      poolId: this.poolId,
      timestamp: Date.now(),
      slot: 0, // TODO: Get actual slot
      baseReserve,
      quoteReserve,
      price,
      priceChange,
      tvl,
      volume24h,
      marketCap: 0, // TODO: Implement market cap calculation
      volumeChange: 0, // TODO: Implement volume change calculation
      suspicious: false, // TODO: Implement suspicious detection
      poolState: undefined // TODO: Get pool state if needed
    };

    return snapshot;
  }

  private subscribeToAccountChanges(): void {
    if (this.subscriptionId !== null) {
      console.warn(`Already subscribed to pool ${this.poolId}`);
      return;
    }

    try {
      console.log(`Subscribing to account changes for pool ${this.poolId}`);
      
      this.subscriptionId = this.connection.onAccountChange(
        new PublicKey(this.poolId),
        async (accountInfo, context) => {
          try {
            if (!accountInfo || !accountInfo.data) {
              console.warn(`Received empty account data for pool ${this.poolId}`);
              return;
            }

            // Decode pool state
            const rawPoolState = decodeRaydiumPoolState(accountInfo.data);
            if (!rawPoolState) {
              console.warn(`Failed to decode pool state for ${this.poolId}`);
              return;
            }

            // Convert PublicKey fields to strings
            const poolState: RaydiumPoolState = {
              baseMint: rawPoolState.baseMint.toString(),
              quoteMint: rawPoolState.quoteMint.toString(),
              baseVault: rawPoolState.baseVault.toString(),
              quoteVault: rawPoolState.quoteVault.toString(),
              baseDecimal: rawPoolState.baseDecimal,
              quoteDecimal: rawPoolState.quoteDecimal
            };

            // Get vault balances with retry logic
            const reserves = await this.getReservesWithRetry(poolState);
            if (!reserves) {
              console.warn(`Failed to get reserves for pool ${this.poolId}`);
              return;
            }

            // Create snapshot
            const snapshot: PoolSnapshot = {
              poolId: this.poolId,
              timestamp: Date.now(),
              slot: context.slot,
              baseReserve: reserves.baseReserve,
              quoteReserve: reserves.quoteReserve,
              price: reserves.price,
              priceChange: this.prevSnapshot ? ((reserves.price - this.prevSnapshot.price) / this.prevSnapshot.price) * 100 : 0,
              tvl: reserves.baseReserve * reserves.price + reserves.quoteReserve,
              volume24h: 0,
              marketCap: 0,
              volumeChange: 0,
              suspicious: this.detectSuspiciousActivity(reserves),
              poolState
            };

            // Update history
            this.poolHistory.push(snapshot);
            if (this.poolHistory.length > this.HISTORY_LENGTH) {
              this.poolHistory.shift();
            }

            // Calculate market pressure
            const pressure = this.analyzeMarketPressure(snapshot);

            // Call update handler
            this.onUpdate(
              snapshot,
              pressure,
              this.prevSnapshot?.price || null,
              this.prevSnapshot?.baseReserve || null,
              this.prevSnapshot?.quoteReserve || null,
              this.prevSnapshot
            );

            // Update previous snapshot
            this.prevSnapshot = snapshot;

            // Reset reconnect attempts on successful update
            this.reconnectAttempts = 0;

            // Log update
            console.log(`📊 Pool ${this.poolId} update:
Price: ${reserves.price.toFixed(8)}
Base Reserve: ${reserves.baseReserve.toFixed(2)}
Quote Reserve: ${reserves.quoteReserve.toFixed(2)}
Price Change: ${snapshot.priceChange.toFixed(2)}%
Market Pressure: ${pressure.value.toFixed(2)} (${pressure.direction})
Strength: ${pressure.strength}
Severity: ${pressure.severity}`);

          } catch (error) {
            console.error(`Error handling account change for pool ${this.poolId}:`, error);
            this.handleConnectionError();
          }
        },
        'confirmed'
      );

      console.log(`Successfully subscribed to pool ${this.poolId} with ID ${this.subscriptionId}`);
    } catch (error) {
      console.error(`Failed to subscribe to account changes for pool ${this.poolId}:`, error);
      this.handleConnectionError();
    }
  }

  private async getReservesWithRetry(poolState: RaydiumPoolState, maxRetries: number = 3): Promise<{ baseReserve: number; quoteReserve: number; price: number } | null> {
    let attempts = 0;
    while (attempts < maxRetries) {
      try {
        const [baseVaultBalance, quoteVaultBalance] = await Promise.all([
          this.connection.getTokenAccountBalance(new PublicKey(poolState.baseVault)),
          this.connection.getTokenAccountBalance(new PublicKey(poolState.quoteVault))
        ]);

        if (!baseVaultBalance.value || !quoteVaultBalance.value) {
          throw new Error('Failed to fetch vault balances');
        }

        const baseReserve = baseVaultBalance.value.uiAmount || 0;
        const quoteReserve = quoteVaultBalance.value.uiAmount || 0;

        if (baseReserve === 0 || quoteReserve === 0) {
          throw new Error('Zero reserves detected');
        }

        const price = quoteReserve / baseReserve;
        if (!isFinite(price) || price <= 0) {
          throw new Error('Invalid price calculated');
        }

        return { baseReserve, quoteReserve, price };
      } catch (error) {
        attempts++;
        if (attempts >= maxRetries) {
          console.error(`Failed to get reserves after ${maxRetries} attempts:`, error);
          return null;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }
    return null;
  }

  private detectSuspiciousActivity(reserves: { baseReserve: number; quoteReserve: number; price: number }): boolean {
    if (!this.prevSnapshot) return false;

    // Check for massive price drop
    const priceDrop = ((this.prevSnapshot.price - reserves.price) / this.prevSnapshot.price) * 100;
    if (priceDrop > 80) return true;

    // Check for massive reserve changes
    const baseReserveChange = Math.abs((reserves.baseReserve - this.prevSnapshot.baseReserve) / this.prevSnapshot.baseReserve) * 100;
    const quoteReserveChange = Math.abs((reserves.quoteReserve - this.prevSnapshot.quoteReserve) / this.prevSnapshot.quoteReserve) * 100;
    
    if (baseReserveChange > 500 || quoteReserveChange > 500) return true;

    // Check for suspicious price levels
    if (reserves.price < 0.000001 || reserves.price > 1000000) return true;

    return false;
  }

  private unsubscribeFromAccountChanges(): void {
    if (this.subscriptionId === null) {
      console.warn(`Not subscribed to pool ${this.poolId}`);
      return;
    }

    try {
      console.log(`Unsubscribing from account changes for pool ${this.poolId}`);
      
      this.connection.removeAccountChangeListener(this.subscriptionId);
      this.subscriptionId = null;
    } catch (error) {
      console.error(`Failed to unsubscribe from account changes for pool ${this.poolId}:`, error);
    }
  }

  private handleConnectionError(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(`Max reconnection attempts reached for pool ${this.poolId}, will retry after cooldown`);
      // Reset attempts after a longer cooldown period
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.subscribeToAccountChanges();
      }, this.RECONNECT_DELAY * 10); // 10x normal delay for cooldown
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1), // Exponential backoff
      30000 // Max 30 second delay
    );
    
    console.warn(`Connection error for pool ${this.poolId}, attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}, retrying in ${delay/1000}s`);
    
    // Unsubscribe before reconnecting
    this.unsubscribeFromAccountChanges();
    
    // Attempt to reconnect after delay with exponential backoff
    setTimeout(() => {
      this.subscribeToAccountChanges();
    }, delay);
  }

  private analyzeMarketPressure(snapshot: PoolSnapshot): MarketPressure {
    if (this.poolHistory.length < 2) {
      return {
        value: 50,
        direction: TrendDirection.Sideways,
        strength: 0,
        severity: 'low',
        buyPressure: 50,
        sellPressure: 50,
        rugRisk: 0,
        trend: TrendDirection.Sideways
      };
    }

    const previous = this.poolHistory[this.poolHistory.length - 2];
    const priceChange = snapshot.priceChange;
    const reserveRatio = snapshot.baseReserve / snapshot.quoteReserve;
    const previousRatio = previous.baseReserve / previous.quoteReserve;

    // Calculate pressures
    let buyPressure = 50;
    let sellPressure = 50;

    if (priceChange > 0) {
      buyPressure = Math.min(100, 50 + (priceChange * 10));
      sellPressure = Math.max(0, 50 - (priceChange * 10));
    } else {
      sellPressure = Math.min(100, 50 + (Math.abs(priceChange) * 10));
      buyPressure = Math.max(0, 50 - (Math.abs(priceChange) * 10));
    }

    // Calculate rug risk
    const rugRisk = this.calculateRugRisk();

    // Determine trend
    const trend = this.determineTrend();

    // Calculate overall pressure
    const pressureValue = (buyPressure - sellPressure + 100) / 2;
    const direction = pressureValue > 60 ? TrendDirection.Up : 
                     pressureValue < 40 ? TrendDirection.Down : 
                     TrendDirection.Sideways;

    // Determine strength and severity
    const strength = Math.abs(pressureValue - 50);
    const severity = rugRisk > 70 ? 'high' : 
                    rugRisk > 40 ? 'medium' : 'low';

    return {
      value: pressureValue,
      direction,
      strength,
      severity,
      buyPressure,
      sellPressure,
      rugRisk,
      trend
    };
  }

  private calculateRugRisk(): number {
    if (this.poolHistory.length < 10) return 0;

    const recent = this.poolHistory.slice(-10);
    const oldest = recent[0];
    const newest = recent[recent.length - 1];

    // Check for massive price drop
    const priceDropPercent = ((oldest.price - newest.price) / oldest.price) * 100;
    if (priceDropPercent > 80) return 95;

    // Check for massive supply increase
    const baseReserveIncrease = ((newest.baseReserve - oldest.baseReserve) / oldest.baseReserve) * 100;
    if (baseReserveIncrease > 500) return 90;

    // Check for liquidity drain
    const liquidityChange = ((newest.tvl - oldest.tvl) / oldest.tvl) * 100;
    if (liquidityChange < -70) return 85;

    return Math.max(0, priceDropPercent + baseReserveIncrease * 0.2);
  }

  private determineTrend(): TrendDirection {
    if (this.poolHistory.length < 5) return TrendDirection.Sideways;

    const recent = this.poolHistory.slice(-5);
    const prices = recent.map(h => h.price);

    // Simple linear regression
    const n = prices.length;
    const sumX = n * (n - 1) / 2;
    const sumY = prices.reduce((a, b) => a + b, 0);
    const sumXY = prices.reduce((sum, price, i) => sum + i * price, 0);
    const sumX2 = n * (n - 1) * (2 * n - 1) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    if (slope > 0.001) return TrendDirection.Up;
    if (slope < -0.001) return TrendDirection.Down;
    return TrendDirection.Sideways;
  }
}