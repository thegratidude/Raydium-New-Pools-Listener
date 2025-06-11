import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PositionManagerService } from './position-manager.service';

interface EarlyTradingConfig {
  enabled: boolean;
  positionSize: number; // 1.0 SOL
  maxPositions: number; // 3 positions max
  paperTrading: {
    enabled: boolean;
    initialBalance: number; // 10 SOL starting balance
    successRate: number; // 95% success rate for paper trades
  };
  entryConditions: {
    minPriceIncrease: number; // 3% minimum price increase (reduced from 5%)
    minTVLIncrease: number; // 10% minimum TVL increase
    maxPoolAge: number; // 30 minutes max pool age
    minBaselineTVL: number; // 10 SOL minimum baseline TVL
  };
  exitConditions: {
    takeProfitPercent: number; // 25% take profit
    stopLossPercent: number; // 15% stop loss
    maxHoldTime: number; // 60 minutes max hold
    tvlExitThreshold: number; // -20% TVL drop threshold
    partialExitPercent: number; // 50% at 15% profit
    trailingStopLoss: {
      enabled: boolean; // Enable trailing stop loss
      activationPercent: number; // Activate trailing stop when profit reaches this % (e.g., 3%)
      trailingDistance: number; // Distance behind current price (e.g., 2%)
      breakevenLock: number; // Move to breakeven at this profit % (e.g., 8%)
    };
  };
  riskManagement: {
    maxDailyLoss: number; // 2.0 SOL daily loss limit
    maxConcurrentPositions: number; // 3 max concurrent
    minLiquidity: number; // 5.0 SOL minimum liquidity
    maxPriceImpact: number; // 2% maximum price impact
  };
}

interface EarlyPosition {
  id: string;
  poolId: string;
  entryPrice: number;
  currentPrice: number;
  baselinePrice: number;
  baselineTVL: number;
  currentTVL: number;
  entryTime: number;
  lastUpdate: number;
  
  // Position sizing
  totalInvestment: number;
  firstHalfAmount: number;
  secondHalfAmount: number;
  
  // Exit tracking
  firstHalfExited: boolean;
  secondHalfExited: boolean;
  firstExitPrice: number;
  secondExitPrice: number;
  
  // Status
  status: 'entered' | 'exited' | 'stopped';
  exitReason: string;
  
  // Performance tracking
  totalPnL: number;
  totalPnLPercent: number;
  firstHalfPnL: number;
  secondHalfPnL: number;
  
  // Paper trading tracking
  paperTradeId: string;
  tokensPurchased: number;
  firstHalfTokens: number;
  secondHalfTokens: number;
  
  // Progress logging
  lastProgressLog: number;
  
  // Re-entry tracking
  isReEntry: boolean;
  originalEntryTime: number;
  reEntryCount: number;
  
  // Trailing stop loss tracking
  trailingStopActive: boolean;
  trailingStopPrice: number;
  highestPrice: number;
  highestPriceTime: number;
}

interface PoolReEntryTracker {
  poolId: string;
  successfulExits: number;
  lastExitTime: number;
  lastExitPrice: number;
  lastExitReason: string;
  reEntryCount: number;
  maxReEntries: number;
  originalEntryTime: number;
}

export interface PaperTrade {
  id: string;
  poolId: string;
  type: 'buy' | 'sell' | 'partial_sell';
  price: number;
  amount: number;
  tokens?: number;
  timestamp: number;
  success: boolean;
  error?: string;
}

interface PaperPortfolio {
  balance: number; // SOL balance
  positions: Map<string, {
    poolId: string;
    tokens: number;
    entryPrice: number;
    entryAmount: number;
    entryTime: number;
  }>;
  trades: PaperTrade[];
  totalPnL: number;
  totalTrades: number;
  successfulTrades: number;
}

@Injectable()
export class EarlyTradingStrategyService implements OnModuleInit {
  private readonly logger = new Logger(EarlyTradingStrategyService.name);
  
