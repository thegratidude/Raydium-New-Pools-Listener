import { Module } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RaydiumModule } from './raydium/raydium.module';
import { PrismaModule } from './prisma/prisma.module';
import { GatewayModule } from './gateway/gateway.module';
import { MonitorModule } from './monitor/monitor.module';
import { PositionManagerModule } from './position-manager/position-manager.module';
import { LifeguardModule } from './lifeguard/lifeguard.module';

const HTTP_URL = process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com';
const WSS_URL = process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com';

@Module({
  imports: [RaydiumModule, PrismaModule, GatewayModule, MonitorModule, PositionManagerModule, LifeguardModule],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: Connection,
      useFactory: () => new Connection(HTTP_URL, {
        wsEndpoint: WSS_URL,
        commitment: 'confirmed'
      })
    }
  ],
})
export class AppModule {}
