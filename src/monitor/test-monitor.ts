import { config } from 'dotenv';
config();
import { PoolMonitorManager } from './pool-monitor-manager.js';
import fetch from 'node-fetch';
import { Connection } from '@solana/web3.js';
import { conciseOnUpdate, TrendDirection } from './types.js';
import { Logger } from '@nestjs/common';

const HTTP_URL = process.env.HTTP_URL!;
const WSS_URL = process.env.WSS_URL!;

// Example Raydium SOL/USDC pool (replace with any pool for live test)
const poolDiscoveryResult = {
  poolId: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
  baseMint: 'So11111111111111111111111111111111111111112',
  quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  lpMint: '',
  isViable: true,
};

const tokenA = { symbol: 'SOL', decimals: 9, mint: poolDiscoveryResult.baseMint };
const tokenB = { symbol: 'USDC', decimals: 6, mint: poolDiscoveryResult.quoteMint };

const connection = new Connection(HTTP_URL, { wsEndpoint: WSS_URL });
const manager = new PoolMonitorManager(connection);

let solPrice = 0;

const logger = new Logger('TestMonitor');

async function updateSolPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = (await res.json()) as any;
    solPrice = data.solana.usd;
  } catch (e) {
    solPrice = 0;
  }
}

updateSolPrice();
setInterval(updateSolPrice, 60_000); // Update every minute

function formatUSD(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

// Start monitoring
manager.addPool(
  poolDiscoveryResult.poolId,
  poolDiscoveryResult.baseMint,
  poolDiscoveryResult.quoteMint,
  tokenA.decimals,
  tokenB.decimals,
  (snapshot) => {
    // Use conciseOnUpdate for logging
    conciseOnUpdate(
      snapshot,
      snapshot.pressure || { 
        direction: TrendDirection.SIDEWAYS, 
        strength: 0, // neutral strength as a number
        value: 0, 
        buyPressure: 0, 
        sellPressure: 0, 
        rugRisk: 0, 
        trend: TrendDirection.SIDEWAYS,
        severity: 'low'
      },
      tokenA,
      tokenB,
      snapshot.originPrice || null,
      snapshot.originBaseReserve || null,
      snapshot.originQuoteReserve || null,
      snapshot.previousSnapshot || null,
      snapshot.pool_id
    );
  }
);

// Keep the process running
logger.log('Test monitor running... Press Ctrl+C to stop');
process.on('SIGINT', () => {
  logger.log('Stopping test monitor...');
  process.exit(0);
}); 