  private config: EarlyTradingConfig = {
    enabled: true,
    positionSize: 1.0,
    maxPositions: 5,
    paperTrading: {
      enabled: true,
      initialBalance: 10.0, // 10 SOL starting balance
      successRate: 0.95, // 95% success rate
    },
    entryConditions: {
      minPriceIncrease: 3, // 3% minimum price increase (reduced from 5%)
      minTVLIncrease: 10, // 10% minimum TVL increase
      maxPoolAge: 30, // 30 minutes max pool age
      minBaselineTVL: 10, // 10 SOL minimum baseline TVL
    },
    exitConditions: {
      takeProfitPercent: 25, // 25% take profit
      stopLossPercent: 8, // 8% stop loss (tighter than 10%)
      maxHoldTime: 60, // 60 minutes max hold
      tvlExitThreshold: -20, // -20% TVL drop threshold
      partialExitPercent: 50, // 50% at 15% profit
      trailingStopLoss: {
        enabled: true, // Enable trailing stop loss
        activationPercent: 2, // Activate trailing stop when profit reaches 2% (down from 3%)
        trailingDistance: 1.5, // Distance behind current price (1.5% down from 2%)
        breakevenLock: 6, // Move to breakeven at 6% profit (down from 8%)
      },
    },
    riskManagement: {
      maxDailyLoss: 2.0,
      maxConcurrentPositions: 3,
      minLiquidity: 5.0,
      maxPriceImpact: 2,
    },
  };

  private activePositions: Map<string, EarlyPosition> = new Map();
  private poolReEntryTrackers: Map<string, PoolReEntryTracker> = new Map();
  private paperPortfolio: PaperPortfolio = {
    balance: 10.0, // Start with 10 SOL
    positions: new Map(),
    trades: [],
    totalPnL: 0,
    totalTrades: 0,
    successfulTrades: 0,
  };
  private dailyStats = {
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalPnL: 0,
    dailyLoss: 0,
    lastReset: Date.now(),
  };

  constructor(
    private readonly positionManager: PositionManagerService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Initializing Early Trading Strategy Service...');
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Start background monitoring
    this.startBackgroundMonitoring();
    
    this.logger.log('✅ Early Trading Strategy Service initialized');
    this.logger.log(`💰 Paper Trading Portfolio: ${this.paperPortfolio.balance.toFixed(4)} SOL balance`);
  }

  private setupEventListeners() {
    // Listen for pool metrics updates
    this.eventEmitter.on('pool_metrics_update', this.handlePoolMetricsUpdate.bind(this));
    
    // Listen for arbitrage opportunities
    this.eventEmitter.on('arbitrage_opportunity', this.handleArbitrageOpportunity.bind(this));
    
    // Listen for rug detection events
    this.eventEmitter.on('rug_detected', this.handleRugDetection.bind(this));
  }

  private startBackgroundMonitoring() {
    // Monitor positions every 10 seconds for early trading
    setInterval(() => {
      this.monitorActivePositions();
    }, 10000);

    // Reset daily stats every 24 hours
    setInterval(() => {
      this.resetDailyStats();
    }, 24 * 60 * 60 * 1000);
  }

  private handlePoolMetricsUpdate(data: any) {
    const { poolId, currentPrice, baselinePrice, currentTVL, baselineTVL, priceChangePercent, tvlChangePercent } = data;
    
    // Check if this pool meets early entry conditions
    if (this.shouldEnterEarlyPosition(data)) {
      this.enterEarlyPosition(poolId, data);
    }
    
    // Update existing positions
    const position = this.activePositions.get(poolId);
    if (position) {
      this.updatePosition(position, data);
    }
  }

  private handleArbitrageOpportunity(data: any) {
    const { poolId, confidence, priceChangePercent } = data;
    
    // Only enter if we have high confidence and meet our criteria
    if (confidence === 'high' && priceChangePercent >= this.config.entryConditions.minPriceIncrease) {
      this.logger.log(`🎯 High confidence arbitrage opportunity for pool ${poolId}: ${priceChangePercent.toFixed(2)}% price increase`);
      
      // Check if we can take a position
      if (this.canTakeNewPosition()) {
        this.enterEarlyPosition(poolId, data);
      }
    }
  }

