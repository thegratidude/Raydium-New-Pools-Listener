import { Connection, PublicKey } from '@solana/web3.js';
import {
  PoolMonitorOptions,
  PoolMonitorState,
  MonitorConfig,
  MonitorAlert,
  PoolReserves,
  TradeActivity,
  PriceState
} from '../pool-monitor/types/monitor.types';
import { Api } from '@raydium-io/raydium-sdk-v2';
import { analyzePool } from '../pool-analyzer/analyzer';
import { PoolMonitor as RealTimeMonitor } from '../pool-monitor/monitor';

// Constants
const RAYDIUM_PUBLIC_KEY = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

interface PoolStatus {
  poolAddress: string;
  tokenA: string;
  tokenB: string;
  firstSeen: Date;
  lastAttempt: Date;
  attempts: number;
  status: 'pending' | 'indexed' | 'failed';
  error?: string;
  realTimeMonitor?: RealTimeMonitor; // Add real-time monitor reference
}

class PoolMonitor {
  private pools: Map<string, PoolStatus> = new Map();
  private connection: Connection;
  private isRunning: boolean = false;
  private checkInterval: number = 60000; // 1 minute
  private maxAttempts: number = 30; // 30 minutes max

  constructor(connection: Connection) {
    this.connection = connection;
  }

  // Add a new pool to monitor
  async addPool(poolAddress: string, tokenA: string, tokenB: string) {
    if (this.pools.has(poolAddress)) {
      console.log(`Pool ${poolAddress} is already being monitored`);
      return;
    }

    console.log(`\n🆕 Adding new pool to monitor:`);
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log(`Address: ${poolAddress}`);
    console.log(`Pair: ${tokenA}/${tokenB}`);
    console.log(`Time: ${new Date().toISOString()}`);
    console.log('════════════════════════════════════════════════════════════════════════════════\n');

    this.pools.set(poolAddress, {
      poolAddress,
      tokenA,
      tokenB,
      firstSeen: new Date(),
      lastAttempt: new Date(),
      attempts: 0,
      status: 'pending'
    });

    // Start monitoring if not already running
    if (!this.isRunning) {
      this.startMonitoring();
    }
  }

