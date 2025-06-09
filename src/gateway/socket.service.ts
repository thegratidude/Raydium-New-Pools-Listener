import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import { Express } from 'express';
import { execSync } from 'child_process';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { PoolBroadcastMessage } from '../monitor/types';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'pools',
})
export class SocketService implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocketService.name);
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly PORT = 5001;
  private isInitialized = false;
  private httpServer: any;
  private expressApp: Express | null = null;
  private isServerReady = false;

  constructor() {
    this.logger.log('SocketService constructed');
    this.server?.on('connection', () => {
      this.logger.log('New client connected to pools namespace');
    });
  }

  setExpressApp(app: Express) {
    this.expressApp = app;
    this.initializeServer();
  }

  private async initializeServer() {
    if (!this.expressApp) {
      this.logger.error('Express app not set');
      return;
    }

    try {
      this.logger.log('Starting SocketService initialization...');
      
      // Kill any process using port 5001 (macOS/Linux only)
      try {
        execSync(`lsof -ti:${this.PORT} | xargs kill -9 2>/dev/null || true`);
        this.logger.log(`Cleared port ${this.PORT}`);
      } catch (error) {
        this.logger.warn(`Could not clear port ${this.PORT}: ${error.message}`);
      }

      // Create HTTP server
      this.logger.log('Creating HTTP server...');
      this.httpServer = createServer(this.expressApp);
      
      // Create Socket.IO server with enhanced configuration
      this.logger.log('Creating Socket.IO server...');
      this.server = new Server(this.httpServer, {
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
      });

      // Set up Socket.IO event handlers with enhanced logging
      this.logger.log('Setting up Socket.IO event handlers...');
      this.server.on('connection', (socket) => {
        this.logger.log(`✅ Client connected - ID: ${socket.id}`);
        this.logger.log(`Client transport: ${socket.conn.transport.name}`);
        this.logger.log(`Client remote address: ${socket.conn.remoteAddress}`);
        
        socket.on('disconnect', (reason) => {
          this.logger.log(`❌ Client disconnected - ID: ${socket.id}, reason: ${reason}`);
        });

        socket.on('error', (error) => {
          this.logger.error(`Socket error for client ${socket.id}: ${error.message}`);
        });
      });

      // Start the server
      this.logger.log(`Starting server on port ${this.PORT}...`);
      await new Promise<void>((resolve, reject) => {
        this.httpServer.listen(this.PORT, () => {
          this.logger.log(`Socket.IO server running on port ${this.PORT}`);
          this.logger.log(`Server address: http://localhost:${this.PORT}`);
          this.isInitialized = true;
          this.startHealthChecks();
          this.isServerReady = true;
          resolve();
        });

        this.httpServer.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            this.logger.error(`Port ${this.PORT} is already in use. Attempting to recover...`);
            try {
              execSync(`lsof -ti:${this.PORT} | xargs kill -9 2>/dev/null || true`);
              this.logger.log(`Cleared port ${this.PORT}, retrying...`);
              this.httpServer.listen(this.PORT);
            } catch (retryError) {
              this.logger.error(`Failed to recover: ${retryError.message}`);
              reject(retryError);
            }
          } else {
            this.logger.error(`Server error: ${error.message}`);
            reject(error);
          }
        });
      });

      this.logger.log('SocketService initialization completed successfully');
    } catch (error) {
      this.logger.error(`SocketService initialization failed: ${error.message}`);
      this.logger.error(error.stack);
      throw error; // Re-throw to let NestJS handle the error
    }
  }

  async onModuleInit() {
    // Server initialization is now handled by setExpressApp
  }

  afterInit() {
    this.logger.log('Socket.IO Gateway ready');
    this.isServerReady = true;
    this.logger.log('Socket service initialized and ready for connections');
  }

  handleConnection(client: Socket) {
    this.logger.log(`✅ Client connected - ID: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`❌ Client disconnected - ID: ${client.id}`);
  }

  broadcastNewPool(poolId: string) {
    if (!this.isInitialized || !this.server) {
      this.logger.error('Socket.IO server not started');
      return;
    }

    const message = {
      type: 'new_pool',
      poolId,
      timestamp: new Date().toISOString(),
    };

    this.logger.log(`📢 Broadcasting new pool: ${poolId}`);
    this.server.emit('new_pool', message);
  }

  broadcastHealth(uptime: number) {
    if (!this.isInitialized || !this.server) {
      return;
    }

    const message = {
      timestamp: new Date().toISOString(),
      uptime,
    };
    this.server.emit('health', message);
  }

  private startHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    let startTime = Date.now();
    this.healthCheckInterval = setInterval(() => {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      this.broadcastHealth(uptime);
    }, 10000); // 10 seconds
  }

  onModuleDestroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.server) {
      this.server.close();
    }
  }

  isReady(): boolean {
    return this.isServerReady && this.server !== undefined;
  }

  broadcastPoolUpdate(data: PoolBroadcastMessage) {
    if (!this.isReady()) {
      this.logger.warn('Attempted to broadcast pool update but socket service is not ready');
      return;
    }

    try {
      this.server.emit('pool_update', data);
      this.logger.debug(`Broadcast pool update for ${data.pool_id}`);
    } catch (error) {
      this.logger.error(`Failed to broadcast pool update: ${error.message}`);
    }
  }
} 