  private handleRugDetection(data: any) {
    const { pool_id, reason, timestamp, baseline_tvl, baseline_price, last_tvl, last_price } = data;
    
    this.logger.log(`🚨 RUG DETECTED: Pool ${pool_id} - Immediate position exit required`);
    this.logger.log(`   Reason: ${reason}`);
    this.logger.log(`   Baseline TVL: ${baseline_tvl.toFixed(2)} SOL`);
    this.logger.log(`   Last TVL: ${last_tvl.toFixed(2)} SOL`);
    this.logger.log(`   Baseline Price: ${baseline_price.toFixed(8)} SOL`);
    this.logger.log(`   Last Price: ${last_price.toFixed(8)} SOL`);
    
    // Check if we have an active position in this pool
    const position = this.activePositions.get(pool_id);
    if (!position) {
      this.logger.log(`ℹ️ No active position found for pool ${pool_id}`);
      return;
    }
    
    // Immediately exit the position
    this.logger.log(`🚨 EMERGENCY EXIT: Exiting position for rugged pool ${pool_id}`);
    this.executeFullExit(position, 'rug_detection', `Rug detected - TVL dropped below threshold. Baseline: ${baseline_tvl.toFixed(2)} SOL, Last: ${last_tvl.toFixed(2)} SOL`);
    
    // Remove from active positions
    this.activePositions.delete(pool_id);
    
    // Update daily stats
    this.dailyStats.failedTrades++;
    
    this.logger.log(`✅ Emergency exit completed for pool ${pool_id}`);
  }

  private shouldEnterEarlyPosition(data: any): boolean {
    const { poolId, priceChangePercent, tvlChangePercent, baselineTVL } = data;
    
    // Check if we already have a position
    if (this.activePositions.has(poolId)) {
      return false;
    }
    
    // Check if we can take a new position
    if (!this.canTakeNewPosition()) {
      return false;
    }
    
    // Check re-entry eligibility
    const reEntryTracker = this.poolReEntryTrackers.get(poolId);
    if (reEntryTracker && reEntryTracker.reEntryCount >= reEntryTracker.maxReEntries) {
      this.logger.log(`🚫 Pool ${poolId} has reached maximum re-entries (${reEntryTracker.maxReEntries})`);
      return false;
    }
    
    // Check entry conditions
    const meetsPriceCondition = priceChangePercent >= this.config.entryConditions.minPriceIncrease;
    const meetsTVLCondition = tvlChangePercent >= this.config.entryConditions.minTVLIncrease;
    const meetsTVLThreshold = baselineTVL >= this.config.entryConditions.minBaselineTVL;
    
    if (meetsPriceCondition && meetsTVLCondition && meetsTVLThreshold) {
      this.logger.log(`🎯 Pool ${poolId} meets early entry conditions:`);
      this.logger.log(`   Price increase: ${priceChangePercent.toFixed(2)}% (min: ${this.config.entryConditions.minPriceIncrease}%)`);
      this.logger.log(`   TVL increase: ${tvlChangePercent.toFixed(2)}% (min: ${this.config.entryConditions.minTVLIncrease}%)`);
      this.logger.log(`   Baseline TVL: ${baselineTVL.toFixed(2)} SOL (min: ${this.config.entryConditions.minBaselineTVL} SOL)`);
      
      // Log re-entry status if applicable
      if (reEntryTracker) {
        this.logger.log(`   🔄 Re-entry #${reEntryTracker.reEntryCount + 1} (max: ${reEntryTracker.maxReEntries})`);
      }
      
      return true;
    }
    
    return false;
  }

  private canTakeNewPosition(): boolean {
    // Check max positions
    if (this.activePositions.size >= this.config.maxPositions) {
      return false;
    }
    
    // Check daily loss limit
    if (this.dailyStats.dailyLoss >= this.config.riskManagement.maxDailyLoss) {
      return false;
    }
    
    return true;
  }

