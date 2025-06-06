import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { SwapEngine } from '../../raydium/swapEngine';
import * as dotenv from 'dotenv';
dotenv.config();

// Add bs58 for base58 decoding
import bs58 from 'bs58';

async function main() {
  // Load wallet from env
  let secret = process.env.TEST_WALLET_KEY;
  if (!secret && process.env.SOLANA_SECRET) {
    // Auto-decode base58 secret if TEST_WALLET_KEY is not set
    const arr = Array.from(bs58.decode(process.env.SOLANA_SECRET));
    secret = JSON.stringify(arr);
    console.log('[test-swap-engine] Decoded SOLANA_SECRET to TEST_WALLET_KEY');
  }
  if (!secret) throw new Error('TEST_WALLET_KEY or SOLANA_SECRET env var required');
  const wallet = Keypair.fromSecretKey(Buffer.from(JSON.parse(secret)));
  const heliusApiKey = process.env.HELIUS_API_KEY!;
  const rpcUrl = process.env.HELIUS_RPC_URL || process.env.HTTP_URL;
  if (!rpcUrl) throw new Error('HELIUS_RPC_URL or HTTP_URL env var required');
  const connection = new Connection(rpcUrl, 'confirmed');

  // Pool and mint addresses (real Raydium SOL/USDC pool)
  const poolId = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
  const baseMint = 'So11111111111111111111111111111111111111112'; // SOL
  const quoteMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
  const baseSymbol = 'SOL';
  const quoteSymbol = 'USDC';

  const swapEngine = new SwapEngine({ connection, wallet, heliusApiKey });

  // 1. Swap 1 SOL -> USDC
  console.log('--- Swapping 1 SOL to USDC ---');
  const buyResult = await swapEngine.buyOnNewPool({
    poolId,
    baseMint,
    quoteMint,
    baseSymbol,
    quoteSymbol,
  });
  console.log('Buy result:', buyResult);

  // 2. Swap all USDC back to SOL
  // For test, use amountOut from buy as amountIn for sell
  console.log('--- Swapping all USDC back to SOL ---');
  const sellResult = await swapEngine.sellAll({
    poolId,
    baseMint,
    quoteMint,
    baseSymbol,
    quoteSymbol,
    amountIn: buyResult.amountOut,
  });
  console.log('Sell result:', sellResult);
}

main().catch(console.error); 