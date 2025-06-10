import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PositionManagerService } from './position-manager.service';
import { PositionManagerDB } from './database/position-manager-db';

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
  ],
  providers: [PositionManagerService, PositionManagerDB],
  exports: [PositionManagerService, PositionManagerDB],
})
export class PositionManagerModule {} 