import { Module } from '@nestjs/common';
import { RaydiumModule } from './raydium/raydium.module';
import { PrismaModule } from './prisma/prisma.module';
import { GatewayModule } from './gateway/gateway.module';
import { MonitorModule } from './monitor/monitor.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

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
