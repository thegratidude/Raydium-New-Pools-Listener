import * as BufferLayout from '@solana/buffer-layout';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { struct, u8, nu64, blob } from 'buffer-layout';

// Raydium V4 pool state layout (simplified for core fields)
export const LIQUIDITY_STATE_LAYOUT_V4 = struct([
  u8('status'),
  u8('nonce'),
  nu64('maxOrder'),
  nu64('depth'),
  nu64('baseDecimal'),
  nu64('quoteDecimal'),
  nu64('state'),
  nu64('resetFlag'),
  nu64('minSize'),
  nu64('volMaxCutRatio'),
  nu64('amountWaveRatio'),
  nu64('baseLotSize'),
  nu64('quoteLotSize'),
  nu64('minPriceMultiplier'),
  nu64('maxPriceMultiplier'),
  nu64('systemDecimalValue'),
  nu64('minSeparateNumerator'),
  nu64('minSeparateDenominator'),
  nu64('tradeFeeNumerator'),
  nu64('tradeFeeDenominator'),
  nu64('pnlNumerator'),
  nu64('pnlDenominator'),
  nu64('swapFeeNumerator'),
  nu64('swapFeeDenominator'),
  nu64('baseNeedTakePnl'),
  nu64('quoteNeedTakePnl'),
  nu64('quoteTotalPnl'),
  nu64('baseTotalPnl'),
  nu64('poolOpenTime'),
  nu64('punishPcAmount'),
  nu64('punishCoinAmount'),
  nu64('orderbookToInitTime'),
  nu64('swapBaseInAmount'),
  nu64('swapQuoteOutAmount'),
  nu64('swapBase2QuoteFee'),
  nu64('swapQuoteInAmount'),
  nu64('swapBaseOutAmount'),
  nu64('swapQuote2BaseFee'),
  blob(32, 'baseMint'),
  blob(32, 'quoteMint'),
  blob(32, 'lpMint'),
  blob(32, 'openOrders'),
  blob(32, 'marketId'),
  blob(32, 'marketProgramId'),
  blob(32, 'targetOrders'),
  blob(32, 'withdrawQueue'),
  blob(32, 'lpVault'),
  blob(32, 'owner'),
  blob(32, 'lpReserve'),
  blob(32, 'baseVault'),
  blob(32, 'quoteVault'),
]);

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