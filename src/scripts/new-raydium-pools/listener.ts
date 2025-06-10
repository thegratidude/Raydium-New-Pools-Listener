import { Logger, INestApplication } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { SocketService } from '../../gateway/socket.service';
import { GatewayService } from '../../gateway/gateway.service';
import { LIQUIDITY_STATE_LAYOUT_V4, decodeRaydiumPoolState } from '../../scripts/pool-monitor/raydium-layout';
import { EnhancedPoolReadyMessage } from '../../types/market';
import * as dotenv from 'dotenv';

dotenv.config();

const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const logger = new Logger('SimpleRaydiumListener');

// New pool tracking interface based on Claude AI's suggestion
interface PoolInfo {
  status: number;
  openTime: number;
  detectedAt: number;
  becameTradeableAt?: number;
  baseMint?: string;
  quoteMint?: string;
  baseVault?: string;
  quoteVault?: string;
  baseDecimal?: number;
  quoteDecimal?: number;
}

class SimpleRaydiumTracker {
  private pools = new Map<string, PoolInfo>();
  private socketService: SocketService;
  private connection: Connection;
  private gatewayService: GatewayService;
  private messageCount = 0;

  constructor(socketService: SocketService, connection: Connection, gatewayService: GatewayService) {
    this.socketService = socketService;
    this.connection = connection;
    this.gatewayService = gatewayService;
  }

  startMonitoring() {
    logger.log('🚀 Simple Raydium tracker started');
    logger.log('📡 Monitoring for status 1 (new pools) and status 6 (tradeable pools)');
    logger.log(`🎯 Raydium program: ${RAYDIUM_PROGRAM_ID.toString()}`);

    // Listen for ALL Raydium program account changes
    this.connection.onProgramAccountChange(
      RAYDIUM_PROGRAM_ID,
      async (accountInfo) => {
        try {
          // Track ALL Raydium account changes for health monitoring
          this.messageCount++;
          this.gatewayService.trackRaydiumMessage();
          
          const poolId = accountInfo.accountId.toString();
          const poolState = decodeRaydiumPoolState(accountInfo.accountInfo.data);
          if (!poolState) return;
          
          const status = poolState.status;
          const openTime = poolState.poolOpenTime;
          const now = Date.now();

          const existing = this.pools.get(poolId);

          // New pool created (status 1) - only track if we haven't seen it before
          if (status === 1 && !existing) {
            // Only track if the pool opens in the future (within 24 hours)
            if (openTime > now && openTime - now < 24 * 60 * 60 * 1000) {
              this.pools.set(poolId, {
                status: 1,
                openTime,
                detectedAt: now,
                baseMint: poolState.baseMint,
                quoteMint: poolState.quoteMint,
                baseVault: poolState.baseVault,
                quoteVault: poolState.quoteVault,
                baseDecimal: poolState.baseDecimal,
                quoteDecimal: poolState.quoteDecimal
              });

              logger.log(`🆕 NEW POOL: ${poolId.substring(0, 8)}...`);
              logger.log(`   Opens: ${new Date(openTime).toISOString()}`);
              logger.log(`   Time until open: ${Math.round((openTime - now) / 1000)}s`);
              logger.log(`   Base: ${poolState.baseMint.substring(0, 8)}...`);
              logger.log(`   Quote: ${poolState.quoteMint.substring(0, 8)}...`);

              // Schedule check if opens soon
              this.scheduleOpenCheck(poolId, openTime);
            }
          }

          // Pool became tradeable (status 6) - only process if we're tracking it
          if (status === 6 && existing && !existing.becameTradeableAt) {
            existing.becameTradeableAt = now;
            const timeFromDetection = now - existing.detectedAt;
            
            logger.log(`🚀 POOL TRADEABLE: ${poolId.substring(0, 8)}...`);
            logger.log(`   Time from detection: ${timeFromDetection}ms`);
            
            // Execute arbitrage and broadcast
            await this.executeArbitrage(poolId, poolState, existing);
          }
        } catch (error) {
          // Not a pool state or other error, ignore
        }
      },
      'confirmed',
      [{ dataSize: LIQUIDITY_STATE_LAYOUT_V4.span }]
    );

    // Periodic status log
    setInterval(() => {
      const pendingCount = this.getPendingCount();
      if (pendingCount > 0) {
        logger.log(`📊 Status: ${pendingCount} pools pending status 6`);
      }
    }, 30000); // Every 30 seconds

    logger.log('✅ Simple tracker active - monitoring status 1 and status 6');
  }

