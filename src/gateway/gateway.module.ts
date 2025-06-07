import { Module } from '@nestjs/common';
import { SocketService, EXPRESS_APP } from './socket.service';
import { Express } from 'express';

@Module({
  providers: [
    SocketService,
    {
      provide: EXPRESS_APP,
      useFactory: () => {
        const express = require('express');
        return express();
      },
    },
  ],
  exports: [SocketService, EXPRESS_APP],
})
export class GatewayModule {}
