import { Module } from '@nestjs/common';
import { PoolMonitorService } from './pool-monitor.service';
import { PoolMonitorManager } from './pool-monitor-manager';
import { Connection } from '@solana/web3.js';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  providers: [
    PoolMonitorService,
    PoolMonitorManager,
    {
      provide: Connection,
      useFactory: () => {
        const HTTP_URL = process.env.HTTP_URL!;
        return new Connection(HTTP_URL);
      },
    },
  ],
  exports: [PoolMonitorService],
})
export class MonitorModule {} 