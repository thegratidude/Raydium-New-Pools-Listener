import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from '../monitor';
import { TokenInfo } from '../../../types/token';
import { PoolUpdate } from '../../../types/market';
import * as dotenv from 'dotenv';

dotenv.config();

// Experiment 1: Sensitivity Threshold Testing
// This experiment tests different reserve change thresholds to see how they affect detection timing

interface SensitivityTestConfig {
  threshold: number;
  description: string;
  color: string;
}

const SENSITIVITY_TESTS: SensitivityTestConfig[] = [
  { threshold: 0.0001, description: 'Ultra-High Sensitivity (0.01%)', color: '\x1b[35m' }, // Purple
  { threshold: 0.0005, description: 'High Sensitivity (0.05%)', color: '\x1b[32m' },       // Green
  { threshold: 0.001, description: 'Medium Sensitivity (0.1%)', color: '\x1b[33m' },       // Yellow
  { threshold: 0.005, description: 'Low Sensitivity (0.5%)', color: '\x1b[31m' },          // Red
];

class SensitivityTestMonitor extends PoolMonitor {
  private testConfig: SensitivityTestConfig;
  private detectionTimes: number[] = [];
  private startTime: number;

  constructor(options: any, testConfig: SensitivityTestConfig) {
    super(options);
    this.testConfig = testConfig;
    this.startTime = Date.now();
  }

  protected detectReserveChange(baseReserve: number, quoteReserve: number): boolean {
    if (this.lastBaseReserve === null || this.lastQuoteReserve === null) {
      return false;
    }

    const baseChange = Math.abs((baseReserve - this.lastBaseReserve) / this.lastBaseReserve);
    const quoteChange = Math.abs((quoteReserve - this.lastQuoteReserve) / this.lastQuoteReserve);
    
    const detected = baseChange > this.testConfig.threshold || quoteChange > this.testConfig.threshold;
    
    if (detected) {
      const detectionTime = Date.now() - this.startTime;
      this.detectionTimes.push(detectionTime);
      
      console.log(`${this.testConfig.color}${this.testConfig.description}${'\x1b[0m'}: Detected change at ${detectionTime}ms`);
      console.log(`  Base change: ${(baseChange * 100).toFixed(4)}%, Quote change: ${(quoteChange * 100).toFixed(4)}%`);
    }
    
    return detected;
  }

  getResults() {
    return {
      config: this.testConfig,
      detectionTimes: this.detectionTimes,
      averageDetectionTime: this.detectionTimes.length > 0 
        ? this.detectionTimes.reduce((a, b) => a + b, 0) / this.detectionTimes.length 
        : 0,
      totalDetections: this.detectionTimes.length
    };
  }
}

async function runSensitivityExperiment() {
  console.log('🧪 EXPERIMENT 1: Sensitivity Threshold Testing');
  console.log('='.repeat(60));
  console.log('Testing different reserve change thresholds on active SOL/USDC pool');
  console.log('Monitoring for 60 seconds to capture multiple events\n');

  const KNOWN_ACTIVE_POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
  
  const tokenA: TokenInfo = {
    symbol: 'SOL',
    decimals: 9,
    mint: 'So11111111111111111111111111111111111111112'
  };
  
  const tokenB: TokenInfo = {
    symbol: 'USDC',
    decimals: 6,
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  };

  const monitors: SensitivityTestMonitor[] = [];
  const results: any[] = [];

  // Create monitors for each sensitivity level
  for (const testConfig of SENSITIVITY_TESTS) {
    const monitor = new SensitivityTestMonitor({
      poolId: new PublicKey(KNOWN_ACTIVE_POOL),
      tokenA,
      tokenB,
      httpUrl: process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
      wssUrl: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
      onUpdate: (update: PoolUpdate) => {
        // Minimal logging to avoid spam
      },
      isSimulation: false
    }, testConfig);

    monitors.push(monitor);
  }

  // Start all monitors
  console.log('🚀 Starting all sensitivity monitors...\n');
  for (const monitor of monitors) {
    await monitor.start();
  }

  // Monitor for 60 seconds
  console.log('⏱️  Monitoring for 60 seconds...\n');
  await new Promise(resolve => setTimeout(resolve, 60000));

  // Stop all monitors and collect results
  console.log('🛑 Stopping monitors and collecting results...\n');
  for (const monitor of monitors) {
    monitor.stop();
    results.push(monitor.getResults());
  }

  // Display results
  console.log('📊 SENSITIVITY TEST RESULTS');
  console.log('='.repeat(60));
  
  for (const result of results) {
    const { config, detectionTimes, averageDetectionTime, totalDetections } = result;
    console.log(`${config.color}${config.description}${'\x1b[0m'}:`);
    console.log(`  Total detections: ${totalDetections}`);
    console.log(`  Average detection time: ${averageDetectionTime.toFixed(0)}ms`);
    if (detectionTimes.length > 0) {
      console.log(`  Detection times: ${detectionTimes.map(t => `${t}ms`).join(', ')}`);
    }
    console.log('');
  }

  // Analysis
  console.log('🔍 ANALYSIS');
  console.log('='.repeat(60));
  
  const mostSensitive = results.reduce((prev, current) => 
    current.totalDetections > prev.totalDetections ? current : prev
  );
  
  const fastestDetector = results.reduce((prev, current) => 
    current.averageDetectionTime < prev.averageDetectionTime && current.totalDetections > 0 ? current : prev
  );

  console.log(`Most detections: ${mostSensitive.config.description} (${mostSensitive.totalDetections} detections)`);
  console.log(`Fastest average detection: ${fastestDetector.config.description} (${fastestDetector.averageDetectionTime.toFixed(0)}ms)`);
  
  console.log('\n💡 INSIGHTS:');
  console.log('- Lower thresholds catch more events but may include noise');
  console.log('- Higher thresholds are more selective but may miss early signals');
  console.log('- The optimal threshold depends on your trading strategy');
}

// Run the experiment
runSensitivityExperiment().catch(console.error); 