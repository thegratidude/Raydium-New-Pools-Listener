import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import { TokenInfo } from '../../types/token';
import { PoolUpdate } from '../../types/market';
import { conciseOnUpdate, PoolSnapshot, MarketPressure, TrendDirection } from './types/types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Quick production demo with faster updates and logging
class QuickProductionDemo {
  private basePrice = 156.50;
  private baseReserve = 1000000;
  private quoteReserve = 156500000;
  private updateCount = 0;
  private startTime = Date.now();
  private logStream: fs.WriteStream;
  private logFilePath: string;
  private initialPrice: number | null = null; // Track the first price reading

  constructor() {
    // Ensure logs directory exists
    const logsDir = path.join(__dirname, '..', '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFilePath = path.join(logsDir, `production-demo-${timestamp}.log`);
    this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
  }

  private log(message: string): void {
    // Write to both console and log file
    console.log(message);
    this.logStream.write(message + '\n');
  }

  private simulatePriceChange(): number {
    const change = (Math.random() - 0.5) * 3; // -1.5% to +1.5%
    this.basePrice *= (1 + change / 100);
    return this.basePrice;
  }

  private simulateVolume(): number {
    const baseVolume = 5000000;
    const volatility = Math.random() * 0.8 + 0.2; // 20-100% of base
    return baseVolume * volatility;
  }

  private simulateMarketPressure(): MarketPressure {
    const pressure = (Math.random() - 0.5) * 2;
    const buyPressure = pressure > 0 ? 50 + pressure * 30 : 50;
    const sellPressure = pressure < 0 ? 50 + Math.abs(pressure) * 30 : 50;
    const rugRisk = Math.random() * 10;
    
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

  private generateSnapshot(): PoolSnapshot {
    const price = this.simulatePriceChange();
    const volume24h = this.simulateVolume();
    const tvl = this.baseReserve * price + this.quoteReserve;
    
    const reserveChange = (Math.random() - 0.5) * 0.03;
    this.baseReserve *= (1 + reserveChange);
    this.quoteReserve *= (1 - reserveChange * 0.5);

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

  private getColoredPercentage(currentPrice: number): string {
    if (this.initialPrice === null) {
      this.initialPrice = currentPrice;
      return '(0.00%)'; // First reading, no change
    }

    const percentageChange = ((currentPrice - this.initialPrice) / this.initialPrice) * 100;
    const formattedChange = percentageChange.toFixed(2);
    
    if (percentageChange > 0) {
      return `\x1b[32m(+${formattedChange}%)\x1b[0m`; // Green for positive
    } else if (percentageChange < 0) {
      return `\x1b[31m(${formattedChange}%)\x1b[0m`; // Red for negative
    } else {
      return `(${formattedChange}%)`; // No color for zero
    }
  }

  private displayProductionOutput(snapshot: PoolSnapshot, pressure: MarketPressure): void {
    const elapsed = Date.now() - this.startTime;
    const minutes = Math.floor(elapsed / (1000 * 60));
    const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);
    
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

    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
    
    // Replace the price change percentage with our colored version
    const coloredPercentage = this.getColoredPercentage(snapshot.price);
    const modifiedOutput = consoleOutput.replace(/\([^)]*%\)/, coloredPercentage);
    
    this.log(`[${timestamp}] ${modifiedOutput} | Runtime: ${minutes}m${seconds}s | Updates: ${this.updateCount}`);
    
    // Production alerts
    if (pressure.rugRisk > 7) {
      this.log(`🚨 HIGH RUG RISK ALERT: ${pressure.rugRisk.toFixed(2)} | ${snapshot.poolId}`);
    }
    
    if (Math.abs(pressure.value) > 0.8) {
      this.log(`⚡ STRONG MARKET PRESSURE: ${pressure.value > 0 ? 'BUY' : 'SELL'} | Strength: ${pressure.strength.toFixed(2)}`);
    }
    
    if (snapshot.volume24h > 10000000) {
      this.log(`📈 HIGH VOLUME ALERT: $${(snapshot.volume24h / 1000000).toFixed(1)}M in 24h`);
    }

    // Simulate some reserve change alerts
    if (Math.random() > 0.85) {
      const changePercent = (Math.random() - 0.5) * 2;
      this.log(`💧 RESERVE CHANGE: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}% | Base: ${(snapshot.baseReserve / 1000).toFixed(0)}k | Quote: $${(snapshot.quoteReserve / 1000).toFixed(0)}k`);
    }
  }

  async runDemo(durationSeconds: number = 30): Promise<void> {
    this.log('🏭 QUICK PRODUCTION DEMO');
    this.log('='.repeat(80));
    this.log(`Simulating ${durationSeconds} seconds of production monitoring`);
    this.log('Format: [Timestamp] Pair | Price | Volume | TVL | Market Pressure | Runtime | Updates');
    this.log('='.repeat(80));
    this.log(`📝 Logging to: ${this.logFilePath}`);
    this.log('');

    const interval = setInterval(() => {
      this.updateCount++;
      const snapshot = this.generateSnapshot();
      const pressure = this.simulateMarketPressure();
      
      this.displayProductionOutput(snapshot, pressure);
      
      if (this.updateCount >= durationSeconds) {
        clearInterval(interval);
        this.showSummary();
      }
    }, 1000); // Update every second for quick demo
  }

  private showSummary(): void {
    this.log('');
    this.log('📊 PRODUCTION DEMO SUMMARY');
    this.log('='.repeat(50));
    this.log(`Total Runtime: ${Math.floor((Date.now() - this.startTime) / 1000)} seconds`);
    this.log(`Total Updates: ${this.updateCount}`);
    this.log(`Initial Price: $${this.initialPrice?.toFixed(2)}`);
    this.log(`Final Price: $${this.basePrice.toFixed(2)}`);
    if (this.initialPrice) {
      const totalChange = ((this.basePrice - this.initialPrice) / this.initialPrice) * 100;
      this.log(`Total Price Change: ${totalChange > 0 ? '+' : ''}${totalChange.toFixed(2)}%`);
    }
    this.log(`Final TVL: $${(this.baseReserve * this.basePrice + this.quoteReserve).toLocaleString()}`);
    this.log(`Average Update Interval: 1 second`);
    this.log('='.repeat(50));
    this.log('');
    this.log('🎯 PRODUCTION FEATURES DEMONSTRATED:');
    this.log('✅ Real-time price monitoring');
    this.log('✅ Volume tracking with alerts');
    this.log('✅ Market pressure analysis');
    this.log('✅ Rug risk detection');
    this.log('✅ Reserve change monitoring');
    this.log('✅ Timestamped logging');
    this.log('✅ Runtime tracking');
    this.log('✅ Alert system for significant events');
    this.log('✅ Position tracking with colored percentage changes');
    this.log('');
    this.log(`📁 Complete log saved to: ${this.logFilePath}`);
    
    // Close the log stream
    this.logStream.end();
  }
}

async function main() {
  console.log('🚀 Starting Quick Production Demo with Logging');
  console.log('This shows how the pool monitor displays data in production');
  console.log('Press Ctrl+C to stop early\n');

  const demo = new QuickProductionDemo();
  
  try {
    await demo.runDemo(30); // Run for 30 seconds
  } catch (error) {
    console.error('❌ Demo error:', error);
  }
}

process.on('SIGINT', () => {
  console.log('\n⏹️  Production demo stopped by user');
  process.exit(0);
});

main().catch(console.error); 