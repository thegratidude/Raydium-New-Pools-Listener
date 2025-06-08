import { Module } from '@nestjs/common';
import { RaydiumModule } from './raydium/raydium.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { MonitorModule } from './monitor/monitor.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    RaydiumModule,
    PrismaModule,
    GatewayModule,
    MonitorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
