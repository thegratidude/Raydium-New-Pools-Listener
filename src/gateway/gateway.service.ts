import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as net from 'net';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

@WebSocketGateway({
  port: 0, // Start with a random port, we'll change it after initialization
  cors: {
    origin: '*', // In production, you should restrict this to specific origins
  },
})
export class GatewayService implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;
  
  private readonly logger = new Logger(GatewayService.name);
  private readonly PORT = 5002;
  private readonly currentPid = process.pid;
  private readonly isWindows = os.platform() === 'win32';
  private isInitialized = false;
  private hasLsof = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  async onModuleInit() {
    if (this.isInitialized) return;
    
    try {
      // Check if lsof is available (for non-Windows systems)
      if (!this.isWindows) {
        try {
          await execAsync('which lsof');
          this.hasLsof = true;
        } catch {
          this.logger.log('lsof not available, using basic port check');
        }
      }

      // Check and free the port BEFORE starting the server
      await this.ensurePortAvailable();
      
      // Now that we know the port is free, close the random port server
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server.close(() => resolve());
        });
      }

      // Create server with error handling
      const io = new Server(this.PORT, {
        cors: {
          origin: '*',
        },
      });

      // Verify server started successfully
      await this.verifyServerStarted(io);
      
      this.server = io;
      this.isInitialized = true;
      
      // Start health check ping
      this.startHealthCheck();
      
      this.logger.log(`WebSocket server successfully started and verified on port ${this.PORT}`);
    } catch (error) {
      this.logger.error('Failed to initialize WebSocket server:', error);
      // Clean up if server was created but verification failed
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server.close(() => resolve());
        });
      }
      throw error;
    }
  }

  async onModuleDestroy() {
    this.stopHealthCheck();
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
    }
  }

  private async verifyServerStarted(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
      // Set a timeout for the verification
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to start on port ${this.PORT} within 5 seconds`));
      }, 5000);

      // Try to connect to the server to verify it's running
      const testClient = new net.Socket();
      
      testClient.on('connect', () => {
        clearTimeout(timeout);
        testClient.destroy();
        resolve();
      });

      testClient.on('error', (error) => {
        clearTimeout(timeout);
        testClient.destroy();
        reject(new Error(`Server verification failed: ${error.message}`));
      });

      // Attempt to connect to the server
      testClient.connect(this.PORT, 'localhost');
    });
  }

  private async ensurePortAvailable() {
    try {
      // Check if port is in use by another process
      const isInUse = await this.isPortInUseByOtherProcess(this.PORT);
      
      if (isInUse) {
        this.logger.warn(`Port ${this.PORT} is in use by another process. Attempting to free it...`);
        await this.killProcessOnPort(this.PORT);
        
        // Wait a moment for the port to be freed
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Double check the port is now free
        const stillInUse = await this.isPortInUseByOtherProcess(this.PORT);
        if (stillInUse) {
          throw new Error(`Failed to free port ${this.PORT}`);
        }
        
        this.logger.log(`Successfully freed port ${this.PORT}`);
      } else {
        this.logger.log(`Port ${this.PORT} is available`);
      }
    } catch (error) {
      this.logger.error(`Error managing port ${this.PORT}:`, error);
      throw error;
    }
  }

  private async isPortInUseByOtherProcess(port: number): Promise<boolean> {
    try {
      if (this.isWindows) {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
        if (stdout) {
          const lines = stdout.split('\n');
          return lines.some(line => {
            const pid = line.split(/\s+/).pop();
            return pid && pid !== this.currentPid.toString();
          });
        }
        return false;
      } else {
        // macOS/Linux
        if (this.hasLsof) {
          const { stdout } = await execAsync(`lsof -i :${port} -t`);
          const pids = stdout.trim().split('\n').filter(pid => pid && pid !== this.currentPid.toString());
          return pids.length > 0;
        }
        // If lsof is not available, go straight to basic port check
        return this.isPortInUse(port);
      }
    } catch (error) {
      // Only log as debug if we were trying to use lsof and it failed
      if (!this.isWindows && this.hasLsof) {
        this.logger.debug('Process detection failed, falling back to basic port check');
      }
      return this.isPortInUse(port);
    }
  }

  private isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer()
        .once('error', () => {
          resolve(true);
        })
        .once('listening', () => {
          server.close();
          resolve(false);
        })
        .listen(port);
    });
  }

  private async killProcessOnPort(port: number): Promise<void> {
    try {
      if (this.isWindows) {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
        if (stdout) {
          const lines = stdout.split('\n');
          for (const line of lines) {
            const pid = line.split(/\s+/).pop();
            if (pid && pid !== this.currentPid.toString()) {
              this.logger.log(`Found process ${pid} using port ${port}`);
              await execAsync(`taskkill /F /PID ${pid}`);
              this.logger.log(`Killed process ${pid}`);
            }
          }
        }
      } else {
        // macOS/Linux
        const { stdout } = await execAsync(`lsof -i :${port} -t`);
        const pids = stdout.trim().split('\n').filter(pid => pid && pid !== this.currentPid.toString());
        
        for (const pid of pids) {
          this.logger.log(`Found process ${pid} using port ${port}`);
          await execAsync(`kill -9 ${pid}`);
          this.logger.log(`Killed process ${pid}`);
        }
      }
    } catch (error) {
      this.logger.error('Failed to kill process on port:', error);
      throw new Error(`Could not kill process on port ${port}`);
    }
  }

  private startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(() => {
      if (this.isInitialized) {
        try {
          this.server.emit('health', {
            timestamp: new Date().toISOString(),
            status: 'ok',
            uptime: process.uptime()
          });
        } catch (error) {
          this.logger.error('Failed to send health check:', error);
        }
      }
    }, 10000); // 10 seconds
  }

  private stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  broadcastNewPool(poolAddress: string) {
    if (!this.isInitialized) {
      this.logger.warn('Attempted to broadcast before server initialization');
      return;
    }
    try {
      this.server.emit('newPool', {
        action: 'BUY',
        poolAddress,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Failed to broadcast new pool:', error);
    }
  }
} 