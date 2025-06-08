import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor.js';
import { MonitorConfig, MonitorAlert, PoolReserves, TradeActivity, PriceState } from './types/monitor.types.js';
import * as dotenv from 'dotenv';

dotenv.config();

// Test pool (SOL/USDC)
const TEST_POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';

// Track previous values for change calculation
let previousState = {
  baseReserves: 0,
  volume: 0,
  lastUpdate: new Date()
};

// Track initial price for monitoring period
let initialPrice = 0;

// Helper to calculate percentage change
const calculateChange = (current: number, previous: number): number => {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
};

// Helper to calculate price from reserves
const calculatePrice = (baseReserves: number, quoteReserves: number): number => {
  return quoteReserves / baseReserves;
};

// Helper to calculate slippage for 1 SOL trade
const calculateSlippage = (baseReserves: number, quoteReserves: number): number => {
  // Using constant product formula (x * y = k)
  // For 1 SOL trade, slippage = (1 / baseReserves) * 100
  return (1 / baseReserves) * 100;
};

// Simulated data for testing with more realistic values
const simulateReserves = (): PoolReserves => {
  // Start with a base of 100 SOL and add some random variation
  const baseAmount = 100 + Math.random() * 50; // 100-150 SOL
  const quoteAmount = baseAmount * 155; // Roughly $15,500-23,250 worth of USDC
  
  return {
    tokenA: {
      address: new PublicKey('So11111111111111111111111111111111111111112'),
      symbol: 'WSOL',
      amount: baseAmount,
      usdValue: baseAmount * 155,
      lastUpdate: new Date()
    },
    tokenB: {
      address: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      symbol: 'USDC',
      amount: quoteAmount,
      usdValue: quoteAmount,
      lastUpdate: new Date()
    },
    totalLiquidity: baseAmount * 155 * 2, // Total value of both sides
    lastUpdate: new Date()
  };
};

const simulateTrades = (): TradeActivity => ({
  trades: [{
    timestamp: new Date(),
    tokenIn: {
      symbol: 'USDC',
      amount: 1000 + Math.random() * 2000, // $1k-3k trades
      usdValue: 1000 + Math.random() * 2000
    },
    tokenOut: {
      symbol: 'WSOL',
      amount: 6 + Math.random() * 20, // 6-26 SOL trades
      usdValue: 1000 + Math.random() * 2000
    },
    priceImpact: 0.001 + Math.random() * 0.01,
    type: Math.random() > 0.5 ? 'buy' : 'sell'
  }],
  volume: 5000 + Math.random() * 10000, // $5k-15k volume
  tradeCount: 1 + Math.floor(Math.random() * 3), // 1-3 trades
  averagePriceImpact: 0.002 + Math.random() * 0.008,
  timeWindow: 60,
  lastUpdate: new Date()
});

const simulatePrice = (): PriceState => ({
  currentPrice: 155 + Math.random() * 2,
  priceChange24h: -2 + Math.random() * 4,
  priceChange1h: -0.5 + Math.random() * 1,
  high24h: 158,
  low24h: 153,
  lastUpdate: new Date()
});

