import { Module } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { PoolMonitorService } from './pool-monitor.service';
import { PoolMonitorManager } from './pool-monitor-manager';
import { SocketService } from '../gateway/socket.service';
import { PendingPoolManager } from './pending-pool-manager';
import { PendingPool } from './pending-pool-manager';
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
    {
      provide: PoolMonitorService,
      useFactory: (connection: Connection, socketService: SocketService) => {
        return new PoolMonitorService(connection, socketService);
      },
      inject: [Connection, SocketService]
    },
    {
      provide: PoolMonitorManager,
      useFactory: (connection: Connection, socketService: SocketService, poolMonitorService: PoolMonitorService) => {
        const pendingPoolManager = new PendingPoolManager(
          connection,
          (pool: PendingPool) => poolMonitorService.handlePoolReady(pool)
        );
        return new PoolMonitorManager(connection, socketService, pendingPoolManager);
      },
      inject: [Connection, SocketService, PoolMonitorService]
    }
  ],
  exports: [PoolMonitorService]
})
export class MonitorModule {} 