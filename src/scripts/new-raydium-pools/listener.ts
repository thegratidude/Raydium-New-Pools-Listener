import { Logger, INestApplication } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PoolMonitorService } from '../../monitor/pool-monitor.service';
import { sleep } from '../../utils/sleep';
import * as dotenv from 'dotenv';

dotenv.config();

const HTTP_URL = process.env.HTTP_URL!;
const WSS_URL = process.env.WSS_URL!;
const RAYDIUM_PUBLIC_KEY = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

// Constants for account indices in Raydium instructions
const LIQUIDITY_POOL_INDEX = 8;
const TOKEN_MINT_INDEX = 4;
const QUOTE_INDEX = 5;

const logger = new Logger('RaydiumListener');

async function handleNewPool(
  poolMonitorService: PoolMonitorService,
  liquidityPoolAddress: string,
  tokenAMint: string,
  tokenBMint: string
) {
  logger.log('\n📊 New Pool Detected:');
  logger.log('════════════════════════════════════════════════════════════════════════════════');
  logger.log(`Token A Mint: ${tokenAMint}`);
  logger.log(`Token B Mint: ${tokenBMint}`);
  logger.log(`Pool Address: ${liquidityPoolAddress}`);
  logger.log('════════════════════════════════════════════════════════════════════════════════\n');

  if (liquidityPoolAddress) {
    logger.log(`➕ Adding pool to monitor service: ${liquidityPoolAddress}`);
    poolMonitorService.addPool(liquidityPoolAddress, tokenAMint, tokenBMint);
  } else {
    logger.error('❌ Missing liquidity pool address, skipping pool');
  }
}

async function processTransaction(
  poolMonitorService: PoolMonitorService,
  connection: Connection,
  txId: string
) {
  try {
    logger.log('\n🔍 Processing Transaction:');
    logger.log('════════════════════════════════════════════════════════════════════════════════');
    logger.log(`Transaction ID: ${txId}`);
    logger.log('════════════════════════════════════════════════════════════════════════════════\n');

    const tx = await connection.getParsedTransaction(txId, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) {
      logger.error('❌ Transaction not found:', txId);
      return;
    }

    const instructions = tx.transaction.message.instructions;
    const raydiumInstruction = instructions.find(
      (ix) => ix.programId.toBase58() === RAYDIUM_PUBLIC_KEY
    );

    await sleep(2000);

    if (raydiumInstruction && 'accounts' in raydiumInstruction) {
      const accounts = raydiumInstruction.accounts as PublicKey[];

      // Get token mints
      let tokenAMint = accounts[TOKEN_MINT_INDEX].toBase58();
      let tokenBMint = accounts[QUOTE_INDEX].toBase58();

      // Ensure SOL is always token B
      if (
        tokenBMint !== 'So11111111111111111111111111111111111111112' &&
        tokenBMint !== 'EPjFWdd5AufqSSqeM2qAqAqAqAqAqAqAqAqAqAqAqAqA'
      ) {
        [tokenAMint, tokenBMint] = [tokenBMint, tokenAMint];
      }

      const liquidityPoolAddress = accounts[LIQUIDITY_POOL_INDEX]?.toBase58();
      await handleNewPool(poolMonitorService, liquidityPoolAddress, tokenAMint, tokenBMint);
    } else {
      logger.log('❌ No Raydium instruction found in transaction');
    }
  } catch (error) {
    logger.error('❌ Error processing transaction:', error);
  }
}

export async function startListener(
  app: INestApplication,
  connection: Connection,
  raydiumProgram: PublicKey,
  instructionName: string
) {
  const poolMonitorService = app.get(PoolMonitorService);

  // The SocketService is already handling the HTTP server on port 5001
  // No need to call app.listen(5001) here
  logger.log('Raydium listener started and ready to monitor new pools');

  // Monitor Raydium program logs
  logger.log('Monitoring logs for program:', raydiumProgram.toString());

  connection.onLogs(
    raydiumProgram,
    ({ logs, err, signature }) => {
      if (err) return;

      if (logs && logs.some((log) => log.includes(instructionName))) {
        logger.log(
          `Signature for '${instructionName}':`,
          `https://explorer.solana.com/tx/${signature}`
        );
        processTransaction(poolMonitorService, connection, signature);
      }
    },
    'confirmed'
  );
}
