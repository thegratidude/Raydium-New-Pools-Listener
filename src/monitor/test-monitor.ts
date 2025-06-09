import { Connection } from '@solana/web3.js';
import { PoolMonitorManager } from './pool-monitor-manager';
import { PendingPoolManager } from './pending-pool-manager';
import { SocketService } from '../gateway/socket.service';
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

// Mock SocketService
class MockSocketService extends SocketService {
  broadcast(event: string, data: any) {
    console.log(`[MockSocketService] Broadcasting ${event}:`, data);
  }
}

async function testMonitor() {
  const socketService = new MockSocketService();
  
  // Create a mock PendingPoolManager
  const pendingPoolManager = new PendingPoolManager(
    connection,
    (pool) => console.log('Pool ready:', pool)
  );

  const manager = new PoolMonitorManager(
    connection,
    socketService,
    pendingPoolManager
  );

  // Test adding a pool
  const TEST_POOL = 'test_pool_id';
  const tokenA = { symbol: 'SOL', decimals: 9, mint: 'SOL' };
  const tokenB = { symbol: 'USDC', decimals: 6, mint: 'USDC' };

  manager.addPool({
    pool_id: TEST_POOL,
    token_a: tokenA,
    token_b: tokenB
  });

  // Wait for some time to see updates
  await new Promise(resolve => setTimeout(resolve, 30000));
}

testMonitor().catch(console.error); 