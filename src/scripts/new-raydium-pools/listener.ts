import { Logger } from '@nestjs/common';
import {
  Connection,
  ParsedInstruction,
  PartiallyDecodedInstruction,
  PublicKey,
} from '@solana/web3.js';
import { RAYDIUM_PUBLIC_KEY } from 'src/main';
import { sleep } from 'src/utils/sleep';
import { liuquidityPoolIndex, quoteIndex, tokenMintIndex } from './constants';
// import { getPoolMonitor } from './pool-monitor';
import { PendingPoolManager } from '../../monitor/pending-pool-manager';
import { PoolMonitorManager } from '../../monitor/pool-monitor-manager';
import { insertPoolHistory, initPoolHistoryDB } from '../../monitor/pool-history-db';
import { simulateRoundTripTrade } from '../../monitor/utils';
import * as dotenv from 'dotenv';
dotenv.config();

const HTTP_URL = process.env.HTTP_URL!;
const WSS_URL = process.env.WSS_URL!;

const connection = new Connection(HTTP_URL);
const poolMonitorManager = new PoolMonitorManager({ httpUrl: HTTP_URL, wssUrl: WSS_URL });

// Initialize SQLite DB for pool history
initPoolHistoryDB();

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
  if (originBaseReserve && originQuoteReserve && snapshot.baseReserve && snapshot.quoteReserve) {
    const sim = simulateRoundTripTrade({
      originBase: originBaseReserve,
      originQuote: originQuoteReserve,
      currentBase: snapshot.baseReserve,
      currentQuote: snapshot.quoteReserve,
      tradeSize: 1,
      feeBps: 25,
    });
    // Colorize profit: green for positive, red for negative
    const profitColor = sim.profitPct >= 0 ? '\x1b[32m' : '\x1b[31m'; // green or red
    const resetColor = '\x1b[0m';
    profitStr = `Profit ${profitColor}${sim.profitPct >= 0 ? '+' : ''}${sim.profitPct.toFixed(2)}% (${sim.netProfit.toFixed(2)} SOL)${resetColor}`;
  }

  // Print concise output: truncated base mint, /SOL, price, TVL, base/quote reserves, profit
  console.log(
    `${pairStr} | $${snapshot.price.toFixed(4)} | TVL $${tvlK} | Base: ${snapshot.baseReserve.toFixed(2)} | Quote: ${snapshot.quoteReserve.toFixed(2)} | ${profitStr}`
  );
}

// PendingPoolManager setup
const pendingPoolManager = new PendingPoolManager({
  connection,
  checkInterval: 30_000,
  maxAttempts: 30,
  onPoolReady: (pool) => {
    // When pool is indexed, hand off to PoolMonitorManager
    const tokenAInfo = MINT_TO_TOKEN[pool.tokenA] || { symbol: pool.tokenA, decimals: 9 };
    const tokenBInfo = MINT_TO_TOKEN[pool.tokenB] || { symbol: pool.tokenB, decimals: 6 };
    poolMonitorManager.addPool(
      {
        poolId: pool.poolId,
        baseMint: pool.tokenA,
        quoteMint: pool.tokenB,
        lpMint: '',
        isViable: true
      },
      { symbol: tokenAInfo.symbol, decimals: tokenAInfo.decimals, mint: pool.tokenA },
      { symbol: tokenBInfo.symbol, decimals: tokenBInfo.decimals, mint: pool.tokenB },
      (snapshot, pressure, originPrice, originBaseReserve, originQuoteReserve) => conciseOnUpdate(
        snapshot,
        pressure,
        { symbol: tokenAInfo.symbol, decimals: tokenAInfo.decimals, mint: pool.tokenA },
        { symbol: tokenBInfo.symbol, decimals: tokenBInfo.decimals, mint: pool.tokenB },
        originPrice,
        originBaseReserve,
        originQuoteReserve,
        null,
        pool.poolId
      )
    );
    Logger.log(`Started real-time monitoring for pool: ${tokenAInfo.symbol}/${tokenBInfo.symbol} (${pool.poolId})`);
  }
});

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

// Fetch raydium mints and add to pool monitor
async function fetchRaydiumMints(txId: string, connection: Connection) {
  try {
    const tx = await connection.getParsedTransaction(txId, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) {
      console.log('Transaction not found:', txId);
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

      Logger.log('token mint address', tokenAAccount);
      Logger.log('quote address', tokenBAccount);
      Logger.log('liquidity pool address', liquidityPoolAddressAccount);

      // Add pool to pending manager if we have all required addresses
      if (liquidityPoolAddressAccount) {
        pendingPoolManager.addPool(
          liquidityPoolAddressAccount,
          tokenAAccount.toBase58(),
          tokenBAccount.toBase58()
        );
        Logger.log(`Added pool to pending manager: ${liquidityPoolAddressAccount}`);
      }
    }
  } catch (error) {
    Logger.log('error', error);
  }
}

export async function startConnection(
  connection: Connection,
  programAddress: PublicKey,
  searchInstruction: string,
): Promise<void> {
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