  // Check if pool exists on-chain
  private async checkPoolExistence(poolAddress: string) {
    try {
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(poolAddress));
      if (!accountInfo) {
        return { exists: false, reason: 'Account does not exist on-chain' };
      }
      return { exists: true, owner: accountInfo.owner.toBase58() };
    } catch (error) {
      return { exists: false, reason: `Error checking account: ${error instanceof Error ? error.message : error}` };
    }
  }

  // Start real-time monitoring for an indexed pool
  private async startRealTimeMonitoring(pool: PoolStatus) {
    if (pool.status !== 'indexed' || pool.realTimeMonitor) {
      return;
    }

    const config: MonitorConfig = {
      poolAddress: new PublicKey(pool.poolAddress),
      updateInterval: 2000,  // 2 seconds
      tradeWindow: 60,      // 1 minute
      priceAlertThreshold: 2,    // 2% price change
      liquidityAlertThreshold: 5, // 5% liquidity change
      volumeAlertThreshold: 10000 // $10k volume spike
    };

    const realTimeMonitor = new RealTimeMonitor({
      connection: this.connection,
      config,
      onReserveUpdate: (reserves) => {
        console.log(
          `📊 ${pool.tokenA}/${pool.tokenB} | ` +
          `Base: ${this.formatChange(reserves.tokenA.amount, pool.lastAttempt)} | ` +
          `Vol: ${this.formatChange(reserves.totalLiquidity, pool.lastAttempt)} | ` +
          `Slippage(1${pool.tokenA}): ${((1 / reserves.tokenA.amount) * 100).toFixed(3)}% | ` +
          `TVL: $${reserves.totalLiquidity.toLocaleString(undefined, {maximumFractionDigits: 0})}`
        );
      },
      onTradeUpdate: (trades) => {
        const latestTrade = trades.trades[0];
        if (latestTrade) {
          const tradeEmoji = latestTrade.type === 'buy' ? '🟢' : '🔴';
          const tradeType = latestTrade.type === 'buy' ? 'BUY' : 'SELL';
          console.log(
            `💱 ${tradeEmoji} ${tradeType} | ` +
            `${latestTrade.tokenIn.amount.toLocaleString(undefined, {maximumFractionDigits: 2})} ${latestTrade.tokenIn.symbol} → ` +
            `${latestTrade.tokenOut.amount.toLocaleString(undefined, {maximumFractionDigits: 4})} ${latestTrade.tokenOut.symbol} | ` +
            `Impact: ${latestTrade.priceImpact.toFixed(3)}%`
          );
        }
        console.log(
          `🔄 Swaps: ${trades.tradeCount} | ` +
          `Vol: $${trades.volume.toLocaleString(undefined, {maximumFractionDigits: 0})} | ` +
          `Avg Impact: ${trades.averagePriceImpact.toFixed(3)}%`
        );
      },
      onAlert: (alert) => {
        const severityEmoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`${severityEmoji} ${alert.type}: ${alert.message}`);
      }
    });

    try {
      await realTimeMonitor.start();
      pool.realTimeMonitor = realTimeMonitor;
      console.log(`\n✅ Started real-time monitoring for ${pool.tokenA}/${pool.tokenB} pool`);
    } catch (error) {
      console.error(`Failed to start real-time monitoring for ${pool.poolAddress}:`, error);
    }
  }

  // Helper to format percentage changes
  private formatChange(current: number, previousTime: Date): string {
    // Store previous values in a separate map
    const previousValues = new Map<string, number>();
    const key = previousTime.toISOString();
    const previous = previousValues.get(key) || current;
    previousValues.set(key, current);
    
    const change = ((current - previous) / previous) * 100;
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}%`;
  }

  // Monitor all pending pools
  private async startMonitoring() {
    this.isRunning = true;
    
    while (this.isRunning && this.pools.size > 0) {
      const pendingPools = Array.from(this.pools.values())
        .filter(pool => pool.status === 'pending');
      
      if (pendingPools.length === 0) {
        // No pending pools, stop monitoring
        this.isRunning = false;
        break;
      }

      console.log(`\n⏰ Checking ${pendingPools.length} pending pools...`);
      
      for (const pool of pendingPools) {
        const now = new Date();
        const timeSinceLastAttempt = now.getTime() - pool.lastAttempt.getTime();
        
        // Only check if enough time has passed
        if (timeSinceLastAttempt < this.checkInterval) {
          continue;
        }

        pool.lastAttempt = now;
        pool.attempts++;

        console.log(`\n🔍 Checking pool ${pool.poolAddress} (Attempt ${pool.attempts}/${this.maxAttempts})`);
        console.log(`⏱️  Time since first seen: ${this.formatDuration(now.getTime() - pool.firstSeen.getTime())}`);

        // Check if pool exists
        const { exists, reason } = await this.checkPoolExistence(pool.poolAddress);
        
        if (!exists) {
          if (pool.attempts >= this.maxAttempts) {
            pool.status = 'failed';
            pool.error = reason;
            console.log(`❌ Pool not found after ${this.maxAttempts} attempts: ${reason}`);
          }
          continue;
        }

        // Pool exists, try to analyze it
        try {
          const analysis = await analyzePool(pool.poolAddress);
          if (analysis) {
            pool.status = 'indexed';
            console.log(`✅ Pool indexed successfully!`);
            console.log(`Pair: ${pool.tokenA}/${pool.tokenB}`);
            console.log(`Price: $${analysis.price.toFixed(8)}`);
            console.log(`TVL: $${analysis.tvl.toLocaleString()}`);
            console.log(`24h Volume: $${analysis.volume24h.toLocaleString()}`);
            console.log(`Fee Rate: ${analysis.feeRate}%`);
            console.log(`Viable: ${analysis.isViable ? '✅' : '❌'}`);

            // Start real-time monitoring for indexed pool
            await this.startRealTimeMonitoring(pool);
          }
        } catch (error) {
          if (pool.attempts >= this.maxAttempts) {
            pool.status = 'failed';
            pool.error = error instanceof Error ? error.message : String(error);
            console.log(`❌ Failed to analyze pool after ${this.maxAttempts} attempts: ${pool.error}`);
          }
        }
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, this.checkInterval));
    }
  }

  // Stop monitoring a specific pool
  public async stopMonitoring(poolAddress: string) {
    const pool = this.pools.get(poolAddress);
    if (pool?.realTimeMonitor) {
      pool.realTimeMonitor.stop();
      pool.realTimeMonitor = undefined;
    }
    this.pools.delete(poolAddress);
  }

  // Stop all monitoring
  public async stopAllMonitoring() {
    for (const pool of this.pools.values()) {
      if (pool.realTimeMonitor) {
        pool.realTimeMonitor.stop();
      }
    }
    this.pools.clear();
    this.isRunning = false;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  // Get current status of all pools
  getStatus(): PoolStatus[] {
    return Array.from(this.pools.values());
  }
}

// Export a singleton instance
let monitorInstance: PoolMonitor | null = null;

export function getPoolMonitor(connection: Connection): PoolMonitor {
  if (!monitorInstance) {
    monitorInstance = new PoolMonitor(connection);
  }
  return monitorInstance;
} 