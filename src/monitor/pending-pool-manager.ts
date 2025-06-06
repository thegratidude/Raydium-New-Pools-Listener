import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';

export type PendingPoolState = 'pending' | 'indexed' | 'failed';

export interface PendingPool {
  poolId: string;
  tokenA: string;
  tokenB: string;
  firstSeen: number;
  lastChecked: number;
  attempts: number;
  state: PendingPoolState;
  error?: string;
}

interface PendingPoolManagerOptions {
  connection: Connection;
  checkInterval?: number; // ms
  maxAttempts?: number;
  onPoolReady: (pool: PendingPool) => void;
}

export class PendingPoolManager {
  private connection: Connection;
  private pools: Map<string, PendingPool> = new Map();
  private checkInterval: number;
  private maxAttempts: number;
  private onPoolReady: (pool: PendingPool) => void;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(options: PendingPoolManagerOptions) {
    this.connection = options.connection;
    this.checkInterval = options.checkInterval || 30_000; // 30s default
    this.maxAttempts = options.maxAttempts || 30; // 30 attempts (15 min)
    this.onPoolReady = options.onPoolReady;
  }

  addPool(poolId: string, tokenA: string, tokenB: string) {
    if (this.pools.has(poolId)) return;
    this.pools.set(poolId, {
      poolId,
      tokenA,
      tokenB,
      firstSeen: Date.now(),
      lastChecked: 0,
      attempts: 0,
      state: 'pending',
    });
    if (!this.isRunning) this.start();
  }

  private start() {
    this.isRunning = true;
    this.timer = setInterval(() => this.checkPools(), this.checkInterval);
    this.checkPools(); // Immediate first check
  }

  private async checkPools() {
    const now = Date.now();
    const pending = Array.from(this.pools.values()).filter(p => p.state === 'pending');
    if (pending.length === 0) {
      this.stop();
      return;
    }
    // Batch check existence
    const pubkeys = pending.map(p => new PublicKey(p.poolId));
    let infos: (AccountInfo<Buffer> | null)[] = [];
    try {
      infos = await this.connection.getMultipleAccountsInfo(pubkeys);
    } catch (e) {
      console.error('[PendingPoolManager] Batch RPC error:', e);
      return;
    }
    pending.forEach((pool, i) => {
      pool.lastChecked = now;
      pool.attempts++;
      const info = infos[i];
      if (info) {
        // Pool exists on-chain, mark as indexed and emit event
        pool.state = 'indexed';
        this.onPoolReady(pool);
        this.pools.delete(pool.poolId);
      } else if (pool.attempts >= this.maxAttempts) {
        pool.state = 'failed';
        pool.error = 'Not found after max attempts';
        this.pools.delete(pool.poolId);
      }
    });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.isRunning = false;
  }

  getPendingPools() {
    return Array.from(this.pools.values());
  }

  public removePool(poolId: string) {
    this.pools.delete(poolId);
  }
} 