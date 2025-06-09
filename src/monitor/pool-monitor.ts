import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { PoolSnapshot, MarketPressure, TrendDirection } from './types';
import { DecimalHandler, ReserveMath } from './utils';
import { BN } from '@coral-xyz/anchor';
import { Api } from '@raydium-io/raydium-sdk-v2';
import { insertPoolHistory } from './pool-history-db';
import { struct, nu64, blob, Layout } from '@solana/buffer-layout';
import { getRaydiumRoundTripQuote } from '../raydium/quoteRaydium';
import { TokenInfo } from '../types/token';
import { LIQUIDITY_STATE_LAYOUT_V4 } from './raydium-layout';
import { AccountInfo as TokenAccountInfo } from '@solana/web3.js';

interface PoolMonitorOptions {
  poolId: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  httpUrl: string;
  wssUrl: string;
  onUpdate: (snapshot: PoolSnapshot, pressure: MarketPressure, originPrice: number | null, originBaseReserve: number | null, originQuoteReserve: number | null, prevSnapshot: PoolSnapshot | null) => void;
  historyLength?: number;
}

interface PoolState {
  status: BN;
  nonce: BN;
  maxOrder: BN;
  depth: BN;
  baseDecimal: BN;
  quoteDecimal: BN;
  state: BN;
  resetFlag: BN;
  minSize: BN;
  volMaxCutRatio: BN;
  amountWaveRatio: BN;
  baseLotSize: BN;
  quoteLotSize: BN;
  minPriceMultiplier: BN;
  maxPriceMultiplier: BN;
  systemDecimalValue: BN;
  minSeparateNumerator: BN;
  minSeparateDenominator: BN;
  tradeFeeNumerator: BN;
  tradeFeeDenominator: BN;
  pnlNumerator: BN;
  pnlDenominator: BN;
  swapFeeNumerator: BN;
  swapFeeDenominator: BN;
  baseNeedTakePnl: BN;
  quoteNeedTakePnl: BN;
  quoteTotalPnl: BN;
  baseTotalPnl: BN;
  poolOpenTime: BN;
  punishPcAmount: BN;
  punishCoinAmount: BN;
  orderbookToInitTime: BN;
  swapBaseInAmount: BN;
  swapQuoteOutAmount: BN;
  swapBase2QuoteFee: BN;
  swapQuoteInAmount: BN;
  swapBaseOutAmount: BN;
  swapQuote2BaseFee: BN;
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
  swapBaseInAmount: number;
  swapQuoteOutAmount: number;
  swapBase2QuoteFee: number;
  swapQuoteInAmount: number;
  swapBaseOutAmount: number;
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

// Define the Raydium pool state interface with proper types
interface RaydiumPoolState {
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
  swapBaseInAmount: number;
  swapQuoteOutAmount: number;
  swapBase2QuoteFee: number;
  swapQuoteInAmount: number;
  swapBaseOutAmount: number;
  swapQuote2BaseFee: number;
  baseMint: Uint8Array;
  quoteMint: Uint8Array;
  lpMint: Uint8Array;
  openOrders: Uint8Array;
  marketId: Uint8Array;
  marketProgramId: Uint8Array;
  targetOrders: Uint8Array;
  withdrawQueue: Uint8Array;
  lpVault: Uint8Array;
  owner: Uint8Array;
  lpReserve: Uint8Array;
  baseVault: Uint8Array;
  quoteVault: Uint8Array;
}

// Add these constants at the top of the file
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
const NATIVE_LOADER_ID = new PublicKey('NativeLoader1111111111111111111111111111111');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const WSOL_MINTS = [
  new PublicKey('So11111111111111111111111111111111111111112'),  // WSOL
  new PublicKey('111111119oo283CdQsvQBaZZxTsAZAAs18Kkyrw75'),   // Alternative WSOL mint
  new PublicKey('7XSzQZQ2E1V9DqgW8sELpAo7P5NdVs4KJc4uFfQk5o4h'), // Another WSOL variant
  new PublicKey('111111118P3EVhM3gob9bdkRDaGo7tZhVKkVG9koR'),    // Another native SOL variant
  new PublicKey('11111111AnVezkofwHK1nxnKEJcKpSiQDKmqaVY6K'),    // Another native SOL variant
  new PublicKey('11111111FmjkjEUjfJDA9RiEm92pWEhTfhEsLYUjh')     // Another native SOL variant
];

// Types
export interface PoolUpdate {
  poolId: string;
  baseToken: TokenInfo;
  quoteToken: TokenInfo;
  baseReserve: number;
  quoteReserve: number;
  timestamp: number;
}

// Helper function to decode pool state
function decodePoolState(data: Buffer) {
  try {
    const decoded = LIQUIDITY_STATE_LAYOUT_V4.decode(data);
    return {
      baseMint: new PublicKey(decoded.baseMint),
      quoteMint: new PublicKey(decoded.quoteMint),
      baseVault: new PublicKey(decoded.baseVault),
      quoteVault: new PublicKey(decoded.quoteVault)
    };
  } catch (error) {
    console.error('Failed to decode pool state:', error);
    return null;
  }
}

export class PoolMonitor {
  private connection: Connection;
  private poolId: PublicKey;
  private tokenA: TokenInfo;
  private tokenB: TokenInfo;
  private onUpdate: (update: PoolUpdate) => void;
  private isSimulation: boolean;
  private lastUpdate: number = 0;
  private updateInterval: number = 5000; // 5 seconds between updates
  private initialReserveRatio: number | null = null; // Track initial reserve ratio

