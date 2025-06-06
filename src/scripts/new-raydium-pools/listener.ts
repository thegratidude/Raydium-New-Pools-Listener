import { Logger, INestApplication } from '@nestjs/common';
import {
  Connection,
  ParsedInstruction,
  PartiallyDecodedInstruction,
  PublicKey,
} from '@solana/web3.js';
import { sleep } from '../../utils/sleep';
import { liuquidityPoolIndex, quoteIndex, tokenMintIndex } from './constants';
// import { getPoolMonitor } from './pool-monitor';
import { PendingPoolManager } from '../../monitor/pending-pool-manager';
import { PoolMonitorManager } from '../../monitor/pool-monitor-manager';
import { insertPoolHistory, initPoolHistoryDB } from '../../monitor/pool-history-db';
import { simulateRoundTripTrade } from '../../monitor/utils';
import * as dotenv from 'dotenv';
import { senseTop, DEFAULT_PLATEAU_WINDOW } from '../../utils/senseTop';
import { PoolMonitorService } from '../../monitor/pool-monitor.service';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
dotenv.config();

const HTTP_URL = process.env.HTTP_URL!;
const WSS_URL = process.env.WSS_URL!;

const connection = new Connection(HTTP_URL);

// Initialize SQLite DB for pool history
initPoolHistoryDB();

// Initialize services
let poolMonitorService: PoolMonitorService;
let poolMonitorManager: PoolMonitorManager;
let pendingPoolManager: PendingPoolManager;

export async function initializeServices(app: INestApplication) {
  // Get services from the existing NestJS container
  poolMonitorService = app.get(PoolMonitorService);
  poolMonitorManager = app.get(PoolMonitorManager);
  
  // Create PendingPoolManager with injected services
  pendingPoolManager = new PendingPoolManager(
    app.get(Connection),
    poolMonitorService
  );
  
  console.log('✅ Services initialized: PoolMonitorService and PoolMonitorManager');
}

// Add a mapping from mint addresses to symbols and decimals
const MINT_TO_TOKEN = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9 },
  'EPjFWdd5AufqSSqeM2qAqAqAqAqAqAqAqAqAqAqAqAqA': { symbol: 'USDC', decimals: 6 },
  'Es9vMFrzaCERkB1zr6zQ6iF3bJbZZd2Qb52b6JhLHZtz': { symbol: 'USDT', decimals: 6 },
  // Add more tokens as needed
};

// Helper to truncate addresses for concise output
function truncateAddress(addr, len = 4) {
  if (!addr) return '';
  return `${addr.slice(0, len)}...${addr.slice(-len)}`;
}

// Track recent profit % history for each pool
const profitHistoryMap = new Map();

// Concise default onUpdate callback with DB write
function conciseOnUpdate(snapshot, pressure, tokenA, tokenB, originPrice, originBaseReserve, originQuoteReserve, prevSnapshot, poolIdOverride) {
  // Format TVL as $###k
  const tvlK = (snapshot.tvl / 1000).toFixed(0) + 'k';
  // Truncate base mint address for concise output
  const baseMint = tokenA.mint || '';
  const truncatedBaseMint = truncateAddress(baseMint, 4);
  // Always show /SOL as the pair
  const pairStr = `${truncatedBaseMint}/SOL`;

  // Restore profit calculation and colorization
  let profitStr = '';
  let profitPct = 0;
  if (originBaseReserve && originQuoteReserve && snapshot.baseReserve && snapshot.quoteReserve) {
    const sim = simulateRoundTripTrade({
      originBase: originBaseReserve,
      originQuote: originQuoteReserve,
      currentBase: snapshot.baseReserve,
      currentQuote: snapshot.quoteReserve,
      tradeSize: 1,
      feeBps: 25,
    });
    profitPct = sim.profitPct;
    // Colorize profit: green for positive, red for negative
    const profitColor = sim.profitPct >= 0 ? '\x1b[32m' : '\x1b[31m'; // green or red
    const resetColor = '\x1b[0m';
    profitStr = `Profit ${profitColor}${sim.profitPct >= 0 ? '+' : ''}${sim.profitPct.toFixed(2)}% (${sim.netProfit.toFixed(2)} SOL)${resetColor}`;
  }

  // Track profit history for this pool
  const poolId = snapshot.poolId || poolIdOverride || '';
  let history = profitHistoryMap.get(poolId) || [];
  history.push(profitPct);
  if (history.length > 10) history = history.slice(-10); // keep last 10
  profitHistoryMap.set(poolId, history);

  // Check for top
  if (senseTop(history)) {
    console.log('\x1b[41m\x1b[97m***************** TOP IDENTIFIED *********************\x1b[0m');
  }

  // Print concise output: truncated base mint, /SOL, price, TVL, base/quote reserves, profit
  console.log(
    `${pairStr} | $${snapshot.price.toFixed(4)} | TVL $${tvlK} | Base: ${snapshot.baseReserve.toFixed(2)} | Quote: ${snapshot.quoteReserve.toFixed(2)} | ${profitStr}`
  );
}

