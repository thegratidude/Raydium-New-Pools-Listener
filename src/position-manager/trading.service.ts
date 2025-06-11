import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Status6Pool, PoolSnapshot } from './database/position-manager-db';
import { PositionManagerService } from './position-manager.service';

export interface TradingConfig {
  enabled: boolean;
  maxPositions: number;
  positionSize: number; // SOL amount per position
  maxSlippage: number; // percentage
  stopLoss: number; // percentage
  takeProfit: number; // percentage
  maxDailyLoss: number; // SOL amount
  minLiquidity: number; // SOL amount
  maxPriceImpact: number; // percentage
}

export interface Position {
  id: string;
  pool_id: string;
  status: 'pending' | 'open' | 'closed' | 'liquidated';
  entry_price: number;
  entry_amount: number;
  entry_timestamp: number;
  exit_price?: number;
  exit_amount?: number;
  exit_timestamp?: number;
  pnl?: number;
  pnl_percentage?: number;
  strategy: string;
  risk_score: number;
  created_at: number;
  updated_at: number;
}

export interface Trade {
  id: string;
  position_id: string;
  pool_id: string;
  type: 'buy' | 'sell';
  price: number;
  amount: number;
  tx_signature?: string;
  status: 'pending' | 'confirmed' | 'failed';
  error?: string;
  timestamp: number;
}

@Injectable()
export class TradingService implements OnModuleInit {
  private readonly logger = new Logger(TradingService.name);
  
  // Configuration
  private config: TradingConfig = {
    enabled: true,
    maxPositions: 3, // Reduced from 5 to 3 for larger positions
    positionSize: 1.0, // 1.0 SOL per position (increased from 0.05)
    maxSlippage: 3, // Reduced from 5% to 3% for larger trades
    stopLoss: 15, // Increased from 10% to 15% to give more room
    takeProfit: 25, // Increased from 20% to 25% for better profit targets
    maxDailyLoss: 2.0, // Increased from 0.5 to 2.0 SOL for larger positions
    minLiquidity: 5.0, // Increased from 1.0 to 5.0 SOL minimum liquidity
    maxPriceImpact: 2, // Reduced from 3% to 2% for larger trades
  };

  // State tracking
  private activePositions: Map<string, Position> = new Map();
  private dailyStats = {
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalPnL: 0,
    dailyLoss: 0,
    lastReset: Date.now(),
  };

  // Risk management
  private riskScores: Map<string, number> = new Map();
  private liquidityCache: Map<string, number> = new Map();

  constructor(
    private readonly positionManager: PositionManagerService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Initializing Trading Service...');
    
    // Load configuration from environment or file
    this.loadConfiguration();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Start background tasks
    this.startBackgroundTasks();
    
    this.logger.log('✅ Trading Service initialized successfully');
  }

  private loadConfiguration() {
    // Load from environment variables
    this.config.enabled = process.env.TRADING_ENABLED === 'true';
    this.config.maxPositions = parseInt(process.env.MAX_POSITIONS) || 3;
    this.config.positionSize = parseFloat(process.env.POSITION_SIZE) || 1.0;
    this.config.maxSlippage = parseFloat(process.env.MAX_SLIPPAGE) || 3;
    this.config.stopLoss = parseFloat(process.env.STOP_LOSS) || 15;
    this.config.takeProfit = parseFloat(process.env.TAKE_PROFIT) || 25;
    this.config.maxDailyLoss = parseFloat(process.env.MAX_DAILY_LOSS) || 2.0;
    this.config.minLiquidity = parseFloat(process.env.MIN_LIQUIDITY) || 5.0;
    this.config.maxPriceImpact = parseFloat(process.env.MAX_PRICE_IMPACT) || 2;

    this.logger.log(`📊 Trading Configuration:`, {
      enabled: this.config.enabled,
      maxPositions: this.config.maxPositions,
      positionSize: this.config.positionSize,
      stopLoss: this.config.stopLoss,
      takeProfit: this.config.takeProfit,
    });
  }

  private setupEventListeners() {
    // Listen for new pools
    this.eventEmitter.on('pool_stored', this.handleNewPool.bind(this));
    
    // Listen for pool updates
    this.eventEmitter.on('pool_update', this.handlePoolUpdate.bind(this));
    
    // Listen for pool ready events
    this.eventEmitter.on('pool_ready', this.handlePoolReady.bind(this));
  }

