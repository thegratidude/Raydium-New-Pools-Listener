import { Module } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { PoolMonitorService } from './pool-monitor.service';
import { HealthMonitorService } from './health-monitor.service';
import { GatewayModule } from '../gateway/gateway.module';

const HTTP_URL = process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com';
const WSS_URL = process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com';

@Module({
  imports: [GatewayModule],
  providers: [
    {
      provide: Connection,
      useFactory: () => new Connection(HTTP_URL, {
        wsEndpoint: WSS_URL,
        commitment: 'confirmed'
      })
    },
    PoolMonitorService,
    HealthMonitorService
  ],
  exports: [PoolMonitorService, HealthMonitorService]
})
export class MonitorModule {} 