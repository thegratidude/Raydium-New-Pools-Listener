import { PoolMonitor } from './pool-monitor';
import { PoolSnapshot, MarketPressure, PoolDiscoveryResult } from './types';

interface PoolMonitorManagerOptions {
  httpUrl: string;
  wssUrl: string;
  historyLength?: number;
}

export class PoolMonitorManager {
  private monitors: Map<string, PoolMonitor> = new Map();
  private httpUrl: string;
  private wssUrl: string;
  private historyLength: number;

  constructor(options: PoolMonitorManagerOptions) {
    this.httpUrl = options.httpUrl;
    this.wssUrl = options.wssUrl;
    this.historyLength = options.historyLength || 50;
  }

  addPool(pool: PoolDiscoveryResult, tokenA: { symbol: string; decimals: number; mint: string; }, tokenB: { symbol: string; decimals: number; mint: string; }, onUpdate: (snapshot: PoolSnapshot, pressure: MarketPressure) => void) {
    if (this.monitors.has(pool.poolId)) return;
    const monitor = new PoolMonitor({
      poolId: pool.poolId,
      tokenA,
      tokenB,
      httpUrl: this.httpUrl,
      wssUrl: this.wssUrl,
      onUpdate,
      historyLength: this.historyLength,
    });
    this.monitors.set(pool.poolId, monitor);
    monitor.start();
  }

  removePool(poolId: string) {
    const monitor = this.monitors.get(poolId);
    if (monitor) {
      monitor.stop();
      this.monitors.delete(poolId);
    }
  }

  stopAll() {
    for (const monitor of this.monitors.values()) {
      monitor.stop();
    }
    this.monitors.clear();
  }
} 