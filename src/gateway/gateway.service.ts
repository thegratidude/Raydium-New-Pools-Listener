import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Server } from 'socket.io';

const HEALTH_CHECK_INTERVAL_MS = 10000; // 10 seconds
const SERVER_INIT_TIMEOUT_MS = 10000;   // 10 seconds
const SERVER_INIT_POLL_MS = 500;        // 500ms

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: '/',
})
export class GatewayService implements OnGatewayInit, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayService.name);
  private isInitialized = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  @WebSocketServer()
  server: Server;

  onModuleInit() {
    this.logger.log('Waiting for Socket.IO server to initialize...');
    const startTime = Date.now();
    
    const poll = () => {
      if (this.server) {
        this.logger.log('✅ Socket.IO server successfully initialized');
        this.isInitialized = true;
        this.startHealthChecks();
        return;
      }
      
      if (Date.now() - startTime > SERVER_INIT_TIMEOUT_MS) {
        this.logger.error('❌ Socket.IO server initialization timed out');
        return;
      }
      
      setTimeout(poll, SERVER_INIT_POLL_MS);
    };
    
    poll();
  }

  onModuleDestroy() {
    this.stopHealthChecks();
  }

  afterInit(server: Server) {
    this.logger.log('Socket.IO Gateway initialized');
    this.isInitialized = true;
  }

  private startHealthChecks() {
    this.healthCheckInterval = setInterval(() => {
      this.broadcastHealth(process.uptime());
    }, HEALTH_CHECK_INTERVAL_MS);
    this.logger.log(`Health checks started (every ${HEALTH_CHECK_INTERVAL_MS/1000}s)`);
  }

  private stopHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      this.logger.log('Health checks stopped');
    }
  }

  broadcastNewPool(poolId: string) {
    if (!this.isInitialized) {
      this.logger.error('Cannot broadcast: Socket.IO server not initialized');
      return;
    }

    const message = {
      type: 'new_pool',
      poolId,
      timestamp: new Date().toISOString(),
    };

    this.logger.log(`📢 Broadcasting new pool: ${poolId}`);
    this.server.emit('newPool', message);
  }

  broadcastHealth(uptime: number) {
    if (!this.isInitialized) {
      this.logger.error('Cannot broadcast health: Socket.IO server not initialized');
      return;
    }

    const message = {
      timestamp: new Date().toISOString(),
      uptime,
    };

    this.server.emit('health', message);
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}