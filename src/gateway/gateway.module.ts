import { Module } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { SocketService } from './socket.service';
import { PoolGateway } from './pool.gateway';

@Module({
  providers: [GatewayService, SocketService, PoolGateway],
  exports: [GatewayService, SocketService, PoolGateway],
})
export class GatewayModule {}
