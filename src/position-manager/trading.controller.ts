import { Controller, Get, Post, Put, Body, Param, Query, Logger } from '@nestjs/common';
import { TradingService, TradingConfig, Position } from './trading.service';
import { EarlyTradingStrategyService } from './early-trading-strategy.service';

@Controller('trading')
export class TradingController {
  private readonly logger = new Logger(TradingController.name);

  constructor(
    private readonly tradingService: TradingService,
    private readonly earlyTradingService: EarlyTradingStrategyService
  ) {}

  @Get('status')
  async getTradingStatus() {
    try {
      const health = await this.tradingService.getHealthStatus();
      const config = this.tradingService.getConfiguration();
      const stats = this.tradingService.getDailyStats();
      const positions = this.tradingService.getActivePositions();
      const earlyHealth = await this.earlyTradingService.getHealthStatus();

      return {
        status: 'success',
        data: {
          health,
          config,
          stats,
          positions: {
            count: positions.length,
            active: positions.filter(p => p.status === 'open').length,
            pending: positions.filter(p => p.status === 'pending').length,
            closed: positions.filter(p => p.status === 'closed').length,
          },
          earlyTrading: earlyHealth
        }
      };
    } catch (error) {
      this.logger.error('Error getting trading status:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  @Get('positions')
  async getPositions(@Query('status') status?: string) {
    try {
      const positions = this.tradingService.getActivePositions();
      
      if (status) {
        const filtered = positions.filter(p => p.status === status);
        return {
          status: 'success',
          data: {
            positions: filtered,
            count: filtered.length
          }
        };
      }

      return {
        status: 'success',
        data: {
          positions,
          count: positions.length
        }
      };
    } catch (error) {
      this.logger.error('Error getting positions:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  @Get('positions/:poolId')
  async getPosition(@Param('poolId') poolId: string) {
    try {
      const positions = this.tradingService.getActivePositions();
      const position = positions.find(p => p.pool_id === poolId);
      
      if (!position) {
        return {
          status: 'error',
          error: 'Position not found'
        };
      }

      return {
        status: 'success',
        data: position
      };
    } catch (error) {
      this.logger.error(`Error getting position ${poolId}:`, error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  @Get('stats')
  async getStats() {
    try {
      const stats = this.tradingService.getDailyStats();
      const config = this.tradingService.getConfiguration();
      const positions = this.tradingService.getActivePositions();

      const activePositions = positions.filter(p => p.status === 'open');
      const totalPnL = activePositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
      const avgPnL = activePositions.length > 0 ? totalPnL / activePositions.length : 0;

      return {
        status: 'success',
        data: {
          daily: stats,
          config,
          positions: {
            total: positions.length,
            active: activePositions.length,
            totalPnL,
            avgPnL,
            winRate: stats.totalTrades > 0 ? (stats.successfulTrades / stats.totalTrades) * 100 : 0
          }
        }
      };
    } catch (error) {
      this.logger.error('Error getting stats:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  @Get('config')
  async getConfig() {
    try {
      const config = this.tradingService.getConfiguration();
      return {
        status: 'success',
        data: config
      };
    } catch (error) {
      this.logger.error('Error getting config:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  @Put('config')
  async updateConfig(@Body() updates: Partial<TradingConfig>) {
    try {
      this.tradingService.updateConfiguration(updates);
      const newConfig = this.tradingService.getConfiguration();
      
      this.logger.log('Trading configuration updated:', updates);
      
      return {
        status: 'success',
        data: {
          message: 'Configuration updated successfully',
          config: newConfig
        }
      };
    } catch (error) {
      this.logger.error('Error updating config:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  @Post('positions/:poolId/close')
  async closePosition(@Param('poolId') poolId: string, @Body() data: { price: number }) {
    try {
      // This would need to be implemented in the trading service
      // For now, we'll return a placeholder response
      this.logger.log(`Manual close requested for position ${poolId} at price ${data.price}`);
      
      return {
        status: 'success',
        data: {
          message: 'Close position request received',
          poolId,
          price: data.price,
          timestamp: Date.now()
        }
      };
    } catch (error) {
      this.logger.error(`Error closing position ${poolId}:`, error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  @Get('paper-portfolio')
  async getPaperPortfolio() {
    try {
      const portfolio = this.earlyTradingService.getPaperPortfolio();
      return {
        status: 'success',
        data: portfolio
      };
    } catch (error) {
      this.logger.error('Error getting paper portfolio:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  @Get('paper-portfolio/total-value')
  async getTotalPortfolioValue() {
    try {
      const portfolio = this.earlyTradingService.getPaperPortfolio();
      const activePositions = this.earlyTradingService.getActivePositions();
      
      // Calculate current market value of open positions
      let totalPositionValue = 0;
      let unrealizedPnL = 0;
      const positionDetails = [];
      
      for (const position of activePositions) {
        const currentValue = position.tokensPurchased * position.currentPrice;
        const entryValue = position.tokensPurchased * position.entryPrice;
        const positionUnrealizedPnL = currentValue - entryValue;
        
        totalPositionValue += currentValue;
        unrealizedPnL += positionUnrealizedPnL;
        
        positionDetails.push({
          poolId: position.poolId,
          tokens: position.tokensPurchased,
          entryPrice: position.entryPrice,
          currentPrice: position.currentPrice,
          entryValue: entryValue,
          currentValue: currentValue,
          unrealizedPnL: positionUnrealizedPnL,
          unrealizedPnLPercent: ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100
        });
      }
      
      const totalPortfolioValue = portfolio.balance + totalPositionValue;
      const totalUnrealizedPnL = portfolio.totalPnL + unrealizedPnL;
      
      return {
        status: 'success',
        data: {
          cash: portfolio.balance,
          positionValue: totalPositionValue,
          totalPortfolioValue: totalPortfolioValue,
          realizedPnL: portfolio.totalPnL,
          unrealizedPnL: unrealizedPnL,
          totalPnL: totalUnrealizedPnL,
          activePositions: portfolio.activePositions,
          totalTrades: portfolio.totalTrades,
          successRate: portfolio.successRate,
          positionDetails: positionDetails
        }
      };
    } catch (error) {
      this.logger.error('Error getting total portfolio value:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  @Post('paper-portfolio/reset')
  async resetPaperPortfolio() {
    try {
      this.earlyTradingService.resetPaperPortfolio();
      return {
        status: 'success',
        message: 'Paper trading portfolio reset successfully'
      };
    } catch (error) {
      this.logger.error('Error resetting paper portfolio:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }
}