  private scheduleOpenCheck(poolId: string, openTime: number) {
    const delay = openTime - Date.now();
    if (delay > 0) {
      setTimeout(() => {
        logger.log(`⏰ Checking scheduled pool: ${poolId.substring(0, 8)}...`);
        // The onProgramAccountChange should catch the status change,
        // but this is a backup check
      }, delay + 1000);
    }
  }

  private async executeArbitrage(poolId: string, poolState: any, poolInfo: PoolInfo) {
    // Your arbitrage logic here
    logger.log(`   🎯 EXECUTING ARBITRAGE FOR ${poolId.substring(0, 8)}...`);
    
    // Extract key data
    const baseMint = poolState.baseMint;
    const quoteMint = poolState.quoteMint;
    
    logger.log(`   Base: ${baseMint.substring(0, 8)}...`);
    logger.log(`   Quote: ${quoteMint.substring(0, 8)}...`);

    // Get current reserves and calculate price
    let reserves = { baseReserve: 0, quoteReserve: 0, price: 0 };
    try {
      const baseVault = new PublicKey(poolState.baseVault);
      const quoteVault = new PublicKey(poolState.quoteVault);
      
      // Get token account balances
      const [baseAccount, quoteAccount] = await Promise.all([
        this.connection.getTokenAccountBalance(baseVault),
        this.connection.getTokenAccountBalance(quoteVault)
      ]);

      const baseReserve = baseAccount.value.uiAmount || 0;
      const quoteReserve = quoteAccount.value.uiAmount || 0;
      
      // Calculate price (quote/base)
      const price = quoteReserve > 0 && baseReserve > 0 ? quoteReserve / baseReserve : 0;
      
      reserves = { baseReserve, quoteReserve, price };
    } catch (error) {
      logger.warn(`Failed to get reserves for pool ${poolId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Broadcast to port 5001 with enhanced trading data
    const message: EnhancedPoolReadyMessage = {
      event: 'pool_ready' as const,
      pool_id: poolId,
      timestamp: Date.now(),
      data: {
        base_token: baseMint,
        quote_token: quoteMint,
        base_vault: poolState.baseVault,
        quote_vault: poolState.quoteVault,
        base_decimals: poolState.baseDecimal,
        quote_decimals: poolState.quoteDecimal,
        base_reserve: reserves.baseReserve,
        quote_reserve: reserves.quoteReserve,
        price: reserves.price,
        pool_open_time: poolState.poolOpenTime,
        time_to_status_6_ms: poolInfo.becameTradeableAt ? poolInfo.becameTradeableAt - poolInfo.detectedAt : 0,
        trade_count: 0,
        reserve_change_percent: 0
      }
    };

    this.socketService.broadcastPoolReady(message);
    logger.log(`📢 Broadcasting to port 5001: ${poolId.substring(0, 8)}...`);

    // Remove from tracking
    this.pools.delete(poolId);
    logger.log(`✅ Pool removed from tracking (${this.pools.size} remaining)`);
  }

  getPendingCount(): number {
    return this.pools.size;
  }

  getPoolInfo(poolId: string): PoolInfo | undefined {
    return this.pools.get(poolId);
  }
}

let raydiumMessageCount = 0;

export async function startListener(
  app: INestApplication,
  connection: Connection,
  raydiumProgram: PublicKey,
  instructionNames: string[]
) {
  const socketService = app.get(SocketService);
  const gatewayService = app.get(GatewayService);
  const poolTracker = new SimpleRaydiumTracker(socketService, connection, gatewayService);

  // Start the new monitoring system
  poolTracker.startMonitoring();

  // Note: 1-minute health check is now handled by GatewayService
  logger.log('✅ Simple listener active - monitoring status 1 and status 6');
}

// Keep the old function for backward compatibility but mark as deprecated
async function extractPoolFromTransaction(
  connection: Connection, 
  signature: string, 
  poolTracker: any
) {
  // This function is no longer used in the new approach
  logger.warn('extractPoolFromTransaction is deprecated - using direct status monitoring instead');
}
