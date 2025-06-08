import * as BufferLayout from '@solana/buffer-layout';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Raydium V4 pool state layout (matching the official layout)
const LIQUIDITY_STATE_LAYOUT_V4 = BufferLayout.struct([
  BufferLayout.nu64('status'),
  BufferLayout.nu64('nonce'),
  BufferLayout.nu64('maxOrder'),
  BufferLayout.nu64('depth'),
  BufferLayout.nu64('baseDecimal'),  // This is the actual decimals field
  BufferLayout.nu64('quoteDecimal'), // This is the actual decimals field
  BufferLayout.nu64('state'),
  BufferLayout.nu64('resetFlag'),
  BufferLayout.nu64('minSize'),
  BufferLayout.nu64('volMaxCutRatio'),
  BufferLayout.nu64('amountWaveRatio'),
  BufferLayout.nu64('baseLotSize'),
  BufferLayout.nu64('quoteLotSize'),
  BufferLayout.nu64('minPriceMultiplier'),
  BufferLayout.nu64('maxPriceMultiplier'),
  BufferLayout.nu64('systemDecimalValue'),
  BufferLayout.nu64('minSeparateNumerator'),
  BufferLayout.nu64('minSeparateDenominator'),
  BufferLayout.nu64('tradeFeeNumerator'),
  BufferLayout.nu64('tradeFeeDenominator'),
  BufferLayout.nu64('pnlNumerator'),
  BufferLayout.nu64('pnlDenominator'),
  BufferLayout.nu64('swapFeeNumerator'),
  BufferLayout.nu64('swapFeeDenominator'),
  BufferLayout.nu64('baseNeedTakePnl'),
  BufferLayout.nu64('quoteNeedTakePnl'),
  BufferLayout.nu64('quoteTotalPnl'),
  BufferLayout.nu64('baseTotalPnl'),
  BufferLayout.nu64('poolOpenTime'),
  BufferLayout.nu64('punishPcAmount'),
  BufferLayout.nu64('punishCoinAmount'),
  BufferLayout.nu64('orderbookToInitTime'),
  BufferLayout.blob(16, 'swapBaseInAmount'),  // 16 bytes for u128
  BufferLayout.blob(16, 'swapQuoteOutAmount'), // 16 bytes for u128
  BufferLayout.nu64('swapBase2QuoteFee'),
  BufferLayout.blob(16, 'swapQuoteInAmount'),  // 16 bytes for u128
  BufferLayout.blob(16, 'swapBaseOutAmount'),  // 16 bytes for u128
  BufferLayout.nu64('swapQuote2BaseFee'),
  BufferLayout.blob(32, 'baseMint'),
  BufferLayout.blob(32, 'quoteMint'),
  BufferLayout.blob(32, 'lpMint'),
  BufferLayout.blob(32, 'openOrders'),
  BufferLayout.blob(32, 'marketId'),
  BufferLayout.blob(32, 'marketProgramId'),
  BufferLayout.blob(32, 'targetOrders'),
  BufferLayout.blob(32, 'withdrawQueue'),
  BufferLayout.blob(32, 'lpVault'),
  BufferLayout.blob(32, 'owner'),
  BufferLayout.blob(32, 'lpReserve'),
  BufferLayout.blob(32, 'baseVault'),
  BufferLayout.blob(32, 'quoteVault'),
] as const) as BufferLayout.Layout<any>;  // Type assertion to fix TypeScript errors

interface DecodedPoolState {
  status: number;
  nonce: number;
  maxOrder: number;
  depth: number;
  baseDecimal: number;
  quoteDecimal: number;
  state: number;
  resetFlag: number;
  minSize: number;
  volMaxCutRatio: number;
  amountWaveRatio: number;
  baseLotSize: number;
  quoteLotSize: number;
  minPriceMultiplier: number;
  maxPriceMultiplier: number;
  systemDecimalValue: number;
  minSeparateNumerator: number;
  minSeparateDenominator: number;
  tradeFeeNumerator: number;
  tradeFeeDenominator: number;
  pnlNumerator: number;
  pnlDenominator: number;
  swapFeeNumerator: number;
  swapFeeDenominator: number;
  baseNeedTakePnl: number;
  quoteNeedTakePnl: number;
  quoteTotalPnl: number;
  baseTotalPnl: number;
  poolOpenTime: number;
  punishPcAmount: number;
  punishCoinAmount: number;
  orderbookToInitTime: number;
  swapBaseInAmount: Buffer;
  swapQuoteOutAmount: Buffer;
  swapBase2QuoteFee: number;
  swapQuoteInAmount: Buffer;
  swapBaseOutAmount: Buffer;
  swapQuote2BaseFee: number;
  baseMint: Buffer;
  quoteMint: Buffer;
  lpMint: Buffer;
  openOrders: Buffer;
  marketId: Buffer;
  marketProgramId: Buffer;
  targetOrders: Buffer;
  withdrawQueue: Buffer;
  lpVault: Buffer;
  owner: Buffer;
  lpReserve: Buffer;
  baseVault: Buffer;
  quoteVault: Buffer;
}

export function decodeRaydiumPoolState(data: Buffer) {
  const decoded = LIQUIDITY_STATE_LAYOUT_V4.decode(data) as DecodedPoolState;
  
  // Validate decimals are within reasonable range (1-9)
  const baseDecimal = Number(decoded.baseDecimal);
  const quoteDecimal = Number(decoded.quoteDecimal);
  
  if (baseDecimal < 1 || baseDecimal > 9 || quoteDecimal < 1 || quoteDecimal > 9) {
    throw new Error(`Invalid token decimals: base=${baseDecimal}, quote=${quoteDecimal}`);
  }

  return {
    baseMint: new PublicKey(decoded.baseMint).toString(),
    quoteMint: new PublicKey(decoded.quoteMint).toString(),
    baseVault: new PublicKey(decoded.baseVault).toString(),
    quoteVault: new PublicKey(decoded.quoteVault).toString(),
    baseDecimal: baseDecimal,
    quoteDecimal: quoteDecimal,
  };
} 