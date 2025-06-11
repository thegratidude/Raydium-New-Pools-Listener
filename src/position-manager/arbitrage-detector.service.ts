import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PositionManagerService } from './position-manager.service';
import { Status6Pool, PoolSnapshot } from './database/position-manager-db';

interface ArbitrageOpportunity {
  poolId: string;
  entryPrice: number;
  currentPrice: number;
  baselineTVL: number;
  currentTVL: number;
  priceChangePercent: number;
  tvlChangePercent: number;
  entryTime: number;
  confidence: 'high' | 'medium' | 'low';
  exitStrategy: {
    takeProfit: number; // Price target for profit taking
    stopLoss: number;   // Price target for loss prevention
    maxHoldTime: number; // Maximum time to hold position (minutes)
    tvlExitThreshold: number; // TVL drop threshold to exit
  };
  status: 'monitoring' | 'entered' | 'exited' | 'stopped';
  lastUpdate: number;
}

interface ArbitragePattern {
  name: string;
  description: string;
  conditions: {
    minPriceIncrease: number; // Minimum price increase to consider
    minTVLIncrease: number;   // Minimum TVL increase to consider
    maxPriceVolatility: number; // Maximum price volatility allowed
    minBaselineTVL: number;   // Minimum baseline TVL to consider
    maxRatio: number;         // Maximum token ratio to consider
  };
  exitStrategy: {
    takeProfitPercent: number;
    stopLossPercent: number;
    maxHoldTimeMinutes: number;
    tvlExitThresholdPercent: number;
  };
}