async function testMonitor() {
  if (!process.env.HTTP_URL) {
    throw new Error('HTTP_URL must be defined in .env file');
  }

  console.log('\n🔍 Testing Real-Time Pool Monitor (Simulation Mode)');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('This is a simulation showing how the monitor will display real-time data');
  console.log('Data is randomly generated for demonstration purposes');
  console.log('════════════════════════════════════════════════════════════════════════════════');

  // Create connection
  const connection = new Connection(process.env.HTTP_URL);

  // Monitor configuration
  const config: MonitorConfig = {
    poolAddress: new PublicKey(TEST_POOL),
    updateInterval: 2000,  // 2 seconds for simulation
    tradeWindow: 60,      // 1 minute
    priceAlertThreshold: 2,    // 2% price change
    liquidityAlertThreshold: 5, // 5% liquidity change
    volumeAlertThreshold: 10000 // $10k volume spike
  };

  // Create monitor instance with relative change tracking
  const monitor = new PoolMonitor({
    connection,
    config,
    onReserveUpdate: (reserves) => {
      const baseReserves = reserves.tokenA.amount;
      const quoteReserves = reserves.tokenB.amount;
      const baseSymbol = reserves.tokenA.symbol;
      const quoteSymbol = reserves.tokenB.symbol;

      // Calculate current price and price change
      const currentPrice = calculatePrice(baseReserves, quoteReserves);
      if (initialPrice === 0) {
        initialPrice = currentPrice;
      }
      const priceChangeSinceStart = calculateChange(currentPrice, initialPrice);

      // Calculate changes
      const baseReservesChange = calculateChange(baseReserves, previousState.baseReserves);
      const volumeChange = calculateChange(reserves.totalLiquidity, previousState.volume);
      
      // Calculate absolute slippage for 1 SOL trade
      const slippage = calculateSlippage(baseReserves, quoteReserves);

      // Update previous state
      previousState.baseReserves = baseReserves;
      previousState.volume = reserves.totalLiquidity;

      // Format the changes with + or - signs
      const formatChange = (change: number) => {
        const sign = change >= 0 ? '+' : '';
        return `${sign}${change.toFixed(2)}%`;
      };

      // Main pool status line
      console.log(
        `📊 ${baseSymbol}/${quoteSymbol} | ` +
        `Base: ${formatChange(baseReservesChange)} | ` +
        `Vol: ${formatChange(volumeChange)} | ` +
        `Price: ${formatChange(priceChangeSinceStart)} | ` +
        `Slippage(1${baseSymbol}): ${slippage.toFixed(3)}% | ` +
        `TVL: $${reserves.totalLiquidity.toLocaleString(undefined, {maximumFractionDigits: 0})}`
      );
    },
    onTradeUpdate: (trades) => {
      // Show latest trade if there is one
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

      // Show swap activity summary
      console.log(
        `🔄 Swaps: ${trades.tradeCount} | ` +
        `Vol: $${trades.volume.toLocaleString(undefined, {maximumFractionDigits: 0})} | ` +
        `Avg Impact: ${trades.averagePriceImpact.toFixed(3)}%`
      );
    },
    onPriceUpdate: (price) => {
      // Optional: Add price info if needed
    },
    onAlert: (alert: MonitorAlert) => {
      const severityEmoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
      console.log(`${severityEmoji} ${alert.type}: ${alert.message}`);
    }
  });

  // Start monitoring
  console.log(`\nStarting monitor for pool: ${TEST_POOL}`);
  console.log('Press Ctrl+C to stop monitoring');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  // Simulate monitoring
  const simulateMonitoring = async () => {
    while (true) {
      // Simulate updates
      monitor['onReserveUpdate']?.(simulateReserves());
      monitor['onTradeUpdate']?.(simulateTrades());
      monitor['onPriceUpdate']?.(simulatePrice());

      // Occasionally simulate an alert
      if (Math.random() < 0.1) { // 10% chance of alert
        const alertTypes: MonitorAlert['type'][] = ['LIQUIDITY_CHANGE', 'PRICE_MOVEMENT', 'VOLUME_SPIKE', 'TRADE_ANOMALY', 'EXIT_SIGNAL'];
        const alertType = alertTypes[Math.floor(Math.random() * alertTypes.length)];
        monitor['onAlert']?.({
          type: alertType,
          poolAddress: new PublicKey(TEST_POOL),
          message: `Simulated ${alertType.toLowerCase().replace('_', ' ')} alert`,
          severity: Math.random() < 0.3 ? 'critical' : Math.random() < 0.6 ? 'warning' : 'info',
          timestamp: new Date(),
          data: {
            currentValue: Math.random() * 1000000,
            threshold: Math.random() * 1000000,
            change: Math.random() * 10 - 5
          }
        });
      }

      await new Promise(resolve => setTimeout(resolve, config.updateInterval));
    }
  };

  // Start simulation
  simulateMonitoring().catch(console.error);

  // Keep the script running
  process.on('SIGINT', () => {
    console.log('\nStopping monitor...');
    process.exit(0);
  });
}

// Run the test
testMonitor().catch(console.error); 