import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import { Express } from 'express';
import { execSync } from 'child_process';

export const EXPRESS_APP = 'EXPRESS_APP';

@Injectable()
export class SocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocketService.name);
  private server: Server;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly PORT = 5001;
  private isInitialized = false;
  private httpServer: any;

  constructor(@Inject(EXPRESS_APP) private readonly app: Express) {
    this.logger.log('SocketService constructed');
  }

  async onModuleInit() {
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
      this.httpServer = createServer(this.app);
      
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

  afterInit() {
    this.logger.log('Socket.IO Gateway ready');
  }

  handleConnection(client: Socket) {
    this.logger.log(`✅ Client connected - ID: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`❌ Client disconnected - ID: ${client.id}`);
  }

  broadcastNewPool(poolId: string, baseMint: string, quoteMint: string, baseDecimals: number, quoteDecimals: number, initialPrice?: number) {
    if (!this.isInitialized || !this.server) {
      this.logger.error('Socket.IO server not started');
      return;
    }

    const message = {
      type: 'new_pool',
      poolId,
      baseMint,
      quoteMint,
      baseDecimals,
      quoteDecimals,
      initialPrice,
      timestamp: new Date().toISOString(),
    };

    // Make new pool messages very visible with clear formatting
    this.logger.log('\n' + '='.repeat(80));
    this.logger.log(`🚨 NEW POOL DETECTED 🚨`);
    this.logger.log(`Pool ID: ${poolId}`);
    this.logger.log(`Base Mint: ${baseMint} (${baseDecimals} decimals)`);
    this.logger.log(`Quote Mint: ${quoteMint} (${quoteDecimals} decimals)`);
    if (initialPrice) {
      this.logger.log(`Initial Price: ${initialPrice}`);
    }
    this.logger.log(`Time: ${new Date().toISOString()}`);
    this.logger.log('='.repeat(80) + '\n');

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
    // Only log health status, no need to emit to clients
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    this.logger.log(`[Health] Server uptime: ${hours}h ${minutes}m`);
    this.server.emit('health', message);
  }

  broadcastPoolUpdate(poolId: string, data: {
    price: number;
    baseReserve: number;
    quoteReserve: number;
    tvl: number;
    volume24h: number;
    priceChange: number;
    timestamp: number;
  }) {
    if (!this.isInitialized || !this.server) {
      this.logger.error('Socket.IO server not started');
      return;
    }

    const message = {
      type: 'pool_update',
      poolId,
      ...data,
      timestamp: new Date().toISOString()
    };

    this.server.emit('pool_update', message);
  }

  broadcastPoolExists(poolId: string, baseMint: string, quoteMint: string) {
    if (!this.isInitialized || !this.server) {
      this.logger.error('Socket.IO server not started');
      return;
    }

    const message = {
      type: 'pool_exists',
      poolId,
      baseMint,
      quoteMint,
      timestamp: new Date().toISOString(),
    };

    // Log pool existence with clear formatting
    this.logger.log('\n' + '-'.repeat(80));
    this.logger.log(`🔍 POOL EXISTS ON-CHAIN`);
    this.logger.log(`Pool ID: ${poolId}`);
    this.logger.log(`Base Mint: ${baseMint}`);
    this.logger.log(`Quote Mint: ${quoteMint}`);
    this.logger.log(`Time: ${new Date().toISOString()}`);
    this.logger.log('-'.repeat(80) + '\n');

    this.server.emit('pool_exists', message);
  }

  private startHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    let startTime = Date.now();
    this.healthCheckInterval = setInterval(() => {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      this.broadcastHealth(uptime);
    }, 60000); // Changed to 60 seconds (1 minute)
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
    return this.isInitialized;
  }
} 