  private startBackgroundTasks() {
    // Reset daily stats every 24 hours
    setInterval(() => {
      this.resetDailyStats();
    }, 24 * 60 * 60 * 1000);

    // Monitor active positions every 30 seconds
    setInterval(() => {
      this.monitorActivePositions();
    }, 30 * 1000);

    // Update risk scores every 5 minutes
    setInterval(() => {
      this.updateRiskScores();
    }, 5 * 60 * 1000);
  }

  private async handleNewPool(data: any) {
    if (!this.config.enabled) {
      return;
    }

    try {
      const pool = await this.positionManager.getPool(data.pool_id);
      if (!pool) {
        this.logger.warn(`Pool ${data.pool_id} not found in database`);
        return;
      }

      // Analyze the pool for trading opportunities
      const analysis = await this.analyzePool(pool);
      
      if (analysis.shouldTrade) {
        this.logger.log(`🎯 Pool ${data.pool_id} passed analysis, queuing for trading`);
        this.eventEmitter.emit('pool_analysis_complete', {
          pool_id: data.pool_id,
          analysis,
          timestamp: Date.now()
        });
      } else {
        this.logger.log(`⏭️ Pool ${data.pool_id} failed analysis: ${analysis.reason}`);
      }

    } catch (error) {
      this.logger.error(`Error handling new pool ${data.pool_id}:`, error);
    }
  }

  private async handlePoolUpdate(data: any) {
    // Update position prices and check exit conditions
    const position = this.activePositions.get(data.pool_id);
    if (position && position.status === 'open') {
      await this.checkExitConditions(data.pool_id, data.price);
    }
  }

  private async handlePoolReady(data: any) {
    if (!this.config.enabled) {
      return;
    }

    // Check if we can take a new position
    if (this.activePositions.size >= this.config.maxPositions) {
      this.logger.warn(`Max positions reached (${this.config.maxPositions}), skipping pool ${data.pool_id}`);
      return;
    }

    // Check daily loss limit
    if (this.dailyStats.dailyLoss >= this.config.maxDailyLoss) {
      this.logger.warn(`Daily loss limit reached (${this.config.maxDailyLoss} SOL), skipping pool ${data.pool_id}`);
      return;
    }

    try {
      await this.executeBuy(data.pool_id, data.price);
    } catch (error) {
      this.logger.error(`Error executing buy for pool ${data.pool_id}:`, error);
    }
  }

  private async analyzePool(pool: Status6Pool): Promise<{
    shouldTrade: boolean;
    reason?: string;
    riskScore: number;
    opportunityScore: number;
  }> {
    const analysis: {
      shouldTrade: boolean;
      reason?: string;
      riskScore: number;
      opportunityScore: number;
    } = {
      shouldTrade: false,
      riskScore: 0,
      opportunityScore: 0,
    };

    try {
      // Check liquidity
      const liquidity = await this.getPoolLiquidity(pool.pool_id);
      if (liquidity < this.config.minLiquidity) {
        analysis.reason = `Insufficient liquidity: ${liquidity} SOL`;
        return analysis;
      }

      // Calculate risk score
      analysis.riskScore = this.calculateRiskScore(pool, liquidity);
      if (analysis.riskScore > 0.7) { // High risk threshold
        analysis.reason = `High risk score: ${analysis.riskScore}`;
        return analysis;
      }

      // Calculate opportunity score
      analysis.opportunityScore = this.calculateOpportunityScore(pool, liquidity);
      if (analysis.opportunityScore < 0.3) { // Low opportunity threshold
        analysis.reason = `Low opportunity score: ${analysis.opportunityScore}`;
        return analysis;
      }

      // Check price impact
      const priceImpact = this.calculatePriceImpact(pool, this.config.positionSize);
      if (priceImpact > this.config.maxPriceImpact) {
        analysis.reason = `High price impact: ${priceImpact}%`;
        return analysis;
      }

      analysis.shouldTrade = true;
      return analysis;

    } catch (error) {
      this.logger.error(`Error analyzing pool ${pool.pool_id}:`, error);
      analysis.reason = `Analysis error: ${error.message}`;
      return analysis;
    }
  }

