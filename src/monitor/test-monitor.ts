import { config } from 'dotenv';
config();
import { PoolMonitorManager } from './pool-monitor-manager';
import fetch from 'node-fetch';
import { Connection } from '@solana/web3.js';

const HTTP_URL = process.env.HTTP_URL!;
const WSS_URL = process.env.WSS_URL!;

// Example Raydium SOL/USDC pool (replace with any pool for live test)
const poolDiscoveryResult = {
  poolId: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
  baseMint: 'So11111111111111111111111111111111111111112',
  quoteMint: 'EPjFWdd5AufqSSqeM2qAqAqAqAqAqAqAqAqAqAqAqAqA',
  lpMint: '',
  isViable: true,
};

const tokenA = { symbol: 'SOL', decimals: 9, mint: poolDiscoveryResult.baseMint };
const tokenB = { symbol: 'USDC', decimals: 6, mint: poolDiscoveryResult.quoteMint };

const connection = new Connection(HTTP_URL, { wsEndpoint: WSS_URL });
const manager = new PoolMonitorManager(connection);

let solPrice = 0;

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

manager.addPool(poolDiscoveryResult, tokenA, tokenB, (snapshot, pressure) => {
  // Convert reserves to USD
  const baseUSD = tokenA.symbol === 'SOL' ? snapshot.baseReserve * solPrice : snapshot.baseReserve;
  const quoteUSD = tokenB.symbol === 'SOL' ? snapshot.quoteReserve * solPrice : snapshot.quoteReserve;
  // Concise output: SYMBOLS | Price | TVL | Base($) | Quote($) | BuyP | Rug | Trend
  console.log(
    `${tokenA.symbol}/${tokenB.symbol} | $${snapshot.price.toFixed(4)} | TVL $${formatUSD(snapshot.tvl)} | ` +
    `Base $${formatUSD(baseUSD)} | Quote $${formatUSD(quoteUSD)} | ` +
    `BuyP ${pressure.buyPressure} | Rug ${pressure.rugRisk} | ${pressure.trend}`
  );
});

// Keep process alive
process.stdin.resume(); 