  private enterEarlyPosition(poolId: string, data: any) {
    const { currentPrice, baselinePrice, currentTVL, baselineTVL } = data;
    
    // Check if this is a re-entry
    const reEntryTracker = this.poolReEntryTrackers.get(poolId);
    const isReEntry = reEntryTracker && reEntryTracker.successfulExits > 0;
    
    // Determine position size and exit conditions based on re-entry status
    let positionSize: number;
    let takeProfitPercent: number;
    let stopLossPercent: number;
    let maxHoldTime: number;
    
    if (isReEntry) {
      // Re-entry rules: 20% take profit, 6% stop loss, 15min max hold
      positionSize = 0.5;
      takeProfitPercent = 20;
      stopLossPercent = 6;
      maxHoldTime = 15 * 60 * 1000; // 15 minutes
      
      // Increment re-entry count
      reEntryTracker.reEntryCount++;
      
      this.logger.log(`🔄 RE-ENTRY DETECTED: Pool ${poolId} (Re-entry #${reEntryTracker.reEntryCount})`);
      this.logger.log(`   Previous exits: ${reEntryTracker.successfulExits} successful`);
      this.logger.log(`   Last exit: ${reEntryTracker.lastExitReason} at ${reEntryTracker.lastExitPrice.toFixed(8)} SOL`);
    } else {
      // First entry rules: 25% take profit, 8% stop loss, 30min max hold
      positionSize = this.config.positionSize;
      takeProfitPercent = 25;
      stopLossPercent = 8;
      maxHoldTime = 30 * 60 * 1000; // 30 minutes
    }
    
    // Execute paper buy trade
    const buyResult = this.executePaperBuy(poolId, currentPrice, positionSize);
    if (!buyResult.success) {
      this.logger.error(`❌ Paper buy failed for pool ${poolId}: ${buyResult.error}`);
      return;
    }
    
    const position: EarlyPosition = {
      id: `early_${poolId}_${Date.now()}`,
      poolId,
      entryPrice: currentPrice,
      currentPrice,
      baselinePrice,
      baselineTVL,
      currentTVL,
      entryTime: Date.now(),
      lastUpdate: Date.now(),
      
      // Position sizing
      totalInvestment: positionSize,
      firstHalfAmount: positionSize * 0.5,
      secondHalfAmount: positionSize * 0.5,
      
      // Exit tracking
      firstHalfExited: false,
      secondHalfExited: false,
      firstExitPrice: 0,
      secondExitPrice: 0,
      
      // Status
      status: 'entered',
      exitReason: '',
      
      // Performance tracking
      totalPnL: 0,
      totalPnLPercent: 0,
      firstHalfPnL: 0,
      secondHalfPnL: 0,
      
      // Paper trading tracking
      paperTradeId: buyResult.tradeId,
      tokensPurchased: buyResult.tokens,
      firstHalfTokens: buyResult.tokens * 0.5,
      secondHalfTokens: buyResult.tokens * 0.5,
      
      // Progress logging
      lastProgressLog: Date.now(),
      
      // Re-entry tracking
      isReEntry,
      originalEntryTime: isReEntry ? reEntryTracker.originalEntryTime || Date.now() : Date.now(),
      reEntryCount: isReEntry ? reEntryTracker.reEntryCount : 0,
      
      // Trailing stop loss tracking
      trailingStopActive: false,
      trailingStopPrice: 0,
      highestPrice: 0,
      highestPriceTime: 0,
    };

    this.activePositions.set(poolId, position);
    
    this.logger.log(`🚀 ENTERED EARLY POSITION: ${poolId}${isReEntry ? ' (RE-ENTRY)' : ''}`);
    this.logger.log(`💰 Investment: ${positionSize} SOL${isReEntry ? ' (reduced size)' : ''}`);
    this.logger.log(`📊 Entry Price: ${currentPrice.toFixed(8)} SOL`);
    this.logger.log(`📈 Baseline TVL: ${baselineTVL.toFixed(2)} SOL`);
    this.logger.log(`🎯 Take Profit: ${(currentPrice * (1 + takeProfitPercent / 100)).toFixed(8)} SOL (+${takeProfitPercent}%)`);
    this.logger.log(`🛑 Stop Loss: ${(currentPrice * (1 - stopLossPercent / 100)).toFixed(8)} SOL (-${stopLossPercent}%)`);
    this.logger.log(`⏰ Max Hold Time: ${maxHoldTime} minutes`);
    this.logger.log(`📊 Paper Trade: ${buyResult.tokens.toFixed(2)} tokens purchased for ${positionSize} SOL`);
    this.logger.log(`💰 Portfolio Balance: ${this.paperPortfolio.balance.toFixed(4)} SOL`);
    
    // Emit position entered event
    this.eventEmitter.emit('early_position_entered', {
      position_id: position.id,
      pool_id: poolId,
      entry_price: currentPrice,
      amount: positionSize,
      is_re_entry: isReEntry,
      timestamp: Date.now()
    });
  }

