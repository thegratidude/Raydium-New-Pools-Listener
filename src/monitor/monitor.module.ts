import { Module } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { UnifiedPoolMonitorService } from './unified-pool-monitor.service';
import { GatewayModule } from '../gateway/gateway.module';

const HTTP_URL = process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com';
const WSS_URL = process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com';

@Module({
  imports: [GatewayModule],
  providers: [
    {
      provide: 'HTTP_URL',
      useValue: HTTP_URL
    },
    {
      provide: 'WSS_URL',
      useValue: WSS_URL
    },
    {
      provide: Connection,
      useFactory: () => new Connection(HTTP_URL, {
        wsEndpoint: WSS_URL,
        commitment: 'confirmed'
      })
    },
    // NEW: Unified pool monitoring service
    UnifiedPoolMonitorService
  ],
  exports: [
    UnifiedPoolMonitorService
  ]
})
export class MonitorModule {} 