import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { PoolSnapshot, MarketPressure, TrendDirection } from './types/types';
import { DecimalHandler, ReserveMath } from './utils';
import { BN } from '@coral-xyz/anchor';
import { Api } from '@raydium-io/raydium-sdk-v2';
import { insertPoolHistory } from './pool-history-db';
import { struct, nu64, blob, Layout } from '@solana/buffer-layout';
import { getRaydiumRoundTripQuote } from '../../raydium/quoteRaydium';
import { TokenInfo } from '../../types/token';
import { LIQUIDITY_STATE_LAYOUT_V4, decodePoolStateFlexible } from './raydium-layout';
import { AccountInfo as TokenAccountInfo } from '@solana/web3.js';
import { PoolUpdate } from '../../types/market';
import { createMarketPressure } from '../../types/market';
import { Logger } from '@nestjs/common';

interface PoolMonitorOptions {
  poolId: PublicKey;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  httpUrl: string;
  wssUrl: string;
  onUpdate: (update: PoolUpdate) => void;
  isSimulation?: boolean;
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

// Helper function to decode pool state
function decodePoolState(data: Buffer) {
  try {
    // Use the flexible decoder that can handle different account types
    const decoded = decodePoolStateFlexible(data);
    if (!decoded) return null;
    
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
  protected poolId: PublicKey;
  protected tokenA: TokenInfo;
  protected tokenB: TokenInfo;
  private onUpdate: (update: PoolUpdate) => void;
  private isSimulation: boolean;
  private lastUpdate: number = 0;
  protected updateInterval: number = 1000; // Reduced to 1 second for faster detection
  protected initialReserveRatio: number | null = null;
  private retryCount: number = 0;
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAY = 2000;
  private readonly MAX_RETRY_DELAY = 32000;
  private hasSeenTrade: boolean = false;
  protected intervalId: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(PoolMonitor.name);
  
  // Reserve tracking for change detection
  protected lastBaseReserve: number | null = null;
  protected lastQuoteReserve: number | null = null;
  private firstTradeTime: number | null = null;
  private tradeCount: number = 0;
  private readonly TRADE_THRESHOLD = 1; // Ready after first reserve change
  private readonly TRADE_WINDOW = 30000; // 30 seconds window
  protected RESERVE_CHANGE_THRESHOLD = 0.0005; // 0.05% - ultra sensitive for early detection
  
  // Polling tracking
  protected pollCount: number = 0;
  protected lastPollLogTime: number = 0;
  
  // Add retry limit for unindexed pools
  private readonly MAX_UNINDEXED_RETRIES = 3;
  private unindexedRetryCount: number = 0;
  
  // Add silent monitoring mode
  protected isSilentMode: boolean = false;
  protected hasDetectedActivity: boolean = false;

  // Add initial price tracking for position monitoring
  protected baselinePrice: number | null = null;
  protected lastShownPrice: number | null = null; // Track last price we showed output for

  // Add heartbeat tracking
  protected lastHeartbeat: number = 0;
  protected readonly HEARTBEAT_INTERVAL = 60000; // 60 seconds

  constructor(options: PoolMonitorOptions) {
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

  // Add method to get colored percentage change
  protected getColoredPercentage(currentPrice: number): string {
    if (this.baselinePrice === null) {
      this.baselinePrice = currentPrice;
      return '(0.00%)'; // First reading, no change
    }

    const percentageChange = ((currentPrice - this.baselinePrice) / this.baselinePrice) * 100;
    const formattedChange = percentageChange.toFixed(2);
    
    if (percentageChange > 0) {
      return `\x1b[32m(+${formattedChange}%)\x1b[0m`; // Green for positive
    } else if (percentageChange < 0) {
      return `\x1b[31m(${formattedChange}%)\x1b[0m`; // Red for negative
    } else {
      return `(${formattedChange}%)`; // No color for zero
    }
  }

  // Public method to check if monitor is in silent mode
  public isInSilentMode(): boolean {
    return this.isSilentMode;
  }

  // Public method to check if monitor has detected activity
  public getHasDetectedActivity(): boolean {
    return this.hasDetectedActivity;
  }

  async start() {
    this.logger.log(`[PoolMonitor] 🚀 STARTING monitor for pool: ${this.tokenA.symbol}/${this.tokenB.symbol} (${this.poolId.toBase58()})`);

    // Start in silent mode for new pools
    this.isSilentMode = true;
    this.hasDetectedActivity = false;

    // Initial state fetch
    this.logger.log(`[PoolMonitor] 🔄 Initial API call for ${this.poolId.toBase58()}`);
    await this.processPoolUpdate();

    // Start polling every 1 second
    this.logger.log(`[PoolMonitor] ⏰ Setting up 1-second polling interval for ${this.poolId.toBase58()}`);
    this.intervalId = setInterval(async () => {
      try {
        await this.processPoolUpdate();
      } catch (error) {
        this.logger.error(`[PoolMonitor] Error in polling interval for ${this.poolId.toBase58()}:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }, this.updateInterval);
    
    this.logger.log(`[PoolMonitor] ✅ Polling interval started for ${this.poolId.toBase58()} - interval ID: ${this.intervalId}`);
  }

  stop() {
    this.logger.log(`[PoolMonitor] 🛑 STOPPING monitor for pool: ${this.poolId.toBase58()}`);
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.log(`[PoolMonitor] ✅ Polling interval cleared for ${this.poolId.toBase58()}`);
    } else {
      this.logger.log(`[PoolMonitor] ⚠️ No interval to clear for ${this.poolId.toBase58()}`);
    }
    this.logger.log(`[PoolMonitor] 🛑 Stopped monitoring for pool: ${this.poolId.toBase58()}`);
  }

  protected async processPoolUpdate() {
    try {
      // Track polling frequency
      this.pollCount++;
      const now = Date.now();
      
      // Log polling frequency every 10 seconds
      if (!this.lastPollLogTime || (now - this.lastPollLogTime) > 10000) {
        // this.logger.log(`[PoolMonitor] 🔄 Poll #${this.pollCount} for ${this.tokenA.symbol}/${this.tokenB.symbol} (${this.poolId.toBase58().substring(0, 8)}...) - 1s intervals active`);
        this.lastPollLogTime = now;
      }
      
      // Log API call attempt with instance identifier
      // this.logger.log(`[PoolMonitor] 🔄 API CALL for ${this.tokenA.symbol}/${this.tokenB.symbol} (${this.poolId.toBase58().substring(0, 8)}...) - Poll #${this.pollCount}`);
      
      // Use Raydium API for reliable pool data (like the old monitor.ts)
      const api = new Api({ cluster: 'mainnet', timeout: 30000 });
      // this.logger.log(`[PoolMonitor] 📡 Calling Raydium API for pool ${this.poolId.toBase58()}`);
      
      const poolInfo = await api.fetchPoolById({ ids: this.poolId.toBase58() });
      
      if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
        // Pool not found or not yet indexed - keep monitoring silently
        if (this.isSilentMode) {
          // Silent mode - just return without logging
          return;
      } else {
          this.logger.log(`[PoolMonitor] ❌ Pool ${this.poolId.toBase58().substring(0, 8)}... not yet indexed by Raydium API`);
        }
        return;
      }

      const pool = poolInfo[0];
      if (!pool.mintA || !pool.mintB) {
        this.logger.log(`[PoolMonitor] ❌ Pool ${this.poolId.toBase58().substring(0, 8)}... missing mint data`);
        return;
      }

      const baseReserve = pool.mintAmountA || 0;
      const quoteReserve = pool.mintAmountB || 0;
      
      // Log raw reserve data - removed verbose logging
      // this.logger.log(`[PoolMonitor] 📊 RESERVES for ${this.poolId.toBase58().substring(0, 8)}...: ${baseReserve} ${this.tokenA.symbol} / ${quoteReserve} ${this.tokenB.symbol}`);
      
      // Check if we have valid reserves
      if (baseReserve <= 0 || quoteReserve <= 0) {
        this.logger.log(`[PoolMonitor] ❌ Pool ${this.poolId.toBase58().substring(0, 8)}... has invalid reserves: ${baseReserve} ${this.tokenA.symbol} / ${quoteReserve} ${this.tokenB.symbol}`);
        return;
      }

      // Calculate current price and check for changes
      const currentPrice = quoteReserve / baseReserve;
      const hasPriceChange = this.detectPriceChange(currentPrice);
      const hasReserveChange = this.detectReserveChange(baseReserve, quoteReserve);
      
      // Only show output if there are actual changes AND it's a new change from last shown
      const isNewChange = this.isNewChange(currentPrice);
      
      if ((hasPriceChange || hasReserveChange) && isNewChange) {
        if (!this.isSilentMode) {
          // Calculate % change in reserves
          let baseChange = 0;
          let quoteChange = 0;
          
          if (this.lastBaseReserve !== null && this.lastQuoteReserve !== null) {
            baseChange = ((baseReserve - this.lastBaseReserve) / this.lastBaseReserve) * 100;
            quoteChange = ((quoteReserve - this.lastQuoteReserve) / this.lastQuoteReserve) * 100;
          }
          
          // Show colored output only when there are new changes
          const pricePercentage = this.getColoredPercentage(currentPrice);
          console.log(`📊 ${this.tokenA.symbol}/${this.tokenB.symbol} | Price: $${currentPrice.toFixed(8)} ${pricePercentage} | Base: ${baseChange.toFixed(4)}% | Quote: ${quoteChange.toFixed(4)}%`);
          
          // Update last shown price to prevent repeating
          this.lastShownPrice = currentPrice;
        }
      } else {
        // No changes detected - check for heartbeat
        if (!this.lastHeartbeat || (now - this.lastHeartbeat) > this.HEARTBEAT_INTERVAL) {
          if (!this.isSilentMode) {
            console.log(`💓 ${this.tokenA.symbol}/${this.tokenB.symbol} | Still monitoring... (${this.pollCount} polls, no changes in 60s)`);
          }
          this.lastHeartbeat = now;
        }
      }

      // Update last reserves for next comparison
      this.lastBaseReserve = baseReserve;
      this.lastQuoteReserve = quoteReserve;
      
      // Set initial ratio if not set
      if (this.initialReserveRatio === null) {
        this.initialReserveRatio = quoteReserve / baseReserve;
        this.logger.log(`[PoolMonitor] 📈 Set initial ratio for ${this.poolId.toBase58().substring(0, 8)}...: ${this.initialReserveRatio}`);
      }

      // Reset retry count on successful update
      this.retryCount = 0;

    } catch (error: any) {
      this.logger.error(`[PoolMonitor] ❌ ERROR for ${this.poolId.toBase58().substring(0, 8)}...:`, error?.message || error);
      this.handleError(error);
    }
  }

  protected detectReserveChange(baseReserve: number, quoteReserve: number): boolean {
    // If this is the first time we're seeing reserves, it's not a change
    if (this.lastBaseReserve === null || this.lastQuoteReserve === null) {
      return false;
    }

    // Calculate percentage changes
    const baseChange = Math.abs((baseReserve - this.lastBaseReserve) / this.lastBaseReserve);
    const quoteChange = Math.abs((quoteReserve - this.lastQuoteReserve) / this.lastQuoteReserve);
    
    // No threshold - detect ANY change
    return baseChange > 0 || quoteChange > 0;
  }

  protected detectPriceChange(currentPrice: number): boolean {
    // If this is the first time we're seeing a price, it's not a change
    if (this.baselinePrice === null) {
      this.baselinePrice = currentPrice;
      return false;
    }

    // Calculate percentage change from baseline
    const priceChange = Math.abs((currentPrice - this.baselinePrice) / this.baselinePrice);
    
    // No threshold - detect ANY price change
    return priceChange > 0;
  }

  protected isNewChange(currentPrice: number): boolean {
    // If we haven't shown any price yet, this is a new change
    if (this.lastShownPrice === null) {
      return true;
    }
    
    // Check if this price is different from the last shown price
    const priceDifference = Math.abs(currentPrice - this.lastShownPrice);
    
    // No threshold - show if there's ANY difference
    return priceDifference > 0;
  }

  private handleError(error: any) {
    this.retryCount++;
    
    if (error?.response?.status === 429 || (error?.message && error.message.includes('429'))) {
      this.logger.warn('⚠️  Raydium API rate limited (429). Skipping this update.');
      return;
    }
    
    this.logger.error('Error processing pool update:', error?.message || error);
    
    if (this.retryCount >= this.MAX_RETRIES) {
      this.logger.error(`Failed to process pool update after ${this.MAX_RETRIES} retries for pool ${this.poolId.toString()}`);
    }
  }

  private calculateMarketPressure(snapshot: any): MarketPressure {
    // Calculate market pressure based on reserve ratio changes
    const ratioChange = snapshot.ratioChange || 0;
    
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