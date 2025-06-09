import { Module } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { SocketService } from './socket.service';

@Module({
  providers: [GatewayService, SocketService],
  exports: [GatewayService, SocketService],
})
export class GatewayModule {}
