import { Module } from '@nestjs/common';
import { SocketService, EXPRESS_APP } from './socket.service.js';
import express from 'express';

@Module({
  providers: [
    SocketService,
    {
      provide: EXPRESS_APP,
      useFactory: () => {
        return express();
      },
    },
  ],
  exports: [SocketService, EXPRESS_APP],
})
export class GatewayModule {}
