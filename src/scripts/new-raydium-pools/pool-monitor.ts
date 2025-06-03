import { Connection, PublicKey } from '@solana/web3.js';
import { analyzePool } from '../pool-analyzer/analyzer';
import { RAYDIUM_PUBLIC_KEY } from 'src/main';

interface PoolStatus {
  poolAddress: string;
  tokenA: string;
  tokenB: string;
  firstSeen: Date;
  lastAttempt: Date;
  attempts: number;
  status: 'pending' | 'indexed' | 'failed';
  error?: string;
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

        try {
          // First check if pool exists on-chain
          const existenceCheck = await this.checkPoolExistence(pool.poolAddress);
          if (!existenceCheck.exists) {
            pool.status = 'failed';
            pool.error = `Pool not found on-chain: ${existenceCheck.reason}`;
            console.error('❌', pool.error);
            continue;
          }

          if (existenceCheck.owner !== RAYDIUM_PUBLIC_KEY) {
            pool.status = 'failed';
            pool.error = 'Pool is not owned by Raydium program';
            console.error('❌', pool.error);
            continue;
          }

          // Try to analyze the pool
          const analysis = await analyzePool(pool.poolAddress);
          
          // If we get here, the pool is indexed
          pool.status = 'indexed';
          console.log('\n✅ Pool is now indexed!');
          console.log('════════════════════════════════════════════════════════════════════════════════');
          console.log(`🪙 Pair: ${analysis.tokenA.symbol}/${analysis.tokenB.symbol}`);
          console.log(`💰 Price: $${analysis.price.toFixed(8)}`);
          console.log(`💎 TVL: $${analysis.tvl.toLocaleString()}`);
          console.log(`📈 24h Volume: $${analysis.volume24h.toLocaleString()}`);
          console.log(`💸 Fee Rate: ${(analysis.feeRate * 100).toFixed(2)}%`);
          console.log(`📊 Price Impact (1 SOL): ${analysis.priceImpact.toFixed(2)}%`);
          console.log(`✅ Viable: ${analysis.isViable ? 'Yes' : 'No'}`);
          if (analysis.reason) {
            console.log(`⚠️  Reason: ${analysis.reason}`);
          }
          console.log(`⏱️  Total time to index: ${this.formatDuration(now.getTime() - pool.firstSeen.getTime())}`);
          console.log('════════════════════════════════════════════════════════════════════════════════');
          console.log(`🔗 Explorer: https://explorer.solana.com/address/${pool.poolAddress}`);
          console.log('════════════════════════════════════════════════════════════════════════════════\n');

        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('not found or not yet indexed')) {
              console.log('⏳ Pool not indexed yet...');
              
              // Check if we've exceeded max attempts
              if (pool.attempts >= this.maxAttempts) {
                pool.status = 'failed';
                pool.error = `Exceeded maximum attempts (${this.maxAttempts})`;
                console.error('❌', pool.error);
              }
            } else {
              pool.status = 'failed';
              pool.error = `Analysis error: ${error.message}`;
              console.error('❌', pool.error);
            }
          }
        }
      }

      // Remove failed pools
      for (const [address, pool] of this.pools.entries()) {
        if (pool.status === 'failed') {
          this.pools.delete(address);
        }
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, this.checkInterval));
    }
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