  private executePaperBuy(poolId: string, price: number, amount: number): { success: boolean; tradeId?: string; tokens?: number; error?: string } {
    try {
      // Check if we have enough balance
      if (this.paperPortfolio.balance < amount) {
        return { success: false, error: `Insufficient balance: ${this.paperPortfolio.balance.toFixed(4)} SOL < ${amount} SOL` };
      }

      // Simulate trade success/failure
      const success = Math.random() <= this.config.paperTrading.successRate;
      if (!success) {
        return { success: false, error: 'Simulated trade failure' };
      }

      // Calculate tokens purchased
      const tokens = amount / price;
      
      // Update portfolio
      this.paperPortfolio.balance -= amount;
      this.paperPortfolio.positions.set(poolId, {
        poolId,
        tokens,
        entryPrice: price,
        entryAmount: amount,
        entryTime: Date.now(),
      });

      // Record trade
      const tradeId = `paper_buy_${poolId}_${Date.now()}`;
      const trade: PaperTrade = {
        id: tradeId,
        poolId,
        type: 'buy',
        price,
        amount,
        tokens,
        timestamp: Date.now(),
        success: true,
      };
      
      this.paperPortfolio.trades.push(trade);
      this.paperPortfolio.totalTrades++;
      this.paperPortfolio.successfulTrades++;

      return { success: true, tradeId, tokens };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  private executePaperSell(poolId: string, price: number, amount: number, isPartial: boolean = false): { success: boolean; tradeId?: string; tokens?: number; pnl?: number; error?: string } {
    try {
      const position = this.paperPortfolio.positions.get(poolId);
      if (!position) {
        return { success: false, error: `No position found for pool ${poolId}` };
      }

      // Calculate tokens to sell
      const tokensToSell = isPartial ? position.tokens * 0.5 : position.tokens;
      const solValue = tokensToSell * price;
      
      // Calculate PnL
      const pnl = (price - position.entryPrice) * tokensToSell;

      // Simulate trade success/failure
      const success = Math.random() <= this.config.paperTrading.successRate;
      if (!success) {
        return { success: false, error: 'Simulated trade failure' };
      }

      // Update portfolio
      this.paperPortfolio.balance += solValue;
      this.paperPortfolio.totalPnL += pnl;

      if (isPartial) {
        // Partial exit - reduce position
        position.tokens -= tokensToSell;
      } else {
        // Full exit - remove position
        this.paperPortfolio.positions.delete(poolId);
      }

      // Record trade
      const tradeId = `paper_sell_${poolId}_${Date.now()}`;
      const trade: PaperTrade = {
        id: tradeId,
        poolId,
        type: isPartial ? 'partial_sell' : 'sell',
        price,
        amount: solValue,
        tokens: tokensToSell,
        timestamp: Date.now(),
        success: true,
      };
      
      this.paperPortfolio.trades.push(trade);
      this.paperPortfolio.totalTrades++;
      this.paperPortfolio.successfulTrades++;

      return { success: true, tradeId, tokens: tokensToSell, pnl };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  private updatePosition(position: EarlyPosition, data: any) {
    const { currentPrice, currentTVL } = data;
    
    position.currentPrice = currentPrice;
    position.currentTVL = currentTVL;
    position.lastUpdate = Date.now();
    
    // Calculate current PnL
    const priceChangePercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    position.totalPnLPercent = priceChangePercent;
    
    // Check exit conditions
    this.checkExitConditions(position);
  }

  private checkExitConditions(position: EarlyPosition) {
    const now = Date.now();
    const timeSinceEntry = now - position.entryTime;
    const priceChangePercent = position.totalPnLPercent;
    const tvlChangePercent = ((position.currentTVL - position.baselineTVL) / position.baselineTVL) * 100;
    
    // Update highest price for trailing stop loss
    if (position.currentPrice > position.highestPrice) {
      position.highestPrice = position.currentPrice;
      position.highestPriceTime = now;
    }
    
    // Determine exit conditions based on re-entry status
    let takeProfitPercent: number;
    let stopLossPercent: number;
    let maxHoldTime: number;
    
    if (position.isReEntry) {
      // Re-entry rules: 20% take profit, 6% stop loss, 15min max hold
      takeProfitPercent = 20;
      stopLossPercent = 6;
      maxHoldTime = 15 * 60 * 1000; // 15 minutes
    } else {
      // First entry rules: 25% take profit, 8% stop loss, 30min max hold
      takeProfitPercent = 25;
      stopLossPercent = 8;
      maxHoldTime = 30 * 60 * 1000; // 30 minutes
    }
    
    // Trailing stop loss logic
    if (this.config.exitConditions.trailingStopLoss.enabled) {
      const trailingConfig = this.config.exitConditions.trailingStopLoss;
      
      // Check if trailing stop should be activated
      if (!position.trailingStopActive && priceChangePercent >= trailingConfig.activationPercent) {
        position.trailingStopActive = true;
        const trailingStopPrice = position.currentPrice * (1 - trailingConfig.trailingDistance / 100);
        position.trailingStopPrice = trailingStopPrice;
        
        this.logger.log(`🎯 TRAILING STOP ACTIVATED: ${position.poolId} at ${priceChangePercent.toFixed(2)}% profit`);
        this.logger.log(`📊 Trailing stop price: ${trailingStopPrice.toFixed(8)} SOL (${trailingConfig.trailingDistance}% behind current)`);
      }
      
      // Update trailing stop if active and price is higher
      if (position.trailingStopActive && position.currentPrice > position.highestPrice) {
        const newTrailingStopPrice = position.currentPrice * (1 - trailingConfig.trailingDistance / 100);
        
        // Only move trailing stop up, never down
        if (newTrailingStopPrice > position.trailingStopPrice) {
          position.trailingStopPrice = newTrailingStopPrice;
          this.logger.log(`📈 TRAILING STOP UPDATED: ${position.poolId} to ${newTrailingStopPrice.toFixed(8)} SOL`);
        }
      }
      
      // Check breakeven lock
      if (position.trailingStopActive && priceChangePercent >= trailingConfig.breakevenLock) {
        const breakevenPrice = position.entryPrice;
        if (position.trailingStopPrice < breakevenPrice) {
          position.trailingStopPrice = breakevenPrice;
          this.logger.log(`🔒 BREAKEVEN LOCK: ${position.poolId} trailing stop moved to breakeven at ${breakevenPrice.toFixed(8)} SOL`);
        }
      }
      
      // Check trailing stop loss exit
      if (position.trailingStopActive && position.currentPrice <= position.trailingStopPrice) {
        const trailingStopPercent = ((position.trailingStopPrice - position.entryPrice) / position.entryPrice) * 100;
        this.executeFullExit(position, 'trailing_stop_loss', `Trailing stop loss triggered at ${trailingStopPercent.toFixed(2)}% profit`);
        return;
      }
    }
    
    // Check full take profit (no partial exits)
    if (priceChangePercent >= takeProfitPercent) {
      this.executeFullExit(position, 'take_profit', `${takeProfitPercent}% profit target reached`);
      return;
    }
    
    // Check stop loss (only if trailing stop is not active)
    if (!position.trailingStopActive && priceChangePercent <= -stopLossPercent) {
      this.executeFullExit(position, 'stop_loss', `${stopLossPercent}% stop loss triggered`);
      return;
    }
    
    // Check max hold time
    if (timeSinceEntry >= maxHoldTime) {
      this.executeFullExit(position, 'timeout', `Max hold time of ${maxHoldTime / 1000 / 60} minutes exceeded`);
      return;
    }
    
    // Check TVL exit threshold (-20% TVL drop)
    if (tvlChangePercent <= this.config.exitConditions.tvlExitThreshold) {
      this.executeFullExit(position, 'tvl_drop', `TVL dropped ${Math.abs(tvlChangePercent).toFixed(2)}% below threshold`);
      return;
    }
  }

  private executeFullExit(position: EarlyPosition, reason: string, message: string) {
    const currentPrice = position.currentPrice;
    const totalTokens = position.tokensPurchased;
    const totalValue = totalTokens * currentPrice;
    const totalPnL = totalValue - position.totalInvestment;
    const totalPnLPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // Execute paper sell
    const sellResult = this.executePaperSell(position.poolId, currentPrice, position.totalInvestment, false);
    if (!sellResult.success) {
      this.logger.error(`❌ Paper sell failed for pool ${position.poolId}: ${sellResult.error}`);
      return;
    }
    
    // Update position status
    position.status = 'exited';
    position.exitReason = reason;
    position.totalPnL = totalPnL;
    position.totalPnLPercent = totalPnLPercent;
    
    // Track successful exits for re-entry eligibility
    if (totalPnLPercent > 0) {
      this.trackSuccessfulExit(position.poolId, currentPrice, reason, totalPnLPercent);
    }
    
    this.logger.log(`🎯 FULL EXIT: ${position.poolId} | ${reason.toUpperCase()}`);
    this.logger.log(`📊 Final Result: ${totalPnLPercent.toFixed(2)}% profit in ${Math.round((Date.now() - position.entryTime) / 1000 / 60)} minutes`);
    this.logger.log(`💰 Total PnL: ${totalPnL.toFixed(4)} SOL`);
    this.logger.log(`💡 Reason: ${message}`);
    this.logger.log(`📊 Paper Trade: ${totalTokens.toFixed(2)} tokens sold for ${totalValue.toFixed(4)} SOL`);
    this.logger.log(`💰 Portfolio Balance: ${this.paperPortfolio.balance.toFixed(4)} SOL`);
    
    // Remove from active positions
    this.activePositions.delete(position.poolId);
    
    // Emit position exited event
    this.eventEmitter.emit('early_position_exited', {
      position_id: position.id,
      pool_id: position.poolId,
      exit_price: currentPrice,
      pnl: totalPnL,
      pnl_percentage: totalPnLPercent,
      reason,
      is_re_entry: position.isReEntry,
      re_entry_count: position.reEntryCount,
      timestamp: Date.now()
    });
    
    // If exit was due to stop loss, emit event to stop monitoring this pool
    if (reason === 'stop_loss') {
      this.logger.log(`🛑 STOP LOSS EXIT: Emitting stop monitoring event for pool ${position.poolId}`);
      this.eventEmitter.emit('stop_monitoring_pool', {
        pool_id: position.poolId,
        reason: 'stop_loss_exit',
        exit_price: currentPrice,
        pnl_percentage: totalPnLPercent,
        timestamp: Date.now()
      });
    }
  }
  
  private trackSuccessfulExit(poolId: string, exitPrice: number, exitReason: string, pnlPercent: number) {
    let tracker = this.poolReEntryTrackers.get(poolId);
    
    if (!tracker) {
      // Create new tracker for this pool
      tracker = {
        poolId,
        successfulExits: 0,
        lastExitTime: 0,
        lastExitPrice: 0,
        lastExitReason: '',
        reEntryCount: 0,
        maxReEntries: 1, // Only allow 1 re-entry per pool
        originalEntryTime: Date.now(),
      };
      this.poolReEntryTrackers.set(poolId, tracker);
    }
    
    // Update tracker
    tracker.successfulExits++;
    tracker.lastExitTime = Date.now();
    tracker.lastExitPrice = exitPrice;
    tracker.lastExitReason = exitReason;
    
    this.logger.log(`✅ SUCCESSFUL EXIT TRACKED: Pool ${poolId}`);
    this.logger.log(`   Successful exits: ${tracker.successfulExits}`);
    this.logger.log(`   Re-entries used: ${tracker.reEntryCount}/${tracker.maxReEntries}`);
    this.logger.log(`   PnL: +${pnlPercent.toFixed(2)}%`);
    
    // Log if pool is eligible for re-entry
    if (tracker.reEntryCount < tracker.maxReEntries) {
      this.logger.log(`   🔄 Pool eligible for re-entry (${tracker.maxReEntries - tracker.reEntryCount} remaining)`);
    } else {
      this.logger.log(`   🚫 Pool has reached maximum re-entries`);
    }
  }

  private monitorActivePositions() {
    // This is called every 10 seconds to monitor positions
    // The actual monitoring logic is in checkExitConditions
  }

  private resetDailyStats() {
    this.dailyStats = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalPnL: 0,
      dailyLoss: 0,
      lastReset: Date.now(),
    };
    this.logger.log('🔄 Daily stats reset');
  }

  public resetPaperPortfolio(): void {
    // Reset paper portfolio
    this.paperPortfolio = {
      balance: this.config.paperTrading.initialBalance,
      positions: new Map(),
      trades: [],
      totalPnL: 0,
      totalTrades: 0,
      successfulTrades: 0,
    };
    
    // Clear active positions
    this.activePositions.clear();
    
    // Clear re-entry trackers
    this.poolReEntryTrackers.clear();
    
    // Reset daily stats
    this.dailyStats = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalPnL: 0,
      dailyLoss: 0,
      lastReset: Date.now(),
    };
    
    this.logger.log(`🔄 Paper trading portfolio reset to ${this.config.paperTrading.initialBalance} SOL`);
    this.logger.log(`🔄 Cleared ${this.activePositions.size} active positions`);
    this.logger.log(`🔄 Cleared ${this.poolReEntryTrackers.size} re-entry trackers`);
  }

  // Public methods for status and configuration
  public getActivePositions(): EarlyPosition[] {
    return Array.from(this.activePositions.values());
  }

  public getDailyStats() {
    return this.dailyStats;
  }

  public getConfiguration(): EarlyTradingConfig {
    return this.config;
  }

  public getPaperPortfolio() {
    return {
      balance: this.paperPortfolio.balance,
      totalPnL: this.paperPortfolio.totalPnL,
      totalTrades: this.paperPortfolio.totalTrades,
      successfulTrades: this.paperPortfolio.successfulTrades,
      successRate: this.paperPortfolio.totalTrades > 0 ? (this.paperPortfolio.successfulTrades / this.paperPortfolio.totalTrades) * 100 : 0,
      activePositions: this.activePositions.size,
      recentTrades: this.paperPortfolio.trades.slice(-5), // Last 5 trades
    };
  }

  public updateConfiguration(updates: Partial<EarlyTradingConfig>): void {
    this.config = { ...this.config, ...updates };
    this.logger.log('📊 Early trading configuration updated');
  }

  public async getHealthStatus(): Promise<{ status: string; stats?: any }> {
    const activePositions = this.getActivePositions();
    const dailyStats = this.getDailyStats();
    const paperPortfolio = this.getPaperPortfolio();
    
    const stats = {
      activePositions: activePositions.length,
      maxPositions: this.config.maxPositions,
      dailyPnL: dailyStats.totalPnL,
      dailyLoss: dailyStats.dailyLoss,
      maxDailyLoss: this.config.riskManagement.maxDailyLoss,
      totalTrades: dailyStats.totalTrades,
      successRate: dailyStats.totalTrades > 0 ? (dailyStats.successfulTrades / dailyStats.totalTrades) * 100 : 0,
      paperTrading: {
        enabled: this.config.paperTrading.enabled,
        balance: paperPortfolio.balance,
        totalPnL: paperPortfolio.totalPnL,
        totalTrades: paperPortfolio.totalTrades,
        successRate: paperPortfolio.successRate,
        activePositions: this.activePositions.size,
      },
    };
    
    const status = dailyStats.dailyLoss >= this.config.riskManagement.maxDailyLoss ? 'stopped' : 'active';
    
    return { status, stats };
  }
} 