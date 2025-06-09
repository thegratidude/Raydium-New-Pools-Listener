import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import { SocketService } from './socket.service';

const HEALTH_CHECK_INTERVAL_MS = 10000; // 10 seconds
const SERVER_INIT_TIMEOUT_MS = 10000;   // 10 seconds
const SERVER_INIT_POLL_MS = 500;        // 500ms

@Injectable()
export class GatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayService.name);
  private isInitialized = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  
  // Message counting for health checks
  private messageCounts: Map<string, number> = new Map();
  private lastHealthCheck: number = Date.now();
  private totalMessagesSinceLastCheck: number = 0;

  constructor(private socketService: SocketService) {}

  onModuleInit() {
    this.logger.log('Waiting for Socket.IO server to initialize...');
    const startTime = Date.now();
    
    const poll = () => {
      if (this.socketService.isReady() && this.socketService.server) {
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
    this.trackMessage('new_pool');
    this.socketService.server.emit('new_pool', message);
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

    this.logger.log(`🏥 Broadcasting health message...`);
    
    // Emit to the default namespace where the Python client is connecting
    this.socketService.server.emit('health', message);
    
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

  isReady(): boolean {
    return this.isInitialized;
  }
}