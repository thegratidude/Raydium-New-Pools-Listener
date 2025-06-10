import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { Logger } from '@nestjs/common';
import * as express from 'express';
import { SocketService } from './gateway/socket.service';
import { GatewayService } from './gateway/gateway.service';
import { FileLoggerService } from './utils/file-logger.service';

// Kill any process using port 5001 (macOS/Linux only)
try {
  const pid = execSync("lsof -ti:5001").toString().trim();
  if (pid) {
    console.log(`Killing process on port 5001 (PID: ${pid})`);
    execSync(`kill -9 ${pid}`);
  }
} catch (e) {
  // No process found or error occurred, ignore
}

// Load environment variables
dotenv.config();

export const RAYDIUM_PUBLIC_KEY =
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

if (!process.env.HTTP_URL || !process.env.WSS_URL) {
  throw new Error('HTTP_URL and WSS_URL must be defined in .env file');
}

export const HTTP_URL = process.env.HTTP_URL;
export const WSS_URL = process.env.WSS_URL;

export const RAYDIUM = new PublicKey(RAYDIUM_PUBLIC_KEY);

export const INSTRUCTION_NAMES = [
  'initialize2',           // Original instruction
  'initialize',            // Alternative initialization
  'createPool',           // Pool creation instruction
  'createAmm',            // AMM creation
  'initializeAmm',        // AMM initialization
  'createPoolV4',         // V4 pool creation
  'initializePoolV4'      // V4 pool initialization
];

export const INSTRUCTION_NAME = 'initialize2';

export const rpcConnection = new Connection(HTTP_URL, {
  wsEndpoint: WSS_URL,
});

async function bootstrap() {
  // Initialize file logger
  const fileLogger = new FileLoggerService();
  
  const logger = new Logger('Bootstrap');
  const expressApp = express();
  
  const app = await NestFactory.create(AppModule, {
    // Disable the built-in HTTP server since we're using our own
    bodyParser: true,
    cors: true,
    logger: fileLogger, // Use our custom file logger
  });

  // Configure logging with our file logger
  app.useLogger(fileLogger);

  const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };

  app.enableCors(corsOptions);

  // Initialize the application and wait for all modules to be ready
  await app.init();
  
  // Get the SocketService and set the Express app AFTER app.init()
  const socketService = app.get(SocketService);
  socketService.setExpressApp(expressApp);

  // Get the GatewayService and set the Express app for HTTP endpoints
  const gatewayService = app.get(GatewayService);
  if (gatewayService && typeof gatewayService.setExpressApp === 'function') {
    gatewayService.setExpressApp(expressApp);
  }

  // Wait for SocketService to be ready
  logger.log('Waiting for SocketService to initialize...');
  let attempts = 0;
  const maxAttempts = 30;
  
  while (attempts < maxAttempts) {
    if (socketService.isReady()) {
      logger.log('✅ SocketService is ready');
      break;
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
    
    if (attempts % 5 === 0) {
      logger.log(`⏳ Still waiting for SocketService... (${attempts}s)`);
    }
  }
  
  if (attempts >= maxAttempts) {
    logger.error('❌ SocketService initialization timeout');
  }
  
  logger.log('Application ready');
  fileLogger.log('NestJS application started with file logging enabled', 'Bootstrap');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    fileLogger.log('Received SIGINT, shutting down gracefully...', 'Bootstrap');
    fileLogger.close();
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    fileLogger.log('Received SIGTERM, shutting down gracefully...', 'Bootstrap');
    fileLogger.close();
    await app.close();
    process.exit(0);
  });

  // Keep the application running without starting the built-in HTTP server
  // The SocketService handles its own HTTP server on port 5001
  await new Promise(() => {
    // Keep the process alive indefinitely
    // The SocketService HTTP server is already running
  });
}

bootstrap();
