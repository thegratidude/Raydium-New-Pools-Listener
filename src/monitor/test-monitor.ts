import { Connection } from '@solana/web3.js';
import { PoolMonitorManager } from './pool-monitor-manager';
import { PoolSnapshot, MarketPressure, PoolInfo, TokenInfo } from './types';
import * as dotenv from 'dotenv';

dotenv.config();

const HTTP_URL = process.env.HTTP_URL!;
const WSS_URL = process.env.WSS_URL!;

// Create connection
const connection = new Connection(HTTP_URL);

// Create manager with connection
const manager = new PoolMonitorManager(connection, undefined);

// Test pool info
const TEST_POOL_INFO: PoolInfo = {
  poolId: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
  baseMint: 'So11111111111111111111111111111111111111112',
  quoteMint: 'EPjFWdd5AufqSSqeM2qAqAqAqAqAqAqAqAqAqAqAqA',
  lpMint: '',
  isViable: true
};

// Token info
const BASE_TOKEN: TokenInfo = {
  mint: 'So11111111111111111111111111111111111111112',
  symbol: 'SOL',
  decimals: 9
};

const QUOTE_TOKEN: TokenInfo = {
  mint: 'EPjFWdd5AufqSSqeM2qAqAqAqAqAqAqAqAqAqAqAqA',
  symbol: 'USDC',
  decimals: 6
};

// Simple update callback
function onUpdate(
  snapshot: PoolSnapshot,
  pressure: MarketPressure,
  originPrice: number | null,
  originBaseReserve: number | null,
  originQuoteReserve: number | null,
  prevSnapshot: PoolSnapshot | null,
  poolId: string
) {
  console.log(`Pool ${poolId} update:`);
  console.log(`Price: ${snapshot.price} (${originPrice ? ((snapshot.price - originPrice) / originPrice * 100).toFixed(2) + '%' : 'N/A'} from origin)`);
  console.log(`TVL: ${snapshot.tvl}`);
  console.log(`Volume 24h: ${snapshot.volume24h}`);
  console.log(`Buy Pressure: ${pressure.buyPressure}`);
  console.log(`Sell Pressure: ${pressure.sellPressure}`);
  console.log(`Rug Risk: ${pressure.rugRisk}`);
  console.log(`Trend: ${pressure.trend}`);
  console.log('---');
}

async function testMonitor() {
  try {
    console.log('Starting test monitor...');
    await manager.addPool({ poolId: TEST_POOL_INFO.poolId, tokenA: BASE_TOKEN, tokenB: QUOTE_TOKEN });
    console.log('Pool added to monitor');
  } catch (error) {
    console.error('Error in test monitor:', error);
  }
}

testMonitor().catch(console.error); 