import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, decodeRaydiumPoolState } from './src/monitor/raydium-layout';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';

dotenv.config();

const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

interface PendingPool {
  pool_id: string;
  token_a: { symbol: string; mint: string; decimals: number };
  token_b: { symbol: string; mint: string; decimals: number };
  state: 'pending' | 'ready' | 'indexed' | 'failed';
  initialize2_detected_at: number;
  status_6_detected_at?: number;
}

async function testHybridNestJSFlow() {
  console.log('🏌️‍♂️ Testing NestJS Hybrid Flow (Initialize2 → Status 6 → Port 5001)...\n');

  const connection = new Connection(
    process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
    {
      wsEndpoint: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
      commitment: 'confirmed'
    }
  );

  const pendingPools: Map<string, PendingPool> = new Map();
  let status6Count = 0;
  const MAX_STATUS6_TO_CAPTURE = 2;

  try {
    console.log('🔗 Connecting to Solana...');
    const version = await connection.getVersion();
    console.log('✅ Connected to Solana:', version);

    console.log('\n🎯 Setting up hybrid NestJS flow...');
    console.log('📡 Flow: Initialize2 → Add to Pending → Status 6 → Port 5001');
    console.log('⏳ Waiting for status 6 pools...\n');

    // Simulate NestJS initialize2 detection (this would normally come from your NestJS listener)
    const simulateInitialize2Detection = (poolId: string, baseMint: string, quoteMint: string) => {
      console.log(`\n🏌️‍♂️ NESTJS: INITIALIZE2 DETECTED: ${poolId}`);
      console.log(`Base mint: ${baseMint}`);
      console.log(`Quote mint: ${quoteMint}`);
      
      // Add to pending pools (simulating what NestJS would do)
      pendingPools.set(poolId, {
        pool_id: poolId,
        token_a: { symbol: 'TOKEN_A', mint: baseMint, decimals: 9 },
        token_b: { symbol: 'TOKEN_B', mint: quoteMint, decimals: 6 },
        state: 'pending',
        initialize2_detected_at: Date.now()
      });
      
      console.log(`📝 Added to pending pools - now tracking ${pendingPools.size} pools`);
      console.log(`⏳ Waiting for status 6 detection...`);
    };

    // Set up the status 6 monitoring (simulating what PendingPoolManager would do)
    const subscriptionId = connection.onProgramAccountChange(
      RAYDIUM_PROGRAM_ID,
      async (updatedAccountInfo) => {
        try {
          const poolId = updatedAccountInfo.accountId.toString();
          
          // Check if this is a pool we're tracking (from initialize2)
          const pendingPool = pendingPools.get(poolId);
          if (!pendingPool) {
            return; // Not tracking this pool
          }

          // Decode the pool state
          const poolState = decodeRaydiumPoolState(updatedAccountInfo.accountInfo.data);
          if (!poolState) {
            return;
          }

          // Verify it's actually status 6
          if (poolState.status !== 6) {
            return;
          }

          // Filter out legacy pools (poolOpenTime: 0)
          if (poolState.poolOpenTime === 0) {
            console.log(`⏭️  Skipping legacy pool (poolOpenTime: 0)`);
            return;
          }

          // Check if pool is actually open for trading
          const currentTime = Math.floor(Date.now() / 1000);
          if (currentTime < poolState.poolOpenTime) {
            console.log(`⏰ Pool ${poolId} status 6 but not yet open`);
            return;
          }

          // 🎯 STATUS 6 DETECTED FOR TRACKED POOL!
          console.log(`\n🏌️‍♂️ NESTJS: SWING DETECTED! Pool ${poolId} hit status 6!`);
          console.log(`⏱️  Time from initialize2 to status 6: ${Math.floor((Date.now() - pendingPool.initialize2_detected_at) / 1000)}s`);
          
          // Update pool state
          pendingPool.status_6_detected_at = Date.now();
          pendingPool.state = 'ready';

          // Simulate sending to port 5001
          const message = {
            event: 'status_6_detected',
            pool_id: poolId,
            timestamp: Date.now(),
            data: {
              base_token: pendingPool.token_a.symbol,
              quote_token: pendingPool.token_b.symbol,
              base_mint: pendingPool.token_a.mint,
              quote_mint: pendingPool.token_b.mint,
              time_from_initialize2_seconds: Math.floor((Date.now() - pendingPool.initialize2_detected_at) / 1000),
              initialize2_detected_at: new Date(pendingPool.initialize2_detected_at).toISOString(),
              status_6_detected_at: new Date(pendingPool.status_6_detected_at).toISOString(),
              detection_method: 'hybrid_initialize2_to_status6'
            }
          };

          console.log(`📢 SENDING TO PORT 5001:`);
          console.log(JSON.stringify(message, null, 2));
          console.log(`🚀 STATUS 6 DETECTED - READY FOR ARBITRAGE!`);

          // Remove from pending pools (mission accomplished)
          pendingPools.delete(poolId);
          console.log(`✅ Pool ${poolId} removed from pending list`);
          
          status6Count++;
          console.log(`📊 Status 6 count: ${status6Count}/${MAX_STATUS6_TO_CAPTURE}`);

          if (status6Count >= MAX_STATUS6_TO_CAPTURE) {
            console.log(`\n🎯 Captured ${MAX_STATUS6_TO_CAPTURE} status 6 detections!`);
            console.log('🛑 Stopping monitoring...');
            await connection.removeProgramAccountChangeListener(subscriptionId);
            console.log('✅ Monitoring stopped');
            process.exit(0);
          }

        } catch (error) {
          console.error('❌ Error processing account change:', error);
        }
      },
      'confirmed',
      [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        { 
          memcmp: { 
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
            bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]) // Status 6 in little-endian
          }
        }
      ]
    );

    console.log('✅ Hybrid NestJS flow active!');
    console.log('📡 Listening for status 6 pools...');
    console.log('⏹️  Press Ctrl+C to stop\n');

    // Simulate some initialize2 detections (in real implementation, these come from NestJS listener)
    setTimeout(() => {
      console.log('\n🎬 Simulating NestJS initialize2 detections...');
      simulateInitialize2Detection('4xxM4cdb6MEsCxM52xvYqkNbzvdeWWsPDZrBcTqVGUar', '63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9', 'So11111111111111111111111111111111111111112');
    }, 5000);

    setTimeout(() => {
      simulateInitialize2Detection('83G6VzJzLRCnHBsLATj94VCpRimyyqwuN6ZfL11McADL', 'GtDZKAqvMZMnti46ZewMiXCa4oXF4bZxwQPoKzXPFxZn', 'So11111111111111111111111111111111111111112');
    }, 10000);

    // Keep the script running
    process.on('SIGINT', async () => {
      console.log('\n🛑 Stopping hybrid NestJS flow...');
      try {
        await connection.removeProgramAccountChangeListener(subscriptionId);
        console.log('✅ Monitoring stopped');
        console.log(`📊 Final stats:`);
        console.log(`   - Pending pools: ${pendingPools.size}`);
        console.log(`   - Status 6 detections: ${status6Count}`);
        process.exit(0);
      } catch (error) {
        console.error('❌ Error stopping monitoring:', error);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('❌ Error setting up hybrid NestJS flow:', error);
    process.exit(1);
  }
}

// Run the test
testHybridNestJSFlow().catch(console.error); 