import { Module } from '@nestjs/common';
import { RaydiumService } from './raydium.service.js';
import { RaydiumController } from './raydium.controller.js';

@Module({
  controllers: [RaydiumController],
  providers: [RaydiumService],
})
export class RaydiumModule {}