@Injectable()
export class ArbitrageDetectorService implements OnModuleInit {
  private readonly logger = new Logger(ArbitrageDetectorService.name);
  private readonly opportunities = new Map<string, ArbitrageOpportunity>();
  private readonly patterns: ArbitragePattern[] = [];

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly positionManagerService: PositionManagerService,
  ) {
    this.initializePatterns();
  }

  async onModuleInit() {
    this.logger.log('🎯 Initializing Arbitrage Detector Service...');
    
    // Listen for pool updates from LifeguardService
    this.eventEmitter.on('pool_metrics_update', (data: any) => {
      this.analyzePoolForArbitrage(data);
    });

    this.logger.log('✅ Arbitrage Detector Service initialized');
  }

  private initializePatterns() {
    // Conservative pattern - for pools with steady growth
    this.patterns.push({
      name: 'Steady Growth',
      description: 'Pools with consistent price and TVL growth',
      conditions: {
        minPriceIncrease: 5,      // 5% price increase
        minTVLIncrease: 2,        // 2% TVL increase
        maxPriceVolatility: 15,   // 15% max volatility
        minBaselineTVL: 50,       // 50 SOL minimum TVL
        maxRatio: 10000,          // Reasonable token ratio
      },
      exitStrategy: {
        takeProfitPercent: 25,    // Exit at 25% profit
        stopLossPercent: -10,     // Exit at 10% loss
        maxHoldTimeMinutes: 30,   // Max 30 minutes hold
        tvlExitThresholdPercent: -15, // Exit if TVL drops 15%
      }
    });

    // Aggressive pattern - for high momentum pools
    this.patterns.push({
      name: 'High Momentum',
      description: 'Pools with rapid price appreciation',
      conditions: {
        minPriceIncrease: 15,     // 15% price increase
        minTVLIncrease: 5,        // 5% TVL increase
        maxPriceVolatility: 25,   // 25% max volatility
        minBaselineTVL: 100,      // 100 SOL minimum TVL
        maxRatio: 5000,           // Lower ratio for momentum
      },
      exitStrategy: {
        takeProfitPercent: 40,    // Exit at 40% profit
        stopLossPercent: -15,     // Exit at 15% loss
        maxHoldTimeMinutes: 20,   // Max 20 minutes hold
        tvlExitThresholdPercent: -20, // Exit if TVL drops 20%
      }
    });

    // Ultra conservative pattern - for large TVL pools
    this.patterns.push({
      name: 'Large TVL Conservative',
      description: 'High TVL pools with steady growth',
      conditions: {
        minPriceIncrease: 3,      // 3% price increase
        minTVLIncrease: 1,        // 1% TVL increase
        maxPriceVolatility: 10,   // 10% max volatility
        minBaselineTVL: 500,      // 500 SOL minimum TVL
        maxRatio: 20000,          // Higher ratio allowed
      },
      exitStrategy: {
        takeProfitPercent: 15,    // Exit at 15% profit
        stopLossPercent: -5,      // Exit at 5% loss
        maxHoldTimeMinutes: 45,   // Max 45 minutes hold
        tvlExitThresholdPercent: -10, // Exit if TVL drops 10%
      }
    });
  }

  private analyzePoolForArbitrage(data: any) {
    const {
      poolId,
      currentPrice,
      baselinePrice,
      currentTVL,
      baselineTVL,
      reserveRatio
    } = data;

    // Calculate changes
    const priceChangePercent = ((currentPrice - baselinePrice) / baselinePrice) * 100;
    const tvlChangePercent = ((currentTVL - baselineTVL) / baselineTVL) * 100;

    // Check if this pool is already being tracked
    const existingOpportunity = this.opportunities.get(poolId);
    
    if (existingOpportunity) {
      // Update existing opportunity
      this.updateOpportunity(existingOpportunity, data);
    } else {
      // Check if this pool meets any pattern criteria
      const matchingPattern = this.findMatchingPattern(data);
      
      if (matchingPattern) {
        this.createOpportunity(poolId, data, matchingPattern);
      }
    }
  }

  private findMatchingPattern(data: any): ArbitragePattern | null {
    const {
      currentPrice,
      baselinePrice,
      currentTVL,
      baselineTVL,
      reserveRatio
    } = data;

    const priceChangePercent = ((currentPrice - baselinePrice) / baselinePrice) * 100;
    const tvlChangePercent = ((currentTVL - baselineTVL) / baselineTVL) * 100;

    for (const pattern of this.patterns) {
      const conditions = pattern.conditions;
      
      // Check if pool meets all conditions
      if (
        priceChangePercent >= conditions.minPriceIncrease &&
        tvlChangePercent >= conditions.minTVLIncrease &&
        baselineTVL >= conditions.minBaselineTVL &&
        reserveRatio <= conditions.maxRatio &&
        Math.abs(priceChangePercent) <= conditions.maxPriceVolatility
      ) {
        return pattern;
      }
    }

    return null;
  }

  private createOpportunity(poolId: string, data: any, pattern: ArbitragePattern) {
    const {
      currentPrice,
      baselinePrice,
      currentTVL,
      baselineTVL,
      reserveRatio
    } = data;

    const priceChangePercent = ((currentPrice - baselinePrice) / baselinePrice) * 100;
    const tvlChangePercent = ((currentTVL - baselineTVL) / baselineTVL) * 100;

    // Calculate confidence based on how well it matches the pattern
    const confidence = this.calculateConfidence(data, pattern);

    const opportunity: ArbitrageOpportunity = {
      poolId,
      entryPrice: currentPrice,
      currentPrice,
      baselineTVL,
      currentTVL,
      priceChangePercent,
      tvlChangePercent,
      entryTime: Date.now(),
      confidence,
      exitStrategy: {
        takeProfit: currentPrice * (1 + pattern.exitStrategy.takeProfitPercent / 100),
        stopLoss: currentPrice * (1 + pattern.exitStrategy.stopLossPercent / 100),
        maxHoldTime: pattern.exitStrategy.maxHoldTimeMinutes * 60 * 1000, // Convert to milliseconds
        tvlExitThreshold: baselineTVL * (1 + pattern.exitStrategy.tvlExitThresholdPercent / 100)
      },
      status: 'monitoring',
      lastUpdate: Date.now()
    };

    this.opportunities.set(poolId, opportunity);

    this.logger.log(`🎯 ARBITRAGE OPPORTUNITY DETECTED: ${poolId}`);
    this.logger.log(`📊 Pattern: ${pattern.name} | Confidence: ${confidence}`);
    this.logger.log(`💰 Entry Price: ${currentPrice.toFixed(8)} SOL (${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`);
    this.logger.log(`📈 TVL: ${currentTVL.toFixed(2)} SOL (${tvlChangePercent >= 0 ? '+' : ''}${tvlChangePercent.toFixed(2)}%)`);
    this.logger.log(`🎯 Take Profit: ${opportunity.exitStrategy.takeProfit.toFixed(8)} SOL (+${pattern.exitStrategy.takeProfitPercent}%)`);
    this.logger.log(`🛑 Stop Loss: ${opportunity.exitStrategy.stopLoss.toFixed(8)} SOL (${pattern.exitStrategy.stopLossPercent}%)`);
    this.logger.log(`⏰ Max Hold Time: ${pattern.exitStrategy.maxHoldTimeMinutes} minutes`);
    this.logger.log(`📉 TVL Exit Threshold: ${opportunity.exitStrategy.tvlExitThreshold.toFixed(2)} SOL`);

    // Emit event for trading service
    this.eventEmitter.emit('arbitrage_opportunity', opportunity);
  }

  private updateOpportunity(opportunity: ArbitrageOpportunity, data: any) {
    const { currentPrice, currentTVL } = data;
    
    opportunity.currentPrice = currentPrice;
    opportunity.currentTVL = currentTVL;
    opportunity.priceChangePercent = ((currentPrice - opportunity.entryPrice) / opportunity.entryPrice) * 100;
    opportunity.tvlChangePercent = ((currentTVL - opportunity.baselineTVL) / opportunity.baselineTVL) * 100;
    opportunity.lastUpdate = Date.now();

    // Check exit conditions
    this.checkExitConditions(opportunity);
  }

  private checkExitConditions(opportunity: ArbitrageOpportunity) {
    const now = Date.now();
    const timeSinceEntry = now - opportunity.entryTime;

    // Check take profit
    if (opportunity.currentPrice >= opportunity.exitStrategy.takeProfit) {
      this.executeExit(opportunity, 'take_profit', `Price reached take profit target: ${opportunity.currentPrice.toFixed(8)} SOL`);
      return;
    }

    // Check stop loss
    if (opportunity.currentPrice <= opportunity.exitStrategy.stopLoss) {
      this.executeExit(opportunity, 'stop_loss', `Price hit stop loss: ${opportunity.currentPrice.toFixed(8)} SOL`);
      return;
    }

    // Check max hold time
    if (timeSinceEntry >= opportunity.exitStrategy.maxHoldTime) {
      this.executeExit(opportunity, 'timeout', `Max hold time exceeded: ${Math.round(timeSinceEntry / 1000 / 60)} minutes`);
      return;
    }

    // Check TVL exit threshold
    if (opportunity.currentTVL <= opportunity.exitStrategy.tvlExitThreshold) {
      this.executeExit(opportunity, 'tvl_drop', `TVL dropped below threshold: ${opportunity.currentTVL.toFixed(2)} SOL`);
      return;
    }

    // Log progress for monitoring
    if (opportunity.status === 'monitoring') {
      const profitPercent = opportunity.priceChangePercent;
      const timeElapsed = Math.round(timeSinceEntry / 1000 / 60);
      
      if (profitPercent >= 10) {
        this.logger.log(`📈 OPPORTUNITY PROGRESS: ${opportunity.poolId} | +${profitPercent.toFixed(2)}% profit | ${timeElapsed}m elapsed`);
      }
    }
  }

  private executeExit(opportunity: ArbitrageOpportunity, reason: string, message: string) {
    opportunity.status = 'exited';
    
    const profitPercent = opportunity.priceChangePercent;
    const timeElapsed = Math.round((Date.now() - opportunity.entryTime) / 1000 / 60);
    
    this.logger.log(`🎯 ARBITRAGE EXIT: ${opportunity.poolId} | ${reason.toUpperCase()}`);
    this.logger.log(`📊 Final Result: ${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}% profit in ${timeElapsed} minutes`);
    this.logger.log(`💰 Entry: ${opportunity.entryPrice.toFixed(8)} SOL → Exit: ${opportunity.currentPrice.toFixed(8)} SOL`);
    this.logger.log(`📈 TVL Change: ${opportunity.tvlChangePercent >= 0 ? '+' : ''}${opportunity.tvlChangePercent.toFixed(2)}%`);
    this.logger.log(`💡 Reason: ${message}`);

    // Emit exit event
    this.eventEmitter.emit('arbitrage_exit', {
      poolId: opportunity.poolId,
      reason,
      profitPercent,
      timeElapsed,
      entryPrice: opportunity.entryPrice,
      exitPrice: opportunity.currentPrice,
      message
    });

    // Remove from tracking
    this.opportunities.delete(opportunity.poolId);
  }

  private calculateConfidence(data: any, pattern: ArbitragePattern): 'high' | 'medium' | 'low' {
    const {
      currentPrice,
      baselinePrice,
      currentTVL,
      baselineTVL,
      reserveRatio
    } = data;

    const priceChangePercent = ((currentPrice - baselinePrice) / baselinePrice) * 100;
    const tvlChangePercent = ((currentTVL - baselineTVL) / baselineTVL) * 100;

    let score = 0;

    // Price increase score
    if (priceChangePercent >= pattern.conditions.minPriceIncrease * 2) score += 2;
    else if (priceChangePercent >= pattern.conditions.minPriceIncrease) score += 1;

    // TVL increase score
    if (tvlChangePercent >= pattern.conditions.minTVLIncrease * 2) score += 2;
    else if (tvlChangePercent >= pattern.conditions.minTVLIncrease) score += 1;

    // TVL size score
    if (baselineTVL >= pattern.conditions.minBaselineTVL * 2) score += 2;
    else if (baselineTVL >= pattern.conditions.minBaselineTVL) score += 1;

    // Ratio score (lower is better)
    if (reserveRatio <= pattern.conditions.maxRatio * 0.5) score += 2;
    else if (reserveRatio <= pattern.conditions.maxRatio) score += 1;

    if (score >= 6) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }

  // Public methods
  getActiveOpportunities(): ArbitrageOpportunity[] {
    return Array.from(this.opportunities.values()).filter(opp => opp.status === 'monitoring');
  }

  getOpportunityStats() {
    const opportunities = Array.from(this.opportunities.values());
    const active = opportunities.filter(opp => opp.status === 'monitoring').length;
    const highConfidence = opportunities.filter(opp => opp.confidence === 'high').length;
    const mediumConfidence = opportunities.filter(opp => opp.confidence === 'medium').length;
    const lowConfidence = opportunities.filter(opp => opp.confidence === 'low').length;

    return {
      total: opportunities.length,
      active,
      confidenceBreakdown: {
        high: highConfidence,
        medium: mediumConfidence,
        low: lowConfidence
      },
      patterns: this.patterns.map(p => p.name)
    };
  }

  forceExit(poolId: string, reason: string = 'manual') {
    const opportunity = this.opportunities.get(poolId);
    if (opportunity) {
      this.executeExit(opportunity, reason, `Manual exit: ${reason}`);
    }
  }
} 