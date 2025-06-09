import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import { TokenInfo } from '../../types/token';
import { PoolUpdate } from '../../types/market';
import { conciseOnUpdate, PoolSnapshot, MarketPressure, TrendDirection } from './types/types';
import * as dotenv from 'dotenv';

dotenv.config();

// Simulate realistic market data over time
class ProductionSimulator {
  private basePrice = 156.50; // Starting SOL price
  private baseReserve = 1000000; // Starting SOL reserve
  private quoteReserve = 156500000; // Starting USDC reserve
  private updateCount = 0;
  private startTime = Date.now();

  // Simulate realistic price movements
  private simulatePriceChange(): number {
    // Random walk with some trend
    const change = (Math.random() - 0.5) * 2; // -1% to +1%
    this.basePrice *= (1 + change / 100);
    return this.basePrice;
  }

  // Simulate realistic volume
  private simulateVolume(): number {
    // Base volume with some randomness
    const baseVolume = 5000000; // $5M base volume
    const volatility = Math.random() * 0.5 + 0.5; // 50-100% of base
    return baseVolume * volatility;
  }

  // Simulate market pressure
  private simulateMarketPressure(): MarketPressure {
    const pressure = (Math.random() - 0.5) * 2; // -1 to +1
    const buyPressure = pressure > 0 ? 50 + pressure * 30 : 50;
    const sellPressure = pressure < 0 ? 50 + Math.abs(pressure) * 30 : 50;
    const rugRisk = Math.random() * 10; // 0-10 rug risk
    
    return {
      value: pressure,
      direction: pressure > 0 ? TrendDirection.Up : pressure < 0 ? TrendDirection.Down : TrendDirection.Sideways,
      strength: Math.abs(pressure),
      buyPressure,
      sellPressure,
      rugRisk,
      trend: pressure > 0.3 ? TrendDirection.Up : pressure < -0.3 ? TrendDirection.Down : TrendDirection.Sideways,
      severity: rugRisk > 7 ? 'high' : rugRisk > 4 ? 'medium' : 'low'
    };
  }

  // Generate a realistic pool snapshot
  private generateSnapshot(): PoolSnapshot {
    const price = this.simulatePriceChange();
    const volume24h = this.simulateVolume();
    const tvl = this.baseReserve * price + this.quoteReserve;
    
    // Simulate some reserve changes
    const reserveChange = (Math.random() - 0.5) * 0.02; // ±1% reserve change
    this.baseReserve *= (1 + reserveChange);
    this.quoteReserve *= (1 - reserveChange * 0.5); // Quote changes less

    return {
      poolId: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
      timestamp: Date.now(),
      slot: 0,
      baseReserve: this.baseReserve,
      quoteReserve: this.quoteReserve,
      price,
      priceChange: 0,
      tvl,
      marketCap: 0,
      volumeChange: 0,
      volume24h,
      suspicious: false,
      baseDecimals: 9,
      quoteDecimals: 6,
      buySlippage: 0,
      sellSlippage: 0,
      reserveRatio: this.quoteReserve / this.baseReserve,
      initialReserveRatio: 156.5,
      ratioChange: 0
    };
  }

  // Display production-like output
  private displayProductionOutput(snapshot: PoolSnapshot, pressure: MarketPressure): void {
    const elapsed = Date.now() - this.startTime;
    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
    
    const { consoleOutput } = conciseOnUpdate(
      snapshot,
      pressure,
      { symbol: 'SOL', decimals: 9, mint: 'So11111111111111111111111111111111111111112' },
      { symbol: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      snapshot.price,
      snapshot.baseReserve,
      snapshot.quoteReserve,
      null,
      snapshot.poolId
    );

    // Production-style timestamp
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
    
    console.log(`[${timestamp}] ${consoleOutput} | Runtime: ${hours}h${minutes}m | Updates: ${this.updateCount}`);
    
    // Show alerts for significant events
    if (pressure.rugRisk > 7) {
      console.log(`🚨 HIGH RUG RISK ALERT: ${pressure.rugRisk.toFixed(2)} | ${snapshot.poolId}`);
    }
    
    if (Math.abs(pressure.value) > 0.8) {
      console.log(`⚡ STRONG MARKET PRESSURE: ${pressure.value > 0 ? 'BUY' : 'SELL'} | Strength: ${pressure.strength.toFixed(2)}`);
    }
    
    if (snapshot.volume24h > 10000000) {
      console.log(`📈 HIGH VOLUME ALERT: $${(snapshot.volume24h / 1000000).toFixed(1)}M in 24h`);
    }
  }

  // Run the simulation
  async runSimulation(durationMinutes: number = 60): Promise<void> {
    console.log('🏭 PRODUCTION SIMULATION MODE');
    console.log('='.repeat(80));
    console.log(`Simulating ${durationMinutes} minutes of production monitoring`);
    console.log('Format: [Timestamp] Pair | Price | Volume | TVL | Market Pressure | Runtime | Updates');
    console.log('='.repeat(80));
    console.log('');

    const interval = setInterval(() => {
      this.updateCount++;
      const snapshot = this.generateSnapshot();
      const pressure = this.simulateMarketPressure();
      
      this.displayProductionOutput(snapshot, pressure);
      
      // Stop after duration
      if (this.updateCount >= durationMinutes) {
        clearInterval(interval);
        this.showSummary();
      }
    }, 60000); // Update every minute to simulate realistic production intervals
  }

  private showSummary(): void {
    console.log('');
    console.log('📊 PRODUCTION SIMULATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total Runtime: ${Math.floor((Date.now() - this.startTime) / (1000 * 60))} minutes`);
    console.log(`Total Updates: ${this.updateCount}`);
    console.log(`Final Price: $${this.basePrice.toFixed(2)}`);
    console.log(`Final TVL: $${(this.baseReserve * this.basePrice + this.quoteReserve).toLocaleString()}`);
    console.log(`Average Update Interval: 60 seconds`);
    console.log('='.repeat(50));
  }
}

async function main() {
  console.log('🚀 Starting Production Simulation');
  console.log('This simulates how the pool monitor would display data in production over 1 hour');
  console.log('Press Ctrl+C to stop early\n');

  const simulator = new ProductionSimulator();
  
  try {
    await simulator.runSimulation(60); // Run for 60 minutes (1 hour)
  } catch (error) {
    console.error('❌ Simulation error:', error);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Production simulation stopped by user');
  process.exit(0);
});

main().catch(console.error); 