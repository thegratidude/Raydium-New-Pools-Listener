# Modular Raydium Pool Monitor

This module provides a production-grade, event-driven monitoring system for Raydium AMM pools on Solana, optimized for early arbitrage and rug detection.

## Architecture
- **PoolMonitor**: Monitors a single pool in real-time, computes analytics, and emits concise updates.
- **PoolMonitorManager**: Manages multiple PoolMonitor instances, handles batch/memory management, and provides a simple API for adding/removing pools.
- **types.ts**: Shared types/interfaces for pool snapshots, market pressure, and integration.
- **utils.ts**: Decimal handling, reserve math, and price/slippage calculations.

## Usage
1. **Instantiate a PoolMonitorManager** with your Helius HTTP and WSS endpoints.
2. **Add pools** to monitor using `addPool(poolDiscoveryResult, tokenA, tokenB, onUpdate)`.
3. **Receive real-time updates** via the `onUpdate` callback for each pool.
4. **Remove pools** or stop all monitoring as needed.

## Integration
- Designed to be called by your Raydium pool listener when a new viable pool is discovered.
- Emits actionable, single-line updates for each monitored pool, including reserve changes, price, TVL, market pressure, and rug risk.

## Example
```typescript
const manager = new PoolMonitorManager({ httpUrl: process.env.HTTP_URL!, wssUrl: process.env.WSS_URL! });
manager.addPool(
  { poolId: '...', baseMint: '...', quoteMint: '...', lpMint: '...', isViable: true },
  { symbol: 'TOKEN', decimals: 6, mint: '...' },
  { symbol: 'SOL', decimals: 9, mint: '...' },
  (snapshot, pressure) => {
    console.log(`[${snapshot.poolId}] Price: ${snapshot.price}, TVL: ${snapshot.tvl}, BuyPressure: ${pressure.buyPressure}, RugRisk: ${pressure.rugRisk}`);
  }
);
```

See `types.ts` and `utils.ts` for more details on available analytics and calculations. 