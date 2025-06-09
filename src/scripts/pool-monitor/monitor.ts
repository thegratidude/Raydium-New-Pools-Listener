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
  private poolId: PublicKey;
  private tokenA: TokenInfo;
  private tokenB: TokenInfo;
  private onUpdate: (update: PoolUpdate) => void;
  private isSimulation: boolean;
  private lastUpdate: number = 0;
  private updateInterval: number = 1000; // Reduced to 1 second for faster detection
  private initialReserveRatio: number | null = null;
  private retryCount: number = 0;
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAY = 2000;
  private readonly MAX_RETRY_DELAY = 32000;
  private hasSeenTrade: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(PoolMonitor.name);
  
  // Reserve tracking for change detection
  private lastBaseReserve: number | null = null;
  private lastQuoteReserve: number | null = null;
  private firstTradeTime: number | null = null;
  private tradeCount: number = 0;
  private readonly TRADE_THRESHOLD = 1; // Ready after first reserve change
  private readonly TRADE_WINDOW = 30000; // 30 seconds window
  private readonly RESERVE_CHANGE_THRESHOLD = 0.0005; // 0.05% - ultra sensitive for early detection
  
  // Polling tracking
  private pollCount: number = 0;
  private lastPollLogTime: number = 0;
  
  // Add retry limit for unindexed pools
  private readonly MAX_UNINDEXED_RETRIES = 3;
  private unindexedRetryCount: number = 0;
  
  // Add silent monitoring mode
  private isSilentMode: boolean = false;
  private hasDetectedActivity: boolean = false;

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

  private async processPoolUpdate() {
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

      // Log current reserves every 10 seconds for debugging
      if (!this.lastUpdate || (now - this.lastUpdate) > 10000) {
        // Only show output if not in silent mode
        if (!this.isSilentMode) {
          // Calculate % change in reserves
          let baseChange = 0;
          let quoteChange = 0;
          
          if (this.lastBaseReserve !== null && this.lastQuoteReserve !== null) {
            baseChange = ((baseReserve - this.lastBaseReserve) / this.lastBaseReserve) * 100;
            quoteChange = ((quoteReserve - this.lastQuoteReserve) / this.lastQuoteReserve) * 100;
          }
          
          // Simple concise output - just the % changes
          console.log(`📊 ${this.tokenA.symbol}/${this.tokenB.symbol} | Base: ${baseChange.toFixed(4)}% | Quote: ${quoteChange.toFixed(4)}%`);
        }
        this.lastUpdate = now;
      }

      // Log previous reserves for comparison
      if (this.lastBaseReserve !== null && this.lastQuoteReserve !== null) {
        const baseChange = Math.abs((baseReserve - this.lastBaseReserve) / this.lastBaseReserve);
        const quoteChange = Math.abs((quoteReserve - this.lastQuoteReserve) / this.lastQuoteReserve);
        // Remove verbose logging - just keep the concise line above
      }

      // Detect reserve changes (this is the key insight!)
      const hasReserveChange = this.detectReserveChange(baseReserve, quoteReserve);
      
      if (hasReserveChange) {
        // Switch from silent mode to active mode when activity detected
        if (this.isSilentMode) {
          this.isSilentMode = false;
          this.hasDetectedActivity = true;
          this.logger.log(`🚨 ACTIVITY DETECTED for ${this.poolId.toBase58().substring(0, 8)}... - switching to active monitoring!`);
        }
        
        this.logger.log(`🚨 RESERVE CHANGE DETECTED for ${this.poolId.toBase58().substring(0, 8)}...!`);
        this.tradeCount++;
        
        if (!this.firstTradeTime) {
          this.firstTradeTime = Date.now();
          this.logger.log(`🔥 FIRST TRADE DETECTED for pool ${this.poolId.toBase58().substring(0, 8)}... - IMMEDIATE NOTIFICATION!`);
          this.logger.log(`  Initial reserves: ${baseReserve} ${this.tokenA.symbol} / ${quoteReserve} ${this.tokenB.symbol}`);
          
          // IMMEDIATE NOTIFICATION for early entry - no waiting!
          this.onUpdate({
            pool_id: this.poolId.toString(),
            base_token: this.tokenA.symbol,
            quote_token: this.tokenB.symbol,
            base_reserve: baseReserve,
            quote_reserve: quoteReserve,
            price: quoteReserve / baseReserve,
            tvl: quoteReserve * 2,
            market_pressure: this.calculateMarketPressure({
              poolId: this.poolId.toString(),
              timestamp: Date.now(),
              slot: 0,
              baseReserve: baseReserve,
              quoteReserve: quoteReserve,
              price: quoteReserve / baseReserve,
              priceChange: 0,
              tvl: quoteReserve * 2,
              marketCap: 0,
              volumeChange: 0,
              volume24h: pool.day?.volume || 0,
              suspicious: false,
              baseDecimals: pool.mintA.decimals || 9,
              quoteDecimals: pool.mintB.decimals || 6,
              buySlippage: 0,
              sellSlippage: 0,
              reserveRatio: quoteReserve / baseReserve,
              initialReserveRatio: this.initialReserveRatio,
              ratioChange: 0
            }).value,
            trade_count: 1,
            reserve_change_percent: 0.05, // Small change detected
            time_since_first_trade: 0,
            has_trade_data: true,
            timestamp: Date.now()
          });
        } else {
          const timeSinceFirstTrade = Date.now() - this.firstTradeTime;
          this.logger.log(`Trade #${this.tradeCount} detected (${timeSinceFirstTrade/1000}s since first trade)`);
        }

        // Calculate reserve changes for additional trades
        const baseReserveChange = this.lastBaseReserve ? 
          Math.abs(((baseReserve - this.lastBaseReserve) / this.lastBaseReserve) * 100) : 0;
        const quoteReserveChange = this.lastQuoteReserve ? 
          Math.abs(((quoteReserve - this.lastQuoteReserve) / this.lastQuoteReserve) * 100) : 0;
        const maxReserveChange = Math.max(baseReserveChange, quoteReserveChange);

        // For subsequent trades, still notify but with more data
        if (this.tradeCount > 1) {
          const timeSinceFirstTrade = Date.now() - (this.firstTradeTime || 0);
          
          this.logger.log(`🎯 Additional trade #${this.tradeCount} for pool ${this.poolId.toBase58().substring(0, 8)}... - ${maxReserveChange.toFixed(2)}% reserve change`);
          
          this.onUpdate({
            pool_id: this.poolId.toString(),
            base_token: this.tokenA.symbol,
            quote_token: this.tokenB.symbol,
            base_reserve: baseReserve,
            quote_reserve: quoteReserve,
            price: quoteReserve / baseReserve,
            tvl: quoteReserve * 2,
            market_pressure: this.calculateMarketPressure({
              poolId: this.poolId.toString(),
              timestamp: Date.now(),
              slot: 0,
              baseReserve: baseReserve,
              quoteReserve: quoteReserve,
              price: quoteReserve / baseReserve,
              priceChange: 0,
              tvl: quoteReserve * 2,
              marketCap: 0,
              volumeChange: 0,
              volume24h: pool.day?.volume || 0,
              suspicious: false,
              baseDecimals: pool.mintA.decimals || 9,
              quoteDecimals: pool.mintB.decimals || 6,
              buySlippage: 0,
              sellSlippage: 0,
              reserveRatio: quoteReserve / baseReserve,
              initialReserveRatio: this.initialReserveRatio,
              ratioChange: 0
            }).value,
            trade_count: this.tradeCount,
            reserve_change_percent: maxReserveChange,
            time_since_first_trade: timeSinceFirstTrade,
            has_trade_data: true,
            timestamp: Date.now()
          });
        }
      } else {
        // Log when no change is detected - removed verbose logging
        // this.logger.log(`[PoolMonitor] ✅ No reserve change for ${this.poolId.toBase58().substring(0, 8)}...`);
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

  private detectReserveChange(baseReserve: number, quoteReserve: number): boolean {
    // If this is the first time we're seeing reserves, it's not a change
    if (this.lastBaseReserve === null || this.lastQuoteReserve === null) {
      return false;
    }

    // Calculate percentage changes
    const baseChange = Math.abs((baseReserve - this.lastBaseReserve) / this.lastBaseReserve);
    const quoteChange = Math.abs((quoteReserve - this.lastQuoteReserve) / this.lastQuoteReserve);
    
    // Ultra-sensitive detection for early entry - detect changes as small as 0.05%
    return baseChange > this.RESERVE_CHANGE_THRESHOLD || quoteChange > this.RESERVE_CHANGE_THRESHOLD;
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