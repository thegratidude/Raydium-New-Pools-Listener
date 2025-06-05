import * as BufferLayout from '@solana/buffer-layout';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Raydium V4 pool state layout (partial, just what we need)
const LIQUIDITY_STATE_LAYOUT_V4 = BufferLayout.struct([
  BufferLayout.blob(8), // padding
  BufferLayout.nu64('status'),
  BufferLayout.nu64('nonce'),
  BufferLayout.blob(32, 'tokenProgramId'),
  BufferLayout.blob(32, 'baseMint'),
  BufferLayout.blob(32, 'quoteMint'),
  BufferLayout.blob(32, 'baseVault'),
  BufferLayout.blob(32, 'quoteVault'),
  BufferLayout.blob(32, 'lpMint'),
  BufferLayout.blob(32, 'openOrders'),
  BufferLayout.blob(32, 'targetOrders'),
  BufferLayout.blob(32, 'withdrawQueue'),
  BufferLayout.blob(32, 'lpVault'),
  BufferLayout.blob(8, 'tokenAReserve'),
  BufferLayout.blob(8, 'tokenBReserve'),
  BufferLayout.blob(112), // rest of struct
  BufferLayout.nu64('baseDecimal'),
  BufferLayout.nu64('quoteDecimal'),
]) as unknown as BufferLayout.Layout<any>;

export function decodeRaydiumPoolState(data: Buffer) {
  const decoded = LIQUIDITY_STATE_LAYOUT_V4.decode(data) as any;
  return {
    baseMint: new PublicKey(decoded.baseMint).toString(),
    quoteMint: new PublicKey(decoded.quoteMint).toString(),
    baseVault: new PublicKey(decoded.baseVault).toString(),
    quoteVault: new PublicKey(decoded.quoteVault).toString(),
    baseDecimal: decoded.baseDecimal,
    quoteDecimal: decoded.quoteDecimal,
  };
} 