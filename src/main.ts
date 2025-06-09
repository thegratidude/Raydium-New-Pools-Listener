import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { startListener } from './scripts/new-raydium-pools/listener';
import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { Logger } from '@nestjs/common';
import * as express from 'express';
import { SocketService } from './gateway/socket.service';

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

export const INSTRUCTION_NAME = 'initialize2';

export const rpcConnection = new Connection(HTTP_URL, {
  wsEndpoint: WSS_URL,
});

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const expressApp = express();
  
  const app = await NestFactory.create(AppModule, {
    // Disable the built-in HTTP server since we're using our own
    bodyParser: true,
    cors: true,
    logger: ['error', 'warn', 'log'], // Only show error, warn, and log levels
  });

  // Get the SocketService and set the Express app before app.init()
  const socketService = app.get(SocketService);
  socketService.setExpressApp(expressApp);

  // Configure minimal logging
  app.useLogger(new Logger('App'));

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
  
  logger.log('Application ready');

  // Start the pool listener with the app instance
  await startListener(app, rpcConnection, RAYDIUM, INSTRUCTION_NAME);

  // Keep the application running
  await app.listen(0); // Listen on a random port since we're using our own HTTP server
}

bootstrap();
