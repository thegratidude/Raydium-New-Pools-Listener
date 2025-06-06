import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { startConnection } from './scripts/new-raydium-pools/listener';
import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';

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
  const app = await NestFactory.create(AppModule);

  const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };

  app.enableCors(corsOptions);

  await app.listen(5001);
  // Start the pool listener in parallel (do not await, so both run at the same time)
  startConnection(rpcConnection, RAYDIUM, INSTRUCTION_NAME).catch(console.error);
}

bootstrap();
