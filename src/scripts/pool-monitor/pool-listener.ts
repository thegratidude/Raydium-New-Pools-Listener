import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import * as dotenv from 'dotenv';
import { LIQUIDITY_STATE_LAYOUT_V4 } from '@raydium-io/raydium-sdk';
import { PoolSnapshot, MarketPressure } from '../../monitor/types';
import { PriceState } from './types/monitor.types';

dotenv.config();

// Constants for pool filtering
const MIN_TVL = 45000; // $45k minimum TVL
const MAX_TVL = 65000; // $65k maximum TVL
const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

interface NewPool {
  poolId: string;
  baseMint: string;
  quoteMint: string;
  tvl: number;
  timestamp: number;
}

class PoolListener {
  private connection: Connection;
  private activeMonitors: Map<string, PoolMonitor> = new Map();
  private newPools: NewPool[] = [];

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async start() {
    console.log('Starting Raydium pool listener...');
    console.log('Monitoring for new pools in TVL range: $45k - $65k');
    console.log('Press Ctrl+C to stop\n');

    // Subscribe to program account changes
    const subscriptionId = this.connection.onProgramAccountChange(
      RAYDIUM_PROGRAM_ID,
      async (accountInfo, context) => {
        try {
          const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.accountInfo.data);
          
          // Only process if this is a new pool (check if we're already monitoring it)
          const poolId = accountInfo.accountId.toString();
          if (this.activeMonitors.has(poolId)) return;

          // Get initial reserves to calculate TVL
          const [baseVaultInfo, quoteVaultInfo] = await Promise.all([
            this.connection.getTokenAccountBalance(poolState.baseVault),
            this.connection.getTokenAccountBalance(poolState.quoteVault)
          ]);

          if (!baseVaultInfo.value || !quoteVaultInfo.value) return;

          const baseReserve = baseVaultInfo.value.uiAmount || 0;
          const quoteReserve = quoteVaultInfo.value.uiAmount || 0;
          const tvl = quoteReserve * 2; // Simplified TVL calculation

          // Only monitor pools in our target TVL range
          if (tvl >= MIN_TVL && tvl <= MAX_TVL) {
            console.log('\n════════════════════════════════════════════════════════════════════════════════');
            console.log('🆕 New Pool Detected!');
            console.log(`Pool ID: ${poolId}`);
            console.log(`Base Mint: ${poolState.baseMint.toString()}`);
            console.log(`Quote Mint: ${poolState.quoteMint.toString()}`);
            console.log(`TVL: $${tvl.toFixed(2)}`);
            console.log('════════════════════════════════════════════════════════════════════════════════\n');

            // Start monitoring this pool
            await this.startPoolMonitor(poolId, poolState);

            // Store pool info
            this.newPools.push({
              poolId,
              baseMint: poolState.baseMint.toString(),
              quoteMint: poolState.quoteMint.toString(),
              tvl,
              timestamp: Date.now()
            });
          }
        } catch (error) {
          console.error('Error processing new pool:', error);
        }
      },
      'confirmed'
    );

    console.log(`✅ Listener started with subscription ID: ${subscriptionId}`);
  }

  private async startPoolMonitor(poolId: string, poolState: any) {
    const monitor = new PoolMonitor({
      connection: this.connection,
      config: {
        poolAddress: new PublicKey(poolId),
        updateInterval: 1000,
        tradeWindow: 3600,
        priceAlertThreshold: 5,
        liquidityAlertThreshold: 10,
        volumeAlertThreshold: 1000
      },
      onPriceUpdate: (price: PriceState) => {
        // Only log significant price changes
        if (Math.abs(price.priceChangePercent) >= 1) {
          console.log(`\n📊 Pool ${poolId}`);
          console.log(`Price Change: ${price.priceChangePercent.toFixed(2)}%`);
          console.log(`Initial Ratio: ${price.initialRatio.toFixed(8)}`);
          console.log(`Current Ratio: ${price.currentRatio.toFixed(8)}`);
          console.log(`Last Update: ${price.lastUpdate.toLocaleString()}`);
        }
      }
    });

    try {
      await monitor.start();
      this.activeMonitors.set(poolId, monitor);
    } catch (error) {
      console.error(`Failed to start monitor for pool ${poolId}:`, error);
    }
  }

  stop() {
    console.log('\nStopping pool listener...');
    // Stop all active monitors
    for (const [poolId, monitor] of this.activeMonitors) {
      console.log(`Stopping monitor for pool ${poolId}`);
      monitor.stop();
    }
    this.activeMonitors.clear();
  }

  getActivePools(): NewPool[] {
    return this.newPools;
  }
}

async function main() {
  const connection = new Connection(process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com');
  const listener = new PoolListener(connection);

  try {
    await listener.start();
  } catch (error) {
    console.error('Failed to start listener:', error);
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    listener.stop();
    process.exit(0);
  });
}

main().catch(console.error); 