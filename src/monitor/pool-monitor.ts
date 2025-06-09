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
import { PoolUpdate } from '../types/market';
import { createMarketPressure } from '../types/market';

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
  private updateInterval: number = 5000;
  private initialReserveRatio: number | null = null;
  private retryCount: number = 0;
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAY = 2000;
  private readonly MAX_RETRY_DELAY = 32000;
  private hasSeenTrade: boolean = false;
  private subscriptionId: number | null = null;
  private readonly RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
  private tradeCount: number = 0;
  private readonly TRADE_THRESHOLD = 2; // Notify after seeing 2 trades
  private readonly TRADE_WINDOW = 30000; // 30 seconds window to observe trades
  private firstTradeTime: number | null = null;
  private initialBaseReserve: number | null = null;
  private initialQuoteReserve: number | null = null;

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
    
    // Subscribe to program account changes for swap events
    this.subscriptionId = this.connection.onProgramAccountChange(
      this.RAYDIUM_PROGRAM_ID,
      async (accountInfo, context) => {
        try {
          // Check if this is our pool
          if (!accountInfo.accountId.equals(this.poolId)) return;

          // Decode the pool state
          const poolState = decodePoolState(accountInfo.accountInfo.data);
          if (!poolState) return;

          // Check if this is a swap event by looking at the instruction data
          // Raydium swap instruction discriminator is 9
          const instructionData = accountInfo.accountInfo.data;
          if (instructionData[0] === 9) { // Swap instruction
            this.tradeCount++;
            
            // Get current reserves
            const [baseVaultInfo, quoteVaultInfo] = await this.getVaultBalancesWithRetry(poolState);
            if (baseVaultInfo && quoteVaultInfo) {
              const baseReserve = baseVaultInfo.value.uiAmount || 0;
              const quoteReserve = quoteVaultInfo.value.uiAmount || 0;
              
              if (baseReserve > 0) {
                if (!this.firstTradeTime) {
                  this.firstTradeTime = Date.now();
                  this.initialBaseReserve = baseReserve;
                  this.initialQuoteReserve = quoteReserve;
                  console.log(`[PoolMonitor] 🔥 First trade detected for pool ${this.poolId.toBase58()}`);
                  console.log(`  Initial reserves: ${baseReserve} ${this.tokenA.symbol} / ${quoteReserve} ${this.tokenB.symbol}`);
                } else {
                  const timeSinceFirstTrade = Date.now() - this.firstTradeTime;
                  
                  // Calculate reserve changes
                  const baseReserveChange = Math.abs(((baseReserve - (this.initialBaseReserve || 0)) / (this.initialBaseReserve || 1)) * 100);
                  const quoteReserveChange = Math.abs(((quoteReserve - (this.initialQuoteReserve || 0)) / (this.initialQuoteReserve || 1)) * 100);
                  const maxReserveChange = Math.max(baseReserveChange, quoteReserveChange);
                  
                  console.log(`[PoolMonitor] Trade #${this.tradeCount} detected (${timeSinceFirstTrade/1000}s since first trade)`);
                  console.log(`  Reserve changes: ${baseReserveChange.toFixed(2)}% ${this.tokenA.symbol} / ${quoteReserveChange.toFixed(2)}% ${this.tokenB.symbol}`);
                  
                  // If we've seen enough trades within our window, notify
                  if (this.tradeCount >= this.TRADE_THRESHOLD && timeSinceFirstTrade <= this.TRADE_WINDOW) {
                    console.log(`[PoolMonitor] 🎯 Pool ${this.poolId.toBase58()} is ready! Seen ${this.tradeCount} trades in ${(timeSinceFirstTrade/1000).toFixed(1)}s with ${maxReserveChange.toFixed(2)}% max reserve change`);
                    
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
                        slot: context.slot,
                        baseReserve: baseReserve,
                        quoteReserve: quoteReserve,
                        price: quoteReserve / baseReserve,
                        priceChange: ((quoteReserve / baseReserve) - (this.initialReserveRatio || 1)) * 100,
                        tvl: quoteReserve * 2,
                        marketCap: 0,
                        volumeChange: 0,
                        volume24h: 0,
                        suspicious: false,
                        baseDecimals: baseVaultInfo.value.decimals,
                        quoteDecimals: quoteVaultInfo.value.decimals,
                        buySlippage: 0,
                        sellSlippage: 0,
                        reserveRatio: quoteReserve / baseReserve,
                        initialReserveRatio: this.initialReserveRatio,
                        ratioChange: ((quoteReserve / baseReserve) - (this.initialReserveRatio || 1)) * 100
                      }).value,
                      trade_count: this.tradeCount,
                      reserve_change_percent: maxReserveChange,
                      time_since_first_trade: timeSinceFirstTrade,
                      has_trade_data: true,
                      timestamp: Date.now()
                    });
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error('Error processing program account change:', error);
        }
      },
      'confirmed'
    );

    // Initial update
    await this.processPoolUpdate();

    // Set up periodic updates
    setInterval(async () => {
      await this.processPoolUpdate();
    }, this.updateInterval);
  }

  stop() {
    if (this.subscriptionId !== null) {
      this.connection.removeProgramAccountChangeListener(this.subscriptionId);
      this.subscriptionId = null;
    }
    console.log(`[PoolMonitor] STOPPED monitoring for pool: ${this.poolId.toBase58()}`);
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

      // Get vault balances with retry logic
      const [baseVaultInfo, quoteVaultInfo] = await this.getVaultBalancesWithRetry(poolState);
      if (!baseVaultInfo || !quoteVaultInfo) {
        // If we've exceeded retries, notify the pending pool manager
        if (this.retryCount >= this.MAX_RETRIES) {
          console.error(`Failed to get vault balances after ${this.MAX_RETRIES} retries for pool ${this.poolId.toString()}`);
          return;
        }
        return;
      }

      const baseReserve = baseVaultInfo.value.uiAmount || 0;
      const quoteReserve = quoteVaultInfo.value.uiAmount || 0;
      
      // Check if we've seen a trade (reserves have changed)
      if (!this.hasSeenTrade && (baseReserve > 0 || quoteReserve > 0)) {
        this.hasSeenTrade = true;
        // Notify the pending pool manager that we've seen trade data
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
            slot: response.context.slot,
            baseReserve: baseReserve,
            quoteReserve: quoteReserve,
            price: quoteReserve / baseReserve,
            priceChange: ((quoteReserve / baseReserve) - (this.initialReserveRatio || 1)) * 100,
            tvl: quoteReserve * 2,
            marketCap: 0,
            volumeChange: 0,
            volume24h: 0,
            suspicious: false,
            baseDecimals: baseVaultInfo.value.decimals,
            quoteDecimals: quoteVaultInfo.value.decimals,
            buySlippage: 0,
            sellSlippage: 0,
            reserveRatio: quoteReserve / baseReserve,
            initialReserveRatio: this.initialReserveRatio,
            ratioChange: ((quoteReserve / baseReserve) - (this.initialReserveRatio || 1)) * 100
          }).value,
          trade_count: this.tradeCount,
          reserve_change_percent: 0,
          time_since_first_trade: 0,
          has_trade_data: true,
          timestamp: Date.now()
        });
      }
      
      // Calculate reserve ratio
      const reserveRatio = quoteReserve / baseReserve;
      
      // Set initial ratio if not set
      if (this.initialReserveRatio === null) {
        this.initialReserveRatio = reserveRatio;
      }

      // Calculate ratio change percentage
      const ratioChange = ((reserveRatio - this.initialReserveRatio) / this.initialReserveRatio) * 100;

      // Reset retry count on successful update
      this.retryCount = 0;

      // Calculate price using reserve ratio
      const price = reserveRatio;

      const snapshot: PoolSnapshot = {
        poolId: this.poolId.toString(),
        timestamp: Date.now(),
        slot: response.context.slot,
        baseReserve: baseReserve,
        quoteReserve: quoteReserve,
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
        reserveRatio: reserveRatio,
        initialReserveRatio: this.initialReserveRatio,
        ratioChange: ratioChange
      };

      // Calculate market pressure based on ratio changes
      const pressure = this.calculateMarketPressure(snapshot);

      // Call update callback with snake_case properties
      this.onUpdate({
        pool_id: this.poolId.toString(),
        base_token: this.tokenA.symbol,
        quote_token: this.tokenB.symbol,
        base_reserve: baseReserve,
        quote_reserve: quoteReserve,
        price,
        tvl: quoteReserve * 2,
        market_pressure: pressure.value,
        trade_count: this.tradeCount,
        reserve_change_percent: 0,
        time_since_first_trade: 0,
        has_trade_data: false,
        timestamp: Date.now()
      });

      // Store in history with required fields
      await insertPoolHistory({
        pool_id: this.poolId.toString(),
        base_symbol: this.tokenA.symbol,
        quote_symbol: this.tokenB.symbol,
        timestamp: Date.now(),
        price,
        tvl: quoteReserve * 2,
        base_reserve: baseReserve,
        quote_reserve: quoteReserve,
        buy_pressure: pressure.buyPressure,
        rug_risk: pressure.rugRisk,
        trend: pressure.trend,
        volume: 0 // TODO: Calculate 24h volume
      });

    } catch (error) {
      console.error('Error processing pool update:', error);
      this.handleError(error);
    }
  }

  private async getVaultBalancesWithRetry(poolState: any): Promise<[any, any] | [null, null]> {
    const delay = Math.min(this.RETRY_DELAY * Math.pow(2, this.retryCount), this.MAX_RETRY_DELAY);
    
    try {
      const [baseVaultInfo, quoteVaultInfo] = await Promise.all([
        this.connection.getTokenAccountBalance(poolState.baseVault),
        this.connection.getTokenAccountBalance(poolState.quoteVault)
      ]);

      if (!baseVaultInfo.value || !quoteVaultInfo.value) {
        throw new Error('Invalid token account data');
      }

      return [baseVaultInfo, quoteVaultInfo];
    } catch (error: any) {
      this.retryCount++;
      
      if (error.code === -32602 && error.message?.includes('not a Token account')) {
        // Token accounts not ready yet
        console.log(`Token accounts not ready for pool ${this.poolId.toString()}, retry ${this.retryCount}/${this.MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.getVaultBalancesWithRetry(poolState);
      }
      
      throw error;
    }
  }

  private handleError(error: any) {
    if (error.code === -32602 && error.message?.includes('not a Token account')) {
      // Token account error - will be handled by retry logic
      return;
    }
    
    // For other errors, log and potentially notify
    console.error(`Pool ${this.poolId.toString()} error:`, error.message || error);
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