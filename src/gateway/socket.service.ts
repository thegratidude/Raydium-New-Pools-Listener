import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import { Express } from 'express';
import { execSync } from 'child_process';
import { MarketPressure, PoolBroadcastMessage, PoolReadyMessage, isMarketPressure } from '../types/market';
import { FileLoggerService } from '../utils/file-logger.service';

@Injectable()
export class SocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocketService.name);
  private readonly fileLogger = new FileLoggerService();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly PORT = 5001;
  private isInitialized = false;
  private httpServer: any;
  private expressApp: Express | null = null;
  private isServerReady = false;
  private clients: Set<Socket> = new Set();
  public server: Server;
  
  // Message counting for health checks
  private messageCounts: Map<string, number> = new Map();
  private lastHealthCheck: number = Date.now();
  private totalMessagesSinceLastCheck: number = 0;

  constructor() {
    this.logger.log('SocketService constructed');
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
        
        // Log WebSocket connection event
        this.fileLogger.logWebSocketEvent('client_connected', {
          client_id: socket.id,
          transport: socket.conn.transport.name,
          remote_address: socket.conn.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        socket.on('disconnect', (reason) => {
          this.logger.log(`❌ Client disconnected - ID: ${socket.id}, reason: ${reason}`);
          
          // Log WebSocket disconnection event
          this.fileLogger.logWebSocketEvent('client_disconnected', {
            client_id: socket.id,
            reason: reason,
            timestamp: new Date().toISOString()
          });
        });

        socket.on('error', (error) => {
          this.logger.error(`Socket error for client ${socket.id}: ${error.message}`);
          
          // Log WebSocket error event
          this.fileLogger.logWebSocketEvent('client_error', {
            client_id: socket.id,
            error: error.message,
            timestamp: new Date().toISOString()
          });
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
    this.logger.log('Initializing SocketService...');
    this.isServerReady = true;
    this.logger.log('SocketService initialized');
  }

  broadcastNewPool(message: PoolBroadcastMessage) {
    if (!this.isInitialized || !this.server) {
      this.logger.error('Socket.IO server not started');
      return;
    }

    this.logger.log(`📢 Broadcasting new pool: ${message.pool_id}`);
    this.trackMessage('new_pool');
    
    // Log WebSocket new pool event
    this.fileLogger.logWebSocketEvent('new_pool_broadcast', {
      pool_id: message.pool_id,
      base_token: message.data.base_token,
      quote_token: message.data.quote_token,
      timestamp: new Date().toISOString()
    });
    
    this.server.emit('new_pool', message);
  }

  broadcastHealth(uptime: number) {
    if (!this.isInitialized || !this.server) {
      return;
    }

    const now = Date.now();
    const timeSinceLastCheck = now - this.lastHealthCheck;
    const messagesPerMinute = timeSinceLastCheck > 0 ? (this.totalMessagesSinceLastCheck / timeSinceLastCheck) * 60000 : 0;

    const message = {
      timestamp: new Date().toISOString(),
      uptime,
      messages_since_last_check: this.totalMessagesSinceLastCheck,
      messages_per_minute: Math.round(messagesPerMinute),
      time_since_last_check_ms: timeSinceLastCheck,
      active_clients: this.clients.size
    };
    
    // Log WebSocket health event (but only occasionally to avoid spam)
    if (this.totalMessagesSinceLastCheck > 0) {
      this.fileLogger.logWebSocketEvent('health_broadcast', {
        uptime: uptime,
        messages_since_last_check: this.totalMessagesSinceLastCheck,
        messages_per_minute: Math.round(messagesPerMinute),
        active_clients: this.clients.size,
        timestamp: new Date().toISOString()
      });
    }
    
    // Emit to the pools namespace (for existing clients)
    this.server.emit('health', message);
    
    // The server.emit() should already broadcast to all connected clients
    // including those in the default namespace
    
    // Reset counters for next check
    this.lastHealthCheck = now;
    this.totalMessagesSinceLastCheck = 0;
    this.messageCounts.clear();
  }

  // Method to track message counts
  private trackMessage(eventType: string) {
    this.totalMessagesSinceLastCheck++;
    const currentCount = this.messageCounts.get(eventType) || 0;
    this.messageCounts.set(eventType, currentCount + 1);
  }

  private startHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    let startTime = Date.now();
    this.healthCheckInterval = setInterval(() => {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      this.broadcastHealth(uptime);
    }, 10000); // Changed back to 10 seconds
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down SocketService...');
    this.isServerReady = false;
    this.clients.clear();
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.server) {
      this.server.close();
    }
    
    // Close file logger
    this.fileLogger.close();
  }

  isReady(): boolean {
    return this.isServerReady;
  }

  broadcastPoolUpdate(message: PoolBroadcastMessage) {
    if (!this.isReady()) {
      this.logger.warn('Socket service not ready, cannot broadcast pool update');
      return;
    }

    try {
      this.trackMessage('pool_update');
      
      // Log WebSocket pool update event
      this.fileLogger.logWebSocketEvent('pool_update_broadcast', {
        pool_id: message.pool_id,
        base_token: message.data.base_token,
        quote_token: message.data.quote_token,
        timestamp: new Date().toISOString()
      });
      
      this.server.emit('pool_update', message);
    } catch (error) {
      this.logger.error('Error broadcasting pool update:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  broadcastPoolReady(message: PoolReadyMessage) {
    if (!this.isReady()) {
      this.logger.warn('Socket service not ready, cannot broadcast pool ready');
      return;
    }

    try {
      this.trackMessage('pool_ready');
      
      // Log WebSocket pool ready event
      this.fileLogger.logWebSocketEvent('pool_ready_broadcast', {
        pool_id: message.pool_id,
        base_token: message.data.base_token,
        quote_token: message.data.quote_token,
        timestamp: new Date().toISOString()
      });
      
      this.server.emit('pool_ready', message);
    } catch (error) {
      this.logger.error('Error broadcasting pool ready:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  broadcast(event: string, data: any) {
    if (!this.isReady()) {
      this.logger.warn('Socket service not ready, cannot broadcast');
      return;
    }
    
    // Log generic WebSocket broadcast event
    this.fileLogger.logWebSocketEvent(`${event}_broadcast`, {
      event: event,
      data: data,
      timestamp: new Date().toISOString()
    });
    
    this.server.emit(event, data);
  }

  setReady(ready: boolean = true) {
    this.isServerReady = ready;
    if (ready) {
      this.logger.log('Socket service is ready');
    }
  }
} 