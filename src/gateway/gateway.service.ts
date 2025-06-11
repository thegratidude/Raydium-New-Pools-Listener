import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import { PoolGateway } from './pool.gateway';
import * as express from 'express';

const HEALTH_CHECK_INTERVAL_MS = 10000; // 10 seconds
const CONSOLE_HEALTH_CHECK_INTERVAL_MS = 60000; // 1 minute
const SERVER_INIT_TIMEOUT_MS = 10000;   // 10 seconds
const SERVER_INIT_POLL_MS = 500;        // 500ms

@Injectable()
export class GatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayService.name);
  private isInitialized = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private consoleHealthCheckInterval: NodeJS.Timeout | null = null;
  private expressApp: express.Application | null = null;
  
  // Message counting for health checks
  private messageCounts: Map<string, number> = new Map();
  private lastHealthCheck: number = Date.now();
  private lastConsoleHealthCheck: number = Date.now();
  private totalMessagesSinceLastCheck: number = 0;
  private raydiumMessagesSinceLastCheck: number = 0;

  constructor(private poolGateway: PoolGateway) {}

  setExpressApp(app: express.Application) {
    this.expressApp = app;
    this.setupEndpoints();
  }

  private setupEndpoints() {
    if (!this.expressApp) return;

    // Health endpoint
    this.expressApp.get('/health', (req, res) => {
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);

      res.json({
        status: 'healthy',
        uptime: `${hours}h ${minutes}m ${seconds}s`,
        timestamp: new Date().toISOString(),
        socketServiceReady: this.poolGateway.isReady(),
        gatewayServiceReady: this.isInitialized
      });
    });

    // Synopsis endpoint
    this.expressApp.get('/synopsis', (req, res) => {
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);

      const now = Date.now();
      const timeSinceLastCheck = now - this.lastConsoleHealthCheck;
      const raydiumMessagesPerMinute = timeSinceLastCheck > 0 ? (this.raydiumMessagesSinceLastCheck / timeSinceLastCheck) * 60000 : 0;

      const synopsis = {
        status: 'operational',
        timestamp: new Date().toISOString(),
        uptime: {
          total_seconds: Math.floor(uptime),
          formatted: `${hours}h ${minutes}m ${seconds}s`
        },
        services: {
          socketService: this.poolGateway.isReady() ? 'ready' : 'not ready',
          gatewayService: this.isInitialized ? 'ready' : 'not ready'
        },
        monitoring: {
          raydiumMessagesLast60s: this.raydiumMessagesSinceLastCheck,
          raydiumMessagesPerMinute: Math.round(raydiumMessagesPerMinute),
          lastHealthCheck: new Date(this.lastConsoleHealthCheck).toISOString()
        },
        implementation: {
          monitoringMethod: 'status 1 and status 6',
          description: 'Monitoring Raydium pools for new pool creation (status 1) and tradeable pools (status 6)',
          refactored: true
        }
      };

      res.json(synopsis);
    });

    // Root endpoint with basic info
    this.expressApp.get('/', (req, res) => {
      res.json({
        service: 'Raydium Pool Listener',
        version: '2.0 (refactored)',
        endpoints: {
          health: '/health',
          synopsis: '/synopsis'
        },
        description: 'Monitors Raydium pools for new pool creation and tradeable status'
      });
    });

    this.logger.log('✅ HTTP endpoints configured: /, /health, /synopsis');
  }

  onModuleInit() {
    this.logger.log('Waiting for Socket.IO server to initialize...');
    const startTime = Date.now();
    
    const poll = () => {
      if (this.poolGateway.isReady() && this.poolGateway.server) {
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

  private startHealthChecks() {
    // Socket health checks (every 10 seconds)
    this.healthCheckInterval = setInterval(() => {
      this.broadcastHealth(process.uptime());
    }, HEALTH_CHECK_INTERVAL_MS);
    this.logger.log(`Health checks started (every ${HEALTH_CHECK_INTERVAL_MS/1000}s)`);

    // Console health checks (every 1 minute)
    this.consoleHealthCheckInterval = setInterval(() => {
      this.logConsoleHealth();
    }, CONSOLE_HEALTH_CHECK_INTERVAL_MS);
    this.logger.log(`Console health checks started (every ${CONSOLE_HEALTH_CHECK_INTERVAL_MS/1000}s)`);
  }

  private stopHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      this.logger.log('Health checks stopped');
    }
    if (this.consoleHealthCheckInterval) {
      clearInterval(this.consoleHealthCheckInterval);
      this.consoleHealthCheckInterval = null;
      this.logger.log('Console health checks stopped');
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
    this.trackMessage('new_pool');
    this.poolGateway.server.emit('new_pool', message);
  }

  broadcastHealth(uptime: number) {
    if (!this.isInitialized) {
      this.logger.error('Cannot broadcast health: Socket.IO server not initialized');
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
      time_since_last_check_ms: timeSinceLastCheck
    };

    // Removed log statement to reduce noise - health messages are still being broadcast
    
    // Emit to the default namespace where the Python client is connecting
    this.poolGateway.server.emit('health', message);
    
    // Reset counters for next check
    this.lastHealthCheck = now;
    this.totalMessagesSinceLastCheck = 0;
    this.messageCounts.clear();
  }

  private logConsoleHealth() {
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastConsoleHealthCheck;
    const raydiumMessagesPerMinute = timeSinceLastCheck > 0 ? (this.raydiumMessagesSinceLastCheck / timeSinceLastCheck) * 60000 : 0;
    
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    this.logger.log('═══════════════════════════════════════════════════════════════════════════════════');
    this.logger.log(`🏥 NESTJS HEALTH CHECK - ${new Date().toLocaleTimeString()}`);
    this.logger.log(`⏱️  Server uptime: ${hours}h ${minutes}m ${seconds}s`);
    this.logger.log(`📨 Raydium messages received: ${this.raydiumMessagesSinceLastCheck} (last ${Math.round(timeSinceLastCheck/1000)}s)`);
    this.logger.log(`📊 Raydium messages per minute: ${Math.round(raydiumMessagesPerMinute)}`);
    this.logger.log(`🔗 Socket service ready: ${this.poolGateway.isReady()}`);
    this.logger.log('═══════════════════════════════════════════════════════════════════════════════════\n');

    // Reset counter for next check
    this.lastConsoleHealthCheck = now;
    this.raydiumMessagesSinceLastCheck = 0;
  }

  // Method to track message counts
  private trackMessage(eventType: string) {
    this.totalMessagesSinceLastCheck++;
    const currentCount = this.messageCounts.get(eventType) || 0;
    this.messageCounts.set(eventType, currentCount + 1);
  }

  // Method to track Raydium messages specifically
  trackRaydiumMessage() {
    this.raydiumMessagesSinceLastCheck++;
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}