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
    minPriceIncrease: number; // 5% minimum price increase
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
  totalInvestment: number; // 1.0 SOL total investment
  firstHalfAmount: number; // 0.5 SOL for first exit
  secondHalfAmount: number; // 0.5 SOL for second exit
  
  // Exit tracking
  firstHalfExited: boolean;
  secondHalfExited: boolean;
  firstExitPrice: number;
  secondExitPrice: number;
  
  // Status
  status: 'monitoring' | 'entered' | 'partial_exit' | 'exited' | 'stopped';
  exitReason: string;
  
  // Performance tracking
  totalPnL: number;
  totalPnLPercent: number;
  firstHalfPnL: number;
  secondHalfPnL: number;
  
  // Paper trading tracking
  paperTradeId?: string;
  tokensPurchased?: number;
  firstHalfTokens?: number;
  secondHalfTokens?: number;
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
    maxPositions: 3,
    paperTrading: {
      enabled: true,
      initialBalance: 10.0, // 10 SOL starting balance
      successRate: 0.95, // 95% success rate
    },
    entryConditions: {
      minPriceIncrease: 5, // 5% minimum price increase
      minTVLIncrease: 10, // 10% minimum TVL increase
      maxPoolAge: 30, // 30 minutes max pool age
      minBaselineTVL: 10, // 10 SOL minimum baseline TVL
    },
    exitConditions: {
      takeProfitPercent: 25, // 25% take profit
      stopLossPercent: 15, // 15% stop loss
      maxHoldTime: 60, // 60 minutes max hold
      tvlExitThreshold: -20, // -20% TVL drop threshold
      partialExitPercent: 50, // 50% at 15% profit
    },
    riskManagement: {
      maxDailyLoss: 2.0,
      maxConcurrentPositions: 3,
      minLiquidity: 5.0,
      maxPriceImpact: 2,
    },
  };

  private activePositions: Map<string, EarlyPosition> = new Map();
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
    
    // Check entry conditions
    const meetsPriceCondition = priceChangePercent >= this.config.entryConditions.minPriceIncrease;
    const meetsTVLCondition = tvlChangePercent >= this.config.entryConditions.minTVLIncrease;
    const meetsTVLThreshold = baselineTVL >= this.config.entryConditions.minBaselineTVL;
    
    if (meetsPriceCondition && meetsTVLCondition && meetsTVLThreshold) {
      this.logger.log(`🎯 Pool ${poolId} meets early entry conditions:`);
      this.logger.log(`   Price increase: ${priceChangePercent.toFixed(2)}% (min: ${this.config.entryConditions.minPriceIncrease}%)`);
      this.logger.log(`   TVL increase: ${tvlChangePercent.toFixed(2)}% (min: ${this.config.entryConditions.minTVLIncrease}%)`);
      this.logger.log(`   Baseline TVL: ${baselineTVL.toFixed(2)} SOL (min: ${this.config.entryConditions.minBaselineTVL} SOL)`);
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
    
    // Execute paper buy trade
    const buyResult = this.executePaperBuy(poolId, currentPrice, this.config.positionSize);
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
      totalInvestment: this.config.positionSize,
      firstHalfAmount: this.config.positionSize * 0.5,
      secondHalfAmount: this.config.positionSize * 0.5,
      
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
    };

    this.activePositions.set(poolId, position);
    
    this.logger.log(`🚀 ENTERED EARLY POSITION: ${poolId}`);
    this.logger.log(`💰 Investment: ${this.config.positionSize} SOL`);
    this.logger.log(`📊 Entry Price: ${currentPrice.toFixed(8)} SOL`);
    this.logger.log(`📈 Baseline TVL: ${baselineTVL.toFixed(2)} SOL`);
    this.logger.log(`🎯 Take Profit: ${(currentPrice * (1 + this.config.exitConditions.takeProfitPercent / 100)).toFixed(8)} SOL (+${this.config.exitConditions.takeProfitPercent}%)`);
    this.logger.log(`🛑 Stop Loss: ${(currentPrice * (1 - this.config.exitConditions.stopLossPercent / 100)).toFixed(8)} SOL (-${this.config.exitConditions.stopLossPercent}%)`);
    this.logger.log(`⏰ Max Hold Time: ${this.config.exitConditions.maxHoldTime} minutes`);
    this.logger.log(`📊 Paper Trade: ${buyResult.tokens.toFixed(2)} tokens purchased for ${this.config.positionSize} SOL`);
    this.logger.log(`💰 Portfolio Balance: ${this.paperPortfolio.balance.toFixed(4)} SOL`);
    
    // Emit position entered event
    this.eventEmitter.emit('early_position_entered', {
      position_id: position.id,
      pool_id: poolId,
      entry_price: currentPrice,
      amount: this.config.positionSize,
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
    
    // Check partial exit (50% at 15% profit)
    if (!position.firstHalfExited && priceChangePercent >= 15) {
      this.executePartialExit(position, 'take_profit_partial', '15% profit target reached');
      return;
    }
    
    // Check full take profit (25% profit)
    if (priceChangePercent >= this.config.exitConditions.takeProfitPercent) {
      this.executeFullExit(position, 'take_profit', `${this.config.exitConditions.takeProfitPercent}% profit target reached`);
      return;
    }
    
    // Check stop loss (15% loss)
    if (priceChangePercent <= -this.config.exitConditions.stopLossPercent) {
      this.executeFullExit(position, 'stop_loss', `${this.config.exitConditions.stopLossPercent}% stop loss triggered`);
      return;
    }
    
    // Check max hold time (60 minutes)
    if (timeSinceEntry >= this.config.exitConditions.maxHoldTime * 60 * 1000) {
      this.executeFullExit(position, 'timeout', `Max hold time of ${this.config.exitConditions.maxHoldTime} minutes exceeded`);
      return;
    }
    
    // Check TVL exit threshold (-20% TVL drop)
    if (tvlChangePercent <= this.config.exitConditions.tvlExitThreshold) {
      this.executeFullExit(position, 'tvl_drop', `TVL dropped ${Math.abs(tvlChangePercent).toFixed(2)}% below threshold`);
      return;
    }
    
    // Log progress for monitoring
    if (priceChangePercent >= 10) {
      const timeElapsed = Math.round(timeSinceEntry / 1000 / 60);
      this.logger.log(`📈 EARLY POSITION PROGRESS: ${position.poolId} | +${priceChangePercent.toFixed(2)}% profit | ${timeElapsed}m elapsed`);
    }
  }

  private executePartialExit(position: EarlyPosition, reason: string, message: string) {
    // Execute paper sell for first half
    const sellResult = this.executePaperSell(position.poolId, position.currentPrice, position.firstHalfAmount, true);
    if (!sellResult.success) {
      this.logger.error(`❌ Paper partial sell failed for pool ${position.poolId}: ${sellResult.error}`);
      return;
    }

    position.firstHalfExited = true;
    position.firstExitPrice = position.currentPrice;
    position.status = 'partial_exit';
    
    const firstHalfPnL = sellResult.pnl || 0;
    const firstHalfPnLPercent = ((position.firstExitPrice - position.entryPrice) / position.entryPrice) * 100;
    
    position.firstHalfPnL = firstHalfPnL;
    position.totalPnL = firstHalfPnL;
    
    this.logger.log(`🎯 PARTIAL EXIT: ${position.poolId} | ${reason.toUpperCase()}`);
    this.logger.log(`📊 First Half Result: +${firstHalfPnLPercent.toFixed(2)}% profit`);
    this.logger.log(`💰 First Half PnL: +${firstHalfPnL.toFixed(4)} SOL`);
    this.logger.log(`💡 Reason: ${message}`);
    this.logger.log(`📈 Remaining: ${position.secondHalfAmount} SOL still in position`);
    this.logger.log(`📊 Paper Trade: ${sellResult.tokens?.toFixed(2)} tokens sold for ${(sellResult.tokens || 0) * position.currentPrice} SOL`);
    this.logger.log(`💰 Portfolio Balance: ${this.paperPortfolio.balance.toFixed(4)} SOL`);
    this.logger.log(`📈 Total Portfolio PnL: ${this.paperPortfolio.totalPnL.toFixed(4)} SOL`);
    
    // Emit partial exit event
    this.eventEmitter.emit('early_position_partial_exit', {
      position_id: position.id,
      pool_id: position.poolId,
      exit_price: position.firstExitPrice,
      pnl: firstHalfPnL,
      pnl_percentage: firstHalfPnLPercent,
      reason,
      remaining_amount: position.secondHalfAmount,
      timestamp: Date.now()
    });
  }

  private executeFullExit(position: EarlyPosition, reason: string, message: string) {
    // Execute paper sell for remaining position
    const remainingAmount = position.firstHalfExited ? position.secondHalfAmount : position.totalInvestment;
    const sellResult = this.executePaperSell(position.poolId, position.currentPrice, remainingAmount, position.firstHalfExited);
    if (!sellResult.success) {
      this.logger.error(`❌ Paper full sell failed for pool ${position.poolId}: ${sellResult.error}`);
      return;
    }

    position.status = 'exited';
    position.exitReason = reason;
    
    // Calculate final PnL
    let totalPnL = 0;
    let totalPnLPercent = 0;
    
    if (position.firstHalfExited) {
      // Partial exit already happened
      const secondHalfPnL = sellResult.pnl || 0;
      const secondHalfPnLPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
      
      position.secondHalfPnL = secondHalfPnL;
      position.secondExitPrice = position.currentPrice;
      position.totalPnL = position.firstHalfPnL + secondHalfPnL;
      position.totalPnLPercent = ((position.firstHalfPnL + secondHalfPnL) / position.totalInvestment) * 100;
      
      totalPnL = position.totalPnL;
      totalPnLPercent = position.totalPnLPercent;
    } else {
      // Full exit
      totalPnL = sellResult.pnl || 0;
      totalPnLPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
      
      position.totalPnL = totalPnL;
      position.totalPnLPercent = totalPnLPercent;
    }
    
    const timeElapsed = Math.round((Date.now() - position.entryTime) / 1000 / 60);
    
    this.logger.log(`🎯 FULL EXIT: ${position.poolId} | ${reason.toUpperCase()}`);
    this.logger.log(`📊 Final Result: ${totalPnLPercent >= 0 ? '+' : ''}${totalPnLPercent.toFixed(2)}% profit in ${timeElapsed} minutes`);
    this.logger.log(`💰 Total PnL: ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(4)} SOL`);
    this.logger.log(`💡 Reason: ${message}`);
    this.logger.log(`📊 Paper Trade: ${sellResult.tokens?.toFixed(2)} tokens sold for ${(sellResult.tokens || 0) * position.currentPrice} SOL`);
    this.logger.log(`💰 Portfolio Balance: ${this.paperPortfolio.balance.toFixed(4)} SOL`);
    this.logger.log(`📈 Total Portfolio PnL: ${this.paperPortfolio.totalPnL.toFixed(4)} SOL`);
    
    // Update daily stats
    this.dailyStats.totalTrades++;
    this.dailyStats.successfulTrades++;
    this.dailyStats.totalPnL += totalPnL;
    
    if (totalPnL < 0) {
      this.dailyStats.dailyLoss += Math.abs(totalPnL);
    }
    
    // Emit full exit event
    this.eventEmitter.emit('early_position_exited', {
      position_id: position.id,
      pool_id: position.poolId,
      exit_price: position.currentPrice,
      pnl: totalPnL,
      pnl_percentage: totalPnLPercent,
      reason,
      time_elapsed: timeElapsed,
      timestamp: Date.now()
    });
    
    // Remove from active positions
    this.activePositions.delete(position.poolId);
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
    this.paperPortfolio = {
      balance: this.config.paperTrading.initialBalance,
      positions: new Map(),
      trades: [],
      totalPnL: 0,
      totalTrades: 0,
      successfulTrades: 0,
    };
    this.logger.log(`🔄 Paper trading portfolio reset to ${this.config.paperTrading.initialBalance} SOL`);
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
      activePositions: this.paperPortfolio.positions.size,
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
        activePositions: paperPortfolio.activePositions,
      },
    };
    
    const status = dailyStats.dailyLoss >= this.config.riskManagement.maxDailyLoss ? 'stopped' : 'active';
    
    return { status, stats };
  }
} 