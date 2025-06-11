import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PoolBroadcastMessage, PoolReadyMessage } from '../types/market';

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  allowEIO3: true,
  path: '/socket.io/',
  serveClient: false,
  cookie: false
})
export class PoolGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PoolGateway.name);

  afterInit(server: Server) {
    this.logger.log('✅ PoolGateway initialized');
  }

  handleConnection(client: Socket, ...args: any[]) {
    this.logger.log(`✅ Client connected - ID: ${client.id}`);
    this.logger.log(`Client transport: ${client.conn.transport.name}`);
    this.logger.log(`Client remote address: ${client.conn.remoteAddress}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`❌ Client disconnected - ID: ${client.id}`);
  }

  broadcastPoolUpdate(message: PoolBroadcastMessage) {
    if (!this.server) {
      this.logger.warn('WebSocket server not ready, cannot broadcast pool update');
      return;
    }

    try {
      this.logger.log(`📢 Broadcasting pool update: ${message.pool_id}`);
      this.server.emit('pool_update', message);
    } catch (error) {
      this.logger.error('Error broadcasting pool update:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  broadcastPoolReady(message: PoolReadyMessage) {
    if (!this.server) {
      this.logger.warn('WebSocket server not ready, cannot broadcast pool ready');
      return;
    }

    try {
      this.logger.log(`📢 Broadcasting pool ready: ${message.pool_id}`);
      this.server.emit('pool_ready', message);
    } catch (error) {
      this.logger.error('Error broadcasting pool ready:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  broadcastNewPool(message: PoolBroadcastMessage) {
    if (!this.server) {
      this.logger.error('WebSocket server not ready');
      return;
    }

    this.logger.log(`📢 Broadcasting new pool: ${message.pool_id}`);
    this.server.emit('new_pool', message);
  }

  broadcastHealth(uptime: number, messagesPerMinute: number, activeClients: number) {
    if (!this.server) {
      return;
    }

    const message = {
      timestamp: new Date().toISOString(),
      uptime,
      messages_per_minute: Math.round(messagesPerMinute),
      active_clients: activeClients
    };
    
    this.server.emit('health', message);
  }

  broadcast(event: string, data: any) {
    if (!this.server) {
      this.logger.warn('WebSocket server not ready, cannot broadcast');
      return;
    }
    
    this.server.emit(event, data);
  }

  isReady(): boolean {
    return this.server !== undefined;
  }
} 