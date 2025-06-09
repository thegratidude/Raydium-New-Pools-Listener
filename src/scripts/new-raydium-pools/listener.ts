import { Logger, INestApplication } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PoolMonitorService } from '../../monitor/pool-monitor.service';
import { HealthMonitorService } from '../../monitor/health-monitor.service';
import { sleep } from '../../utils/sleep';
import { LIQUIDITY_STATE_LAYOUT_V4 } from '../../scripts/pool-monitor/raydium-layout';
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
      
      logger.log(`📊 Found Raydium instruction with ${accounts.length} accounts`);

      // Try to identify pool-related accounts
      let liquidityPoolAddress: string | undefined;
      let tokenAMint: string | undefined;
      let tokenBMint: string | undefined;

      // Method 1: Try to get from account indices (may not work for all instructions)
      if (accounts.length > LIQUIDITY_POOL_INDEX) {
        liquidityPoolAddress = accounts[LIQUIDITY_POOL_INDEX]?.toBase58();
      }
      if (accounts.length > TOKEN_MINT_INDEX) {
        tokenAMint = accounts[TOKEN_MINT_INDEX]?.toBase58();
      }
      if (accounts.length > QUOTE_INDEX) {
        tokenBMint = accounts[QUOTE_INDEX]?.toBase58();
      }

      // Method 2: Check if any of the accounts is actually a pool by trying to decode them
      for (const account of accounts) {
        try {
          const accountInfo = await connection.getAccountInfo(account);
          if (accountInfo && accountInfo.data.length > 0) {
            // Try to decode as a pool state
            const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.data);
            
            // If we can decode it, this is likely a pool
            const poolId = account.toBase58();
            logger.log(`✅ Found pool account: ${poolId}`);
            
            // Extract token mints from the pool state
            const baseMint = new PublicKey(poolState.coinMintAddress).toBase58();
            const quoteMint = new PublicKey(poolState.pcMintAddress).toBase58();
            
            await handleNewPool(poolMonitorService, poolId, baseMint, quoteMint);
            return; // Found a pool, no need to continue
          }
        } catch (decodeError) {
          // Not a pool state, continue checking other accounts
          continue;
        }
      }

      // Method 3: Fallback to original method if we have the required data
      if (liquidityPoolAddress && tokenAMint && tokenBMint) {
        // Ensure SOL is always token B
        if (
          tokenBMint !== 'So11111111111111111111111111111111111111112' &&
          tokenBMint !== 'EPjFWdd5AufqSSqeM2qAqAqAqAqAqAqAqAqAqAqAqAqA'
        ) {
          [tokenAMint, tokenBMint] = [tokenBMint, tokenAMint];
        }

        await handleNewPool(poolMonitorService, liquidityPoolAddress, tokenAMint, tokenBMint);
      } else {
        logger.log('❌ Could not identify pool information from transaction accounts');
      }
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
  instructionNames: string[]
) {
  const poolMonitorService = app.get(PoolMonitorService);
  const healthMonitorService = app.get(HealthMonitorService);

  logger.log('Raydium listener started and ready to monitor new pools');
  logger.log('Monitoring logs for program:', raydiumProgram.toString());
  logger.log('Watching for ray_log entries and instruction names:', instructionNames.join(', '));

  // Method 1: Monitor program logs for ray_log entries and specific instructions
  connection.onLogs(
    raydiumProgram,
    ({ logs, err, signature }) => {
      if (err) return;

      // Track all Raydium messages for health monitoring
      healthMonitorService.trackRaydiumMessage();

      // Check for ray_log entries (Raydium's custom log format)
      const hasRayLog = logs && logs.some((log) => log.includes('ray_log:'));
      
      // Check if any of the instruction names are in the logs
      const hasMatchingInstruction = instructionNames.some(instructionName => 
        logs && logs.some((log) => log.includes(instructionName))
      );

      if (hasRayLog || hasMatchingInstruction) {
        const matchedInstruction = hasMatchingInstruction ? 
          instructionNames.find(instructionName => 
            logs && logs.some((log) => log.includes(instructionName))
          ) : 'ray_log';
        
        logger.log(
          `🔍 Raydium activity detected - ${hasRayLog ? 'ray_log' : matchedInstruction}:`,
          `https://explorer.solana.com/tx/${signature}`
        );
        
        // Process the transaction to check if it's a new pool
        processTransaction(poolMonitorService, connection, signature);
      }
    },
    'confirmed'
  );

  // Method 2: Monitor program account changes (alternative detection)
  logger.log('Setting up program account change monitoring...');
  connection.onProgramAccountChange(
    raydiumProgram,
    async (accountInfo, context) => {
      try {
        // Track for health monitoring
        healthMonitorService.trackRaydiumMessage();
        
        const poolId = accountInfo.accountId.toString();
        logger.log(`🔍 New program account change detected: ${poolId}`);
        
        // Try to decode as a pool state to see if it's a new pool
        try {
          // This will throw if it's not a valid pool state
          const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.accountInfo.data);
          
          // If we can decode it, it's likely a new pool
          logger.log(`✅ New pool detected via account change: ${poolId}`);
          
          // Extract token mints from the pool state
          const baseMint = new PublicKey(poolState.coinMintAddress).toBase58();
          const quoteMint = new PublicKey(poolState.pcMintAddress).toBase58();
          
          await handleNewPool(poolMonitorService, poolId, baseMint, quoteMint);
          
        } catch (decodeError) {
          // Not a pool state, ignore
          logger.debug(`Account ${poolId} is not a pool state, ignoring`);
        }
        
      } catch (error) {
        logger.error('Error processing program account change:', error);
      }
    },
    'confirmed'
  );

  logger.log('✅ Both log monitoring and account change monitoring are active');
}
