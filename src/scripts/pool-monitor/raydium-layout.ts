import * as BufferLayout from '@solana/buffer-layout';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { struct, u8, nu64, blob } from 'buffer-layout';
import { FileLoggerService } from '../../utils/file-logger.service';

// Create a logger instance for this module
const fileLogger = new FileLoggerService();

// Raydium V4 pool state layout (corrected based on actual structure)
export const LIQUIDITY_STATE_LAYOUT_V4 = struct([
  nu64('status'),
  nu64('nonce'),
  nu64('orderNum'),
  nu64('depth'),
  nu64('coinDecimals'),
  nu64('pcDecimals'),
  nu64('state'),
  nu64('resetFlag'),
  nu64('minSize'),
  nu64('volMaxCutRatio'),
  nu64('amountWaveRatio'),
  nu64('coinLotSize'),
  nu64('pcLotSize'),
  nu64('minPriceMultiplier'),
  nu64('maxPriceMultiplier'),
  nu64('systemDecimalsValue'),
  nu64('minSeparateNumerator'),
  nu64('minSeparateDenominator'),
  nu64('tradeFeeNumerator'),
  nu64('tradeFeeDenominator'),
  nu64('pnlNumerator'),
  nu64('pnlDenominator'),
  nu64('swapFeeNumerator'),
  nu64('swapFeeDenominator'),
  nu64('needTakePnlCoin'),
  nu64('needTakePnlPc'),
  nu64('totalPnlPc'),
  nu64('totalPnlCoin'),
  nu64('poolOpenTime'),
  nu64('punishPcAmount'),
  nu64('punishCoinAmount'),
  nu64('orderbookToInitTime'),
  blob(16, 'swapCoinInAmount'), // u128
  blob(16, 'swapPcOutAmount'),  // u128
  nu64('swapCoin2PcFee'),
  blob(16, 'swapPcInAmount'),   // u128
  blob(16, 'swapCoinOutAmount'), // u128
  nu64('swapPc2CoinFee'),
  blob(32, 'poolCoinTokenAccount'),
  blob(32, 'poolPcTokenAccount'),
  blob(32, 'coinMintAddress'),
  blob(32, 'pcMintAddress'),
  blob(32, 'lpMintAddress'),
  blob(32, 'ammOpenOrders'),
  blob(32, 'serumMarket'),
  blob(32, 'serumProgramId'),
  blob(32, 'ammTargetOrders'),
  blob(32, 'poolWithdrawQueue'),
  blob(32, 'poolTempLpTokenAccount'),
  blob(32, 'ammOwner'),
  blob(32, 'pnlOwner'),
]);

// Helper function to safely decode pool state with better error handling
export function decodeRaydiumPoolState(data: Buffer) {
  try {
    // Check if we have enough data
    if (data.length < 752) {
      fileLogger.debug(`Pool data size: ${data.length} bytes (waiting for full pool state)`, 'RaydiumLayout');
      return null;
    }

    const decoded = LIQUIDITY_STATE_LAYOUT_V4.decode(data) as any;
    
    // Validate critical fields
    if (!decoded.coinMintAddress || !decoded.pcMintAddress || 
        !decoded.poolCoinTokenAccount || !decoded.poolPcTokenAccount) {
      fileLogger.debug(`Pool data incomplete (missing required fields)`, 'RaydiumLayout');
      return null;
    }

    return {
      baseMint: new PublicKey(decoded.coinMintAddress).toString(),
      quoteMint: new PublicKey(decoded.pcMintAddress).toString(),
      baseVault: new PublicKey(decoded.poolCoinTokenAccount).toString(),
      quoteVault: new PublicKey(decoded.poolPcTokenAccount).toString(),
      baseDecimal: Number(decoded.coinDecimals),
      quoteDecimal: Number(decoded.pcDecimals),
      status: Number(decoded.status),
      poolOpenTime: Number(decoded.poolOpenTime),
    };
  } catch (error) {
    fileLogger.error(`Failed to decode pool state: ${error instanceof Error ? error.message : 'Unknown error'}`, undefined, 'RaydiumLayout');
    return null;
  }
}

// Alternative decoder for different account types
export function decodePoolStateFlexible(data: Buffer) {
  try {
    // Try the full V4 layout first
    const result = decodeRaydiumPoolState(data);
    if (result) return result;

    // If that fails, try a minimal layout for smaller accounts
    if (data.length >= 200) {
      const minimalLayout = struct([
        nu64('status'),
        nu64('nonce'),
        blob(32, 'baseMint'),
        blob(32, 'quoteMint'),
        blob(32, 'baseVault'),
        blob(32, 'quoteVault'),
      ]);

      const decoded = minimalLayout.decode(data) as any;
      fileLogger.debug(`Using minimal layout for pool (${data.length} bytes)`, 'RaydiumLayout');
      
      return {
        baseMint: new PublicKey(decoded.baseMint).toString(),
        quoteMint: new PublicKey(decoded.quoteMint).toString(),
        baseVault: new PublicKey(decoded.baseVault).toString(),
        quoteVault: new PublicKey(decoded.quoteVault).toString(),
        baseDecimal: 9, // Default
        quoteDecimal: 9, // Default
        status: Number(decoded.status),
        poolOpenTime: 0,
      };
    }

    // Only log this message once per pool to reduce noise
    fileLogger.debug(`Pool data too small for decoding (${data.length} bytes)`, 'RaydiumLayout');
    return null;
  } catch (error) {
    fileLogger.error(`Failed to decode pool state with flexible decoder: ${error instanceof Error ? error.message : 'Unknown error'}`, undefined, 'RaydiumLayout');
    return null;
  }
} 