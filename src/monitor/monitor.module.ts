import { Module, forwardRef } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { PoolMonitorService } from './pool-monitor.service';
import { Status6MonitorService } from './status-6-monitor.service';
import { HealthMonitorService } from './health-monitor.service';
import { PoolMonitorManager } from './pool-monitor-manager';
import { PendingPoolManager } from './pending-pool-manager';
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
    // DISABLED: These services conflict with the new listener in src/scripts/new-raydium-pools/listener.ts
    // PoolMonitorService,
    // Status6MonitorService,
    // HealthMonitorService,
    // {
    //   provide: PendingPoolManager,
    //   useFactory: (connection: Connection, socketService: any) => {
    //     return new PendingPoolManager(
    //       connection,
    //       (pool: any) => {
    //         // This will be set by PoolMonitorManager
    //         console.log('Pool ready callback called:', pool);
    //       },
    //       undefined, // PoolMonitorManager will be set later
    //       socketService
    //     );
    //   },
    //   inject: [Connection, 'SocketService']
    // },
    // {
    //   provide: PoolMonitorManager,
    //   useFactory: (connection: Connection, socketService: any, pendingPoolManager: PendingPoolManager) => {
    //     const manager = new PoolMonitorManager(
    //       connection,
    //       socketService,
    //       pendingPoolManager,
    //       HTTP_URL,
    //       WSS_URL
    //     );
    //     // Set the callback for PendingPoolManager
    //     (pendingPoolManager as any).onPoolReady = (pool: any) => {
    //       manager.addPool(pool);
    //     };
    //     return manager;
    //   },
    //   inject: [Connection, 'SocketService', PendingPoolManager]
    // }
  ],
  exports: [
    // DISABLED: These services conflict with the new listener
    // PoolMonitorService, 
    // Status6MonitorService, 
    // HealthMonitorService, 
    // PoolMonitorManager, 
    // PendingPoolManager
  ]
})
export class MonitorModule {} 