  constructor(options: {
    poolId: PublicKey;
    tokenA: TokenInfo;
    tokenB: TokenInfo;
    httpUrl: string;
    wssUrl: string;
    onUpdate: (update: PoolUpdate) => void;
    isSimulation?: boolean;
  }) {
    this.connection = new Connection(options.httpUrl, {
      wsEndpoint: options.wssUrl,
      commitment: 'confirmed'
    });
    this.poolId = options.poolId;
    this.tokenA = options.tokenA;
    this.tokenB = options.tokenB;
    this.onUpdate = options.onUpdate;
    this.isSimulation = options.isSimulation || false;
  }

  async start() {
    console.log(`[PoolMonitor] STARTED monitoring for pool: ${this.tokenA.symbol}/${this.tokenB.symbol} (${this.poolId.toBase58()})`);
    
    // Initial update
    await this.processPoolUpdate();

    // Set up periodic updates
    setInterval(async () => {
      await this.processPoolUpdate();
    }, this.updateInterval);
  }

  private async processPoolUpdate() {
    try {
      const response = await this.connection.getAccountInfoAndContext(this.poolId);
      if (!response.value) {
        console.error(`Pool ${this.poolId.toString()} not found`);
        return;
      }

      const poolState = decodePoolState(response.value.data);
      if (!poolState) return;

      // Get vault balances
      const [baseVaultInfo, quoteVaultInfo] = await Promise.all([
        this.connection.getTokenAccountBalance(poolState.baseVault),
        this.connection.getTokenAccountBalance(poolState.quoteVault)
      ]);

      if (!baseVaultInfo.value || !quoteVaultInfo.value) return;

      const baseReserve = baseVaultInfo.value.uiAmount || 0;
      const quoteReserve = quoteVaultInfo.value.uiAmount || 0;
      
      // Calculate reserve ratio
      const reserveRatio = quoteReserve / baseReserve;
      
      // Set initial ratio if not set
      if (this.initialReserveRatio === null) {
        this.initialReserveRatio = reserveRatio;
      }

      // Calculate ratio change percentage
      const ratioChange = ((reserveRatio - this.initialReserveRatio) / this.initialReserveRatio) * 100;

      // Calculate price using reserve ratio
      const price = reserveRatio;

      const snapshot: PoolSnapshot = {
        poolId: this.poolId.toString(),
        timestamp: Date.now(),
        slot: response.context.slot,
        baseReserve,
        quoteReserve,
        price,
        priceChange: ratioChange,
        tvl: quoteReserve * 2,
        marketCap: 0,
        volumeChange: 0,
        volume24h: 0,
        suspicious: false,
        baseDecimals: baseVaultInfo.value.decimals,
        quoteDecimals: quoteVaultInfo.value.decimals,
        buySlippage: 0,
        sellSlippage: 0,
        reserveRatio,
        initialReserveRatio: this.initialReserveRatio,
        ratioChange
      };

      // Calculate market pressure based on ratio changes
      const pressure = this.calculateMarketPressure(snapshot);

      // Call update callback
      this.onUpdate({
        poolId: this.poolId.toString(),
        baseToken: this.tokenA,
        quoteToken: this.tokenB,
        baseReserve,
        quoteReserve,
        timestamp: Date.now()
      });

      // Store in history with required fields
      await insertPoolHistory({
        poolId: snapshot.poolId,
        baseSymbol: this.tokenA.symbol,
        quoteSymbol: this.tokenB.symbol,
        timestamp: snapshot.timestamp,
        price: snapshot.price,
        tvl: snapshot.tvl,
        baseReserve: snapshot.baseReserve,
        quoteReserve: snapshot.quoteReserve,
        buyPressure: pressure.buyPressure,
        rugRisk: pressure.rugRisk,
        trend: pressure.trend,
        volume: snapshot.volume24h
      });

    } catch (error) {
      console.error('Error processing pool update:', error);
    }
  }

  private calculateMarketPressure(snapshot: PoolSnapshot): MarketPressure {
    const ratioChange = snapshot.ratioChange;
    
    // Determine trend direction
    let trend: TrendDirection = TrendDirection.Sideways;
    if (ratioChange > 1) trend = TrendDirection.Up;
    else if (ratioChange < -1) trend = TrendDirection.Down;

    // Calculate pressure values
    const buyPressure = ratioChange > 0 ? Math.min(100, 50 + (ratioChange * 10)) : Math.max(0, 50 - (Math.abs(ratioChange) * 10));
    const sellPressure = ratioChange < 0 ? Math.min(100, 50 + (Math.abs(ratioChange) * 10)) : Math.max(0, 50 - (ratioChange * 10));
    
    // Calculate rug risk based on ratio changes
    const rugRisk = ratioChange < -80 ? 100 : Math.max(0, Math.abs(ratioChange) * 1.25);

    return {
      value: ratioChange,
      direction: trend,
      strength: Math.abs(ratioChange),
      buyPressure,
      sellPressure,
      rugRisk,
      trend,
      severity: rugRisk > 70 ? 'high' : rugRisk > 30 ? 'medium' : 'low'
    };
  }
} 