// Health check: count messages seen
let messageCount = 0;
setInterval(() => {
  console.log(`🩺 Health check: ${messageCount} messages seen in the last minute`);
  messageCount = 0;
}, 60_000);

function isPartiallyDecodedInstruction(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
): instruction is PartiallyDecodedInstruction {
  return (instruction as PartiallyDecodedInstruction).accounts !== undefined;
}

// Constants
const RAYDIUM_PUBLIC_KEY = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

// Modify the pool detection handler
async function handleNewPool(liquidityPoolAddressAccount: string, tokenAAccount: PublicKey, tokenBAccount: PublicKey) {
  console.log('\n📊 Pool Details:');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log(`Token A: ${tokenAAccount.toBase58()}`);
  console.log(`Token B: ${tokenBAccount.toBase58()}`);
  console.log(`Pool Address: ${liquidityPoolAddressAccount}`);
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  if (liquidityPoolAddressAccount) {
    console.log(`\n➕ Adding pool to monitor service: ${liquidityPoolAddressAccount}`);
    
    // Add pool to PoolMonitorService which will handle both broadcast and monitoring
    poolMonitorService.addNewPool(
      liquidityPoolAddressAccount,
      tokenAAccount.toBase58(),
      tokenBAccount.toBase58()
    );
  } else {
    console.log('❌ Missing liquidity pool address, skipping pool');
  }
}

// Update the fetchRaydiumMints function to use the new handler
async function fetchRaydiumMints(txId: string, connection: Connection) {
  try {
    console.log('\n🔍 Processing Transaction:');
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log(`Transaction ID: ${txId}`);
    console.log('════════════════════════════════════════════════════════════════════════════════\n');

    const tx = await connection.getParsedTransaction(txId, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) {
      console.log('❌ Transaction not found:', txId);
      return;
    }

    const instructions = tx.transaction.message.instructions;

    const raydiumInstruction = instructions.find(
      (ix) => ix.programId.toBase58() === RAYDIUM_PUBLIC_KEY,
    );

    await sleep(2000);

    if (
      raydiumInstruction &&
      isPartiallyDecodedInstruction(raydiumInstruction)
    ) {
      const accounts = raydiumInstruction.accounts as PublicKey[];

      // Token A mint
      let tokenAAccount = accounts[tokenMintIndex];

      // Token B mint
      let tokenBAccount = accounts[quoteIndex];

      if (
        tokenBAccount.toBase58() !==
          'So11111111111111111111111111111111111111112' &&
        tokenBAccount.toBase58() !==
          'EPjFWdd5AufqSSqeM2qAqAqAqAqAqAqAqAqAqAqAqAqA'
      ) {
        [tokenAAccount, tokenBAccount] = [tokenBAccount, tokenAAccount];
      }

      // Liquidity pool address
      const liquidityPoolAddressAccount =
        accounts[liuquidityPoolIndex]?.toBase58();

      await handleNewPool(liquidityPoolAddressAccount, tokenAAccount, tokenBAccount);
    } else {
      console.log('❌ No Raydium instruction found in transaction');
    }
  } catch (error) {
    console.error('❌ Error processing transaction:', error);
  }
}

export async function startConnection(
  app: INestApplication,
  connection: Connection,
  programAddress: PublicKey,
  searchInstruction: string,
): Promise<void> {
  // Initialize services with the app instance
  await initializeServices(app);

  console.log('Monitoring logs for program:', programAddress.toString());
  connection.onLogs(
    programAddress,
    ({ logs, err, signature }) => {
      if (err) return;

      // Increment message count for every log event
      messageCount++;

      if (logs && logs.some((log) => log.includes(searchInstruction))) {
        console.log(
          "Signature for 'initialize2':",
          `https://explorer.solana.com/tx/${signature}`,
        );
        fetchRaydiumMints(signature, connection);
      }
    },
    'confirmed',
  );
}