  private async executeBuy(poolId: string, price: number): Promise<void> {
    try {
      this.logger.log(`🔄 Executing buy for pool ${poolId} at price ${price}`);

      // Create position record
      const position: Position = {
        id: `pos_${poolId}_${Date.now()}`,
        pool_id: poolId,
        status: 'pending',
        entry_price: price,
        entry_amount: this.config.positionSize,
        entry_timestamp: Date.now(),
        strategy: 'momentum',
        risk_score: this.riskScores.get(poolId) || 0.5,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      // Store position
      this.activePositions.set(poolId, position);

      // Execute the actual trade (paper trading for now)
      const tradeResult = await this.executePaperTrade(poolId, 'buy', price, this.config.positionSize);
      
      if (tradeResult.success) {
        position.status = 'open';
        position.updated_at = Date.now();
        this.activePositions.set(poolId, position);
        
        this.dailyStats.totalTrades++;
        this.dailyStats.successfulTrades++;
        
        this.logger.log(`✅ Buy executed successfully for pool ${poolId}`);
        this.logger.log(`📊 Position opened: ${this.config.positionSize} SOL at ${price}`);
        
        // Emit position opened event
        this.eventEmitter.emit('position_opened', {
          position_id: position.id,
          pool_id: poolId,
          entry_price: price,
          amount: this.config.positionSize,
          timestamp: Date.now()
        });

      } else {
        position.status = 'closed';
        this.activePositions.delete(poolId);
        
        this.dailyStats.totalTrades++;
        this.dailyStats.failedTrades++;
        
        this.logger.error(`❌ Buy failed for pool ${poolId}: ${tradeResult.error}`);
      }

    } catch (error) {
      this.logger.error(`Error executing buy for pool ${poolId}:`, error);
      this.activePositions.delete(poolId);
    }
  }

  private async executeSell(poolId: string, price: number, reason: string): Promise<void> {
    try {
      const position = this.activePositions.get(poolId);
      if (!position || position.status !== 'open') {
        return;
      }

      this.logger.log(`🔄 Executing sell for pool ${poolId} at price ${price} (${reason})`);

      // Execute the actual trade (paper trading for now)
      const tradeResult = await this.executePaperTrade(poolId, 'sell', price, position.entry_amount);
      
      if (tradeResult.success) {
        // Calculate PnL
        const pnl = (price - position.entry_price) * position.entry_amount;
        const pnlPercentage = ((price - position.entry_price) / position.entry_price) * 100;

        // Update position
        position.status = 'closed';
        position.exit_price = price;
        position.exit_amount = position.entry_amount;
        position.exit_timestamp = Date.now();
        position.pnl = pnl;
        position.pnl_percentage = pnlPercentage;
        position.updated_at = Date.now();

        // Update daily stats
        this.dailyStats.totalTrades++;
        this.dailyStats.successfulTrades++;
        this.dailyStats.totalPnL += pnl;
        
        if (pnl < 0) {
          this.dailyStats.dailyLoss += Math.abs(pnl);
        }

        this.logger.log(`✅ Sell executed successfully for pool ${poolId}`);
        this.logger.log(`📊 Position closed: PnL ${pnl} SOL (${pnlPercentage.toFixed(2)}%)`);
        
        // Emit position closed event
        this.eventEmitter.emit('position_closed', {
          position_id: position.id,
          pool_id: poolId,
          exit_price: price,
          pnl,
          pnl_percentage: pnlPercentage,
          reason,
          timestamp: Date.now()
        });

        // Remove from active positions
        this.activePositions.delete(poolId);

      } else {
        this.dailyStats.totalTrades++;
        this.dailyStats.failedTrades++;
        
        this.logger.error(`❌ Sell failed for pool ${poolId}: ${tradeResult.error}`);
      }

    } catch (error) {
      this.logger.error(`Error executing sell for pool ${poolId}:`, error);
    }
  }

  private async checkExitConditions(poolId: string, currentPrice: number): Promise<void> {
    const position = this.activePositions.get(poolId);
    if (!position || position.status !== 'open') {
      return;
    }

    const priceChange = ((currentPrice - position.entry_price) / position.entry_price) * 100;

    // Check stop loss
    if (priceChange <= -this.config.stopLoss) {
      await this.executeSell(poolId, currentPrice, 'stop_loss');
      return;
    }

    // Check take profit
    if (priceChange >= this.config.takeProfit) {
      await this.executeSell(poolId, currentPrice, 'take_profit');
      return;
    }
  }

  private async executePaperTrade(poolId: string, type: 'buy' | 'sell', price: number, amount: number): Promise<{
    success: boolean;
    error?: string;
    tx_signature?: string;
  }> {
    // Simulate trade execution with some randomness
    const success = Math.random() > 0.1; // 90% success rate
    
    if (success) {
      return {
        success: true,
        tx_signature: `paper_${type}_${poolId}_${Date.now()}`
      };
    } else {
      return {
        success: false,
        error: 'Simulated trade failure'
      };
    }
  }

  private calculateRiskScore(pool: Status6Pool, liquidity: number): number {
    let riskScore = 0;

    // Liquidity risk (lower liquidity = higher risk)
    if (liquidity < 5) riskScore += 0.3;
    else if (liquidity < 10) riskScore += 0.2;
    else if (liquidity < 20) riskScore += 0.1;

    // Fee risk (higher fees = higher risk)
    if (pool.trade_fee > 1) riskScore += 0.2;
    if (pool.swap_fee > 0.5) riskScore += 0.1;

    // Price range risk (wider range = higher risk)
    const priceRange = pool.price_range_max - pool.price_range_min;
    if (priceRange > 100) riskScore += 0.2;
    else if (priceRange > 50) riskScore += 0.1;

    return Math.min(riskScore, 1.0);
  }

  private calculateOpportunityScore(pool: Status6Pool, liquidity: number): number {
    let opportunityScore = 0;

    // Liquidity opportunity (higher liquidity = better opportunity)
    if (liquidity > 20) opportunityScore += 0.4;
    else if (liquidity > 10) opportunityScore += 0.3;
    else if (liquidity > 5) opportunityScore += 0.2;

    // Fee opportunity (lower fees = better opportunity)
    if (pool.trade_fee < 0.5) opportunityScore += 0.3;
    if (pool.swap_fee < 0.25) opportunityScore += 0.2;

    // Recent pool opportunity (newer pools = better opportunity)
    const poolAge = Date.now() - (pool.pool_open_time * 1000);
    if (poolAge < 10 * 60 * 1000) opportunityScore += 0.3; // Less than 10 minutes
    else if (poolAge < 30 * 60 * 1000) opportunityScore += 0.2; // Less than 30 minutes

    return Math.min(opportunityScore, 1.0);
  }

  private calculatePriceImpact(pool: Status6Pool, tradeAmount: number): number {
    // Simple price impact calculation
    // In a real implementation, this would use actual pool reserves
    return (tradeAmount / 10) * 100; // Assume 10 SOL total liquidity
  }

  private async getPoolLiquidity(poolId: string): Promise<number> {
    // Check cache first
    if (this.liquidityCache.has(poolId)) {
      return this.liquidityCache.get(poolId)!;
    }

    // Simulate liquidity fetch (in real implementation, fetch from RPC)
    const liquidity = Math.random() * 50 + 1; // 1-51 SOL
    
    // Cache for 5 minutes
    this.liquidityCache.set(poolId, liquidity);
    setTimeout(() => {
      this.liquidityCache.delete(poolId);
    }, 5 * 60 * 1000);

    return liquidity;
  }

  private updateRiskScores(): void {
    // Update risk scores for all active positions
    for (const [poolId, position] of this.activePositions.entries()) {
      if (position.status === 'open') {
        // Recalculate risk score based on current market conditions
        // This is a simplified version
        const newRiskScore = position.risk_score + (Math.random() - 0.5) * 0.1;
        position.risk_score = Math.max(0, Math.min(1, newRiskScore));
        position.updated_at = Date.now();
      }
    }
  }

  private monitorActivePositions(): void {
    this.logger.log(`📊 Active positions: ${this.activePositions.size}/${this.config.maxPositions}`);
    
    for (const [poolId, position] of this.activePositions.entries()) {
      if (position.status === 'open') {
        const duration = Date.now() - position.entry_timestamp;
        this.logger.log(`Position ${poolId}: ${duration / 1000}s old, risk: ${position.risk_score.toFixed(2)}`);
      }
    }
  }

  private resetDailyStats(): void {
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

  // Public API methods
  public getActivePositions(): Position[] {
    return Array.from(this.activePositions.values());
  }

  public getDailyStats() {
    return { ...this.dailyStats };
  }

  public getConfiguration(): TradingConfig {
    return { ...this.config };
  }

  public updateConfiguration(updates: Partial<TradingConfig>): void {
    this.config = { ...this.config, ...updates };
    this.logger.log('📝 Trading configuration updated');
  }

  public async getHealthStatus(): Promise<{ status: string; stats?: any }> {
    try {
      return {
        status: 'healthy',
        stats: {
          activePositions: this.activePositions.size,
          maxPositions: this.config.maxPositions,
          dailyStats: this.dailyStats,
          config: this.config
        }
      };
    } catch (error) {
      return {
        status: 'error',
        stats: { error: error.message }
      };
    }
  }
} 