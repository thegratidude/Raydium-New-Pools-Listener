import { PublicKey, Connection } from '@solana/web3.js';
import * as BufferLayout from '@solana/buffer-layout';
import * as dotenv from 'dotenv';
dotenv.config();

const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL!;
const MAX_RETRIES = 5;
const TRADE_SIZE_SOL = 1;

export interface RaydiumQuoteResult {
  buyAmount: number; // tokens received for 1 SOL
  sellAmount: number; // SOL received if you sell all tokens back
  buyPriceImpact: number;
  sellPriceImpact: number;
  buyFee: number;
  sellFee: number;
  error?: string;
  poolState?: any;
}

// TypeScript workaround: explicitly type as BufferLayout.Layout<any> to avoid nu64/never incompatibility
const LIQUIDITY_STATE_LAYOUT_V4: BufferLayout.Layout<any> = BufferLayout.struct([
  BufferLayout.nu64('status'),
  BufferLayout.nu64('nonce'),
  BufferLayout.nu64('maxOrder'),
  BufferLayout.nu64('depth'),
  BufferLayout.nu64('baseDecimal'),
  BufferLayout.nu64('quoteDecimal'),
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
  BufferLayout.nu64('swapBaseInAmount'),
  BufferLayout.nu64('swapQuoteOutAmount'),
  BufferLayout.nu64('swapBase2QuoteFee'),
  BufferLayout.nu64('swapQuoteInAmount'),
  BufferLayout.nu64('swapBaseOutAmount'),
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
  BufferLayout.seq(BufferLayout.u8(), 512), // rest of struct
]);

function u64FromBuffer(buf: Buffer | Uint8Array) {
  return Buffer.from(buf).readBigUInt64LE(0);
}

function decodePubkey(buf: Buffer | Uint8Array) {
  return new PublicKey(Buffer.from(buf)).toString();
}

function decodePoolState(data: Buffer) {
  const d = LIQUIDITY_STATE_LAYOUT_V4.decode(data) as any;
  return {
    baseMint: decodePubkey(d.baseMint),
    quoteMint: decodePubkey(d.quoteMint),
    baseDecimal: Number(d.baseDecimal),
    quoteDecimal: Number(d.quoteDecimal),
    swapFeeNumerator: Number(d.swapFeeNumerator),
    swapFeeDenominator: Number(d.swapFeeDenominator),
    // For reserves, fetch from vaults or use external method; here we keep as before for compatibility
    // baseReserve: ...
    // quoteReserve: ...
  };
}

function applyDecimals(amount: number, decimals: number) {
  return amount / Math.pow(10, decimals);
}

function getFee(amount: number, feeNumerator: number, feeDenominator: number) {
  return amount * (feeNumerator / feeDenominator);
}

function constantProductSwap(x: number, y: number, dx: number) {
  // x, y: reserves; dx: input after fee
  // dy = (y * dx) / (x + dx)
  return (y * dx) / (x + dx);
}

export async function getRaydiumRoundTripQuote({
  poolAddress,
  baseMint,
  quoteMint,
  tradeSizeSOL = TRADE_SIZE_SOL,
}: {
  poolAddress: string;
  baseMint: string;
  quoteMint: string;
  tradeSizeSOL?: number;
}): Promise<RaydiumQuoteResult> {
  const connection = new Connection(HELIUS_RPC_URL, 'confirmed');
  let lastError = '';
  for (let attempt = 0; attempt < MAX_RETRIES; ++attempt) {
    try {
      const acc = await connection.getAccountInfo(new PublicKey(poolAddress));
      if (!acc || !acc.data) throw new Error('Pool account not found');
      const state = decodePoolState(acc.data);
      // Debug: print decoded baseMint and quoteMint
      console.log('[DEBUG] Pool baseMint:', state.baseMint);
      console.log('[DEBUG] Pool quoteMint:', state.quoteMint);
      // Identify which mint is SOL
      const SOL_MINTS = [
        'So11111111111111111111111111111111111111112',
        '7XSzQZQ2E1V9DqgW8sELpAo7P5NdVs4KJc4uFfQk5o4h', // WSOL
      ];
      let solIsBase = false;
      if (state.baseMint === baseMint && SOL_MINTS.includes(baseMint)) solIsBase = true;
      else if (state.quoteMint === baseMint && SOL_MINTS.includes(baseMint)) solIsBase = false;
      else throw new Error('Neither base nor quote mint is SOL');
      // Fetch reserves from vaults
      // baseVault and quoteVault are at offsets 1208 and 1240 respectively (each field is 32 bytes, see struct definition)
      // Calculation: sum of all previous field sizes (see BufferLayout struct)
      const BASE_VAULT_OFFSET = 1208;
      const QUOTE_VAULT_OFFSET = 1240;
      const baseVault = decodePubkey(acc.data.slice(BASE_VAULT_OFFSET, BASE_VAULT_OFFSET + 32));
      const quoteVault = decodePubkey(acc.data.slice(QUOTE_VAULT_OFFSET, QUOTE_VAULT_OFFSET + 32));
      const [baseVaultBalance, quoteVaultBalance] = await Promise.all([
        connection.getTokenAccountBalance(new PublicKey(baseVault)),
        connection.getTokenAccountBalance(new PublicKey(quoteVault)),
      ]);
      const baseRes = Number(baseVaultBalance.value.amount) / Math.pow(10, state.baseDecimal);
      const quoteRes = Number(quoteVaultBalance.value.amount) / Math.pow(10, state.quoteDecimal);
      // Simulate BUY: swap 1 SOL for token
      let dx = tradeSizeSOL;
      let x, y, outDecimals;
      if (solIsBase) {
        // SOL is base, buying quote
        x = baseRes;
        y = quoteRes;
        outDecimals = state.quoteDecimal;
      } else {
        // SOL is quote, buying base
        x = quoteRes;
        y = baseRes;
        outDecimals = state.baseDecimal;
      }
      const buyFee = getFee(dx, state.swapFeeNumerator, state.swapFeeDenominator);
      const dxAfterFee = dx - buyFee;
      const buyAmount = constantProductSwap(x, y, dxAfterFee);
      const buyPriceImpact = ((dxAfterFee / (x + dxAfterFee)) * 100);
      // Simulate SELL: swap all tokens back to SOL
      // New reserves after buy
      const x2 = x + dxAfterFee;
      const y2 = y - buyAmount;
      const sellFee = getFee(buyAmount, state.swapFeeNumerator, state.swapFeeDenominator);
      const buyAmountAfterFee = buyAmount - sellFee;
      const sellAmount = constantProductSwap(y2, x2, buyAmountAfterFee);
      const sellPriceImpact = ((buyAmountAfterFee / (y2 + buyAmountAfterFee)) * 100);
      return {
        buyAmount,
        sellAmount,
        buyPriceImpact,
        sellPriceImpact,
        buyFee,
        sellFee,
        poolState: state,
      };
    } catch (e: any) {
      lastError = e.message || String(e);
      await new Promise(res => setTimeout(res, 100));
    }
  }
  return { buyAmount: 0, sellAmount: 0, buyPriceImpact: 0, sellPriceImpact: 0, buyFee: 0, sellFee: 0, error: lastError };
} 