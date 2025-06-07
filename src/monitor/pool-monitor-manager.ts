import { Injectable, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { PoolInfo, TokenInfo, PoolUpdateCallback } from './types';
import { decodeRaydiumPoolState } from './raydium-layout';

@Injectable()
export class PoolMonitorManager {
  private readonly logger = new Logger(PoolMonitorManager.name);
  private pools: Map<string, any> = new Map();

  constructor(private readonly connection: Connection) {
    this.logger.log('PoolMonitorManager initialized');
  }

  async getInitialQuote(poolId: string, baseMint: string, quoteMint: string): Promise<{ price?: number }> {
    try {
      const poolAccount = await this.connection.getAccountInfo(new PublicKey(poolId));
      if (!poolAccount || !poolAccount.data) {
        throw new Error('Pool account not found');
      }

      const state = decodeRaydiumPoolState(poolAccount.data);
      
      // Get vault balances
      const [baseVaultBalance, quoteVaultBalance] = await Promise.all([
        this.connection.getTokenAccountBalance(new PublicKey(state.baseVault)),
        this.connection.getTokenAccountBalance(new PublicKey(state.quoteVault))
      ]);

      // Calculate price using reserves
      const baseReserve = Number(baseVaultBalance.value.amount) / Math.pow(10, state.baseDecimal);
      const quoteReserve = Number(quoteVaultBalance.value.amount) / Math.pow(10, state.quoteDecimal);

      if (baseReserve === 0 || quoteReserve === 0) {
        return { price: undefined };
      }

      // Price is quote tokens per base token
      const price = quoteReserve / baseReserve;
      return { price };
    } catch (error) {
      this.logger.warn(`Failed to get initial quote for pool ${poolId}: ${error}`);
      return { price: undefined };
    }
  }

  addPool(
    poolInfo: PoolInfo,
    baseToken: TokenInfo,
    quoteToken: TokenInfo,
    onUpdate: PoolUpdateCallback
  ) {
    this.logger.log(`Adding pool ${poolInfo.poolId} to real-time monitoring`);
    this.logger.log(`Pair: ${baseToken.symbol}/${quoteToken.symbol}`);
    
    // Add pool monitoring logic here
    this.pools.set(poolInfo.poolId, {
      poolInfo,
      baseToken,
      quoteToken,
      onUpdate,
      lastUpdate: Date.now()
    });

    this.logger.log(`✅ Pool ${poolInfo.poolId} added to real-time monitoring`);
  }

  removePool(poolId: string) {
    if (this.pools.has(poolId)) {
      this.pools.delete(poolId);
      this.logger.log(`Removed pool ${poolId} from monitoring`);
    }
  }

  getActivePools() {
    return Array.from(this.pools.keys());
  }
} 