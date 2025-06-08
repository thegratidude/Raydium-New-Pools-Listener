import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { startConnection } from './scripts/new-raydium-pools/listener.js';
import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { Logger } from '@nestjs/common';

// Suppress all non-critical warnings
process.on('warning', (warning) => {
  // Suppress specific warnings we know about
  if (
    warning.name === 'DeprecationWarning' || // Suppress all deprecation warnings
    warning.message.includes('punycode') || // Suppress punycode warning
    warning.message.includes('bigint') // Suppress bigint warning
  ) {
    return;
  }
  // Log other warnings that might be important
  console.warn(warning);
});

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

const RAYDIUM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const INSTRUCTION_NAME = 'initialize';
const HTTP_URL = process.env.HTTP_URL!;
const rpcConnection = new Connection(HTTP_URL);

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    // Disable the built-in HTTP server since we're using our own
    bodyParser: true,
    cors: true,
    logger: ['error', 'warn', 'log'], // Only show error, warn, and log levels
  });

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

  // Start the pool listener with the existing app instance
  await startConnection(app, rpcConnection, RAYDIUM, INSTRUCTION_NAME);

  // Keep the application running
  await app.listen(0); // Listen on a random port since we're using our own HTTP server
}

bootstrap();
