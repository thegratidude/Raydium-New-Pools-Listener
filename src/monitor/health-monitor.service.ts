import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SocketService } from '../gateway/socket.service';

@Injectable()
export class HealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthMonitorService.name);
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private raydiumMessageCount: number = 0;
  private lastHealthCheck: number = Date.now();
  private startTime: number = Date.now();

  constructor(private readonly socketService: SocketService) {}

  async onModuleInit() {
    this.logger.log('HealthMonitorService initialized');
    this.startHealthChecks();
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down HealthMonitorService...');
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }

  // Method to track Raydium messages
  trackRaydiumMessage() {
    this.raydiumMessageCount++;
  }

  private startHealthChecks() {
    this.healthCheckInterval = setInterval(() => {
      this.logHealthStatus();
    }, 10000); // Every 10 seconds
  }

  private logHealthStatus() {
    const now = Date.now();
    const uptime = Math.floor((now - this.startTime) / 1000);
    const timeSinceLastCheck = now - this.lastHealthCheck;
    const messagesPerMinute = timeSinceLastCheck > 0 ? (this.raydiumMessageCount / timeSinceLastCheck) * 60000 : 0;

    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    this.logger.log('═══════════════════════════════════════════════════════════════════════════════════');
    this.logger.log(`⏰ Uptime: ${hours}h ${minutes}m ${seconds}s`);
    this.logger.log(`📨 Raydium messages in last ${Math.round(timeSinceLastCheck/1000)}s: ${this.raydiumMessageCount}`);
    this.logger.log(`📊 Messages per minute: ${Math.round(messagesPerMinute)}`);
    this.logger.log(`🔗 Socket service ready: ${this.socketService.isReady()}`);
    this.logger.log('═══════════════════════════════════════════════════════════════════════════════════\n');

    // Reset counter for next check
    this.lastHealthCheck = now;
    this.raydiumMessageCount = 0;
  }
} 