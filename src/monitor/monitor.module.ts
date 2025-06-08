import { Module } from '@nestjs/common';
import { PoolMonitorService } from './pool-monitor.service.js';
import { PoolMonitorManager } from './pool-monitor-manager.js';
import { Connection } from '@solana/web3.js';
import { GatewayModule } from '../gateway/gateway.module.js';

@Module({
  imports: [GatewayModule],
  providers: [
    PoolMonitorService,
    PoolMonitorManager,
    {
      provide: Connection,
      useFactory: () => {
        const HTTP_URL = process.env.HTTP_URL!;
        const WS_URL = process.env.WSS_URL!;
        return new Connection(HTTP_URL, {
          commitment: 'confirmed',
          wsEndpoint: WS_URL,
          confirmTransactionInitialTimeout: 60000
        });
      },
    },
  ],
  exports: [PoolMonitorService],
})
export class MonitorModule {} 