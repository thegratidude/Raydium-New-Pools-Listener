import { Connection, PublicKey } from '@solana/web3.js';
import { PoolMonitor } from './monitor';
import { TokenInfo } from '../../types/token';
import { PoolUpdate } from '../../types/market';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🎭 Simulating Price Changes to Show Colored Output');
  console.log('================================================');
  console.log('This test simulates price changes to demonstrate the colored percentage output');
  console.log('Green = price increase, Red = price decrease\n');

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

  // Create a simulation monitor that artificially changes prices
  class SimulationMonitor extends PoolMonitor {
    private simulationStep: number = 0;
    private simulatedBaseReserve: number = 1000000; // 1M SOL
    private simulatedQuoteReserve: number = 160000000; // 160M USDC (price = $160)

    constructor(options: any) {
      super(options);
      this.isSilentMode = false;
      this.hasDetectedActivity = true;
    }

    protected async processPoolUpdate() {
      // Simulate price changes
      this.simulationStep++;
      
      // Create different price scenarios
      let newBaseReserve = this.simulatedBaseReserve;
      let newQuoteReserve = this.simulatedQuoteReserve;
      
      if (this.simulationStep <= 5) {
        // First 5 seconds: Price increases (green)
        newQuoteReserve = this.simulatedQuoteReserve * (1 + (this.simulationStep * 0.001)); // +0.1%, +0.2%, etc.
      } else if (this.simulationStep <= 10) {
        // Next 5 seconds: Price decreases (red)
        newQuoteReserve = this.simulatedQuoteReserve * (1 - ((this.simulationStep - 5) * 0.002)); // -0.2%, -0.4%, etc.
      } else if (this.simulationStep <= 15) {
        // Next 5 seconds: Price increases again (green)
        newQuoteReserve = this.simulatedQuoteReserve * (1 + ((this.simulationStep - 10) * 0.003)); // +0.3%, +0.6%, etc.
      } else {
        // Final 5 seconds: Mixed changes
        if (this.simulationStep % 2 === 0) {
          newQuoteReserve = this.simulatedQuoteReserve * 1.001; // Small increase
        } else {
          newQuoteReserve = this.simulatedQuoteReserve * 0.999; // Small decrease
        }
      }

      // Update simulated reserves
      this.simulatedBaseReserve = newBaseReserve;
      this.simulatedQuoteReserve = newQuoteReserve;

      // Calculate current price
      const currentPrice = newQuoteReserve / newBaseReserve;
      
      // Show the colored output
      const pricePercentage = this.getColoredPercentage(currentPrice);
      
      // Calculate reserve changes
      let baseChange = 0;
      let quoteChange = 0;
      
      if (this.lastBaseReserve !== null && this.lastQuoteReserve !== null) {
        baseChange = ((newBaseReserve - this.lastBaseReserve) / this.lastBaseReserve) * 100;
        quoteChange = ((newQuoteReserve - this.lastQuoteReserve) / this.lastQuoteReserve) * 100;
      }
      
      console.log(`📊 ${this.tokenA.symbol}/${this.tokenB.symbol} | Price: $${currentPrice.toFixed(8)} ${pricePercentage} | Base: ${baseChange.toFixed(4)}% | Quote: ${quoteChange.toFixed(4)}%`);
      
      // Update last reserves for next comparison
      this.lastBaseReserve = newBaseReserve;
      this.lastQuoteReserve = newQuoteReserve;
      
      // Set baseline price if not set
      if (this.baselinePrice === null) {
        this.baselinePrice = currentPrice;
        console.log(`📈 Set baseline price: $${this.baselinePrice.toFixed(8)}`);
      }
    }

    async start() {
      console.log(`🚀 Starting simulation monitor for ${this.tokenA.symbol}/${this.tokenB.symbol}`);
      console.log(`Baseline price will be set to first reading\n`);
      
      // Start in active mode (not silent)
      this.isSilentMode = false;
      this.hasDetectedActivity = true;

      // Initial state fetch
      await this.processPoolUpdate();

      // Start polling every 1 second
      this.intervalId = setInterval(async () => {
        try {
          await this.processPoolUpdate();
        } catch (error) {
          console.error(`Error in simulation:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }, this.updateInterval);
    }
  }

  const monitor = new SimulationMonitor({
    poolId: new PublicKey('58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'),
    tokenA,
    tokenB,
    httpUrl: process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
    wssUrl: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
    onUpdate: (update: PoolUpdate) => {
      // Not used in simulation
    },
    isSimulation: true
  });

  try {
    await monitor.start();
    
    console.log(`⏱️  Running simulation for 20 seconds...`);
    console.log(`📊 You should see price changes every 1 second with colored percentages\n`);
    
    await new Promise(resolve => setTimeout(resolve, 20000));
    
    monitor.stop();
    console.log(`\n⏹️  Simulation complete`);
    
  } catch (error) {
    console.error(`❌ Error:`, error);
    monitor.stop();
  }

  console.log('\n✅ Simulation complete!');
  console.log('Summary:');
  console.log('- First 5 seconds: Price increases (should show green percentages)');
  console.log('- Next 5 seconds: Price decreases (should show red percentages)');
  console.log('- Next 5 seconds: Price increases again (should show green percentages)');
  console.log('- Final 5 seconds: Mixed small changes (should alternate colors)');
}

main().catch(console.error); 