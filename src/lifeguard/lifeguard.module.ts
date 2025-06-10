import { Module } from '@nestjs/common';
import { LifeguardService } from './lifeguard.service';
import { PositionManagerModule } from '../position-manager/position-manager.module';

@Module({
  imports: [PositionManagerModule],
  providers: [LifeguardService],
  exports: [LifeguardService],
})
export class LifeguardModule {} 