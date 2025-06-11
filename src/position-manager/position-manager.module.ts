import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PositionManagerService } from './position-manager.service';
import { PositionManagerDB } from './database/position-manager-db';
import { TradingService } from './trading.service';
import { TradingController } from './trading.controller';
import { ArbitrageDetectorService } from './arbitrage-detector.service';
import { EarlyTradingStrategyService } from './early-trading-strategy.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      // Global event emitter configuration
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),
    GatewayModule,
  ],
  controllers: [TradingController],
  providers: [
    PositionManagerService,
    PositionManagerDB,
    TradingService,
    ArbitrageDetectorService,
    EarlyTradingStrategyService,
  ],
  exports: [PositionManagerService, PositionManagerDB, TradingService, ArbitrageDetectorService, EarlyTradingStrategyService],
})
export class PositionManagerModule {} 