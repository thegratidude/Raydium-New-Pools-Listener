import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, decodeRaydiumPoolState } from './src/monitor/raydium-layout';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';

dotenv.config();

const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

interface TeedUpPool {
  pool_id: string;
  token_a: { symbol: string; mint: string; decimals: number };
  token_b: { symbol: string; mint: string; decimals: number };
  teed_up_at: number;
  detected_status_6: boolean;
  status_6_detected_at?: number;
}

async function testHybridMonitoring() {
  console.log('🏌️‍♂️ Testing Hybrid Pool Monitoring (Tee Up → Swing)...\n');

  const connection = new Connection(
    process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
    {
      wsEndpoint: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
      commitment: 'confirmed'
    }
  );

  const teedUpPools: Map<string, TeedUpPool> = new Map();
  let swingCount = 0;
  const MAX_SWINGS_TO_CAPTURE = 3;

  try {
    console.log('🔗 Connecting to Solana...');
    const version = await connection.getVersion();
    console.log('✅ Connected to Solana:', version);

    console.log('\n🎯 Setting up hybrid monitoring...');
    console.log('📡 Monitoring for: Tee up (initialize2) → Swing (status 6)');
    console.log('⏳ Waiting for pools to swing...\n');

    // Simulate a tee up (this would normally come from your NestJS initialize2 listener)
    const simulateTeeUp = (poolId: string, tokenA: string, tokenB: string) => {
      console.log(`\n🏌️‍♂️ SIMULATED TEE UP: ${poolId}`);
      console.log(`Base: ${tokenA}`);
      console.log(`Quote: ${tokenB}`);
      
      teedUpPools.set(poolId, {
        pool_id: poolId,
        token_a: { symbol: 'TOKEN_A', mint: tokenA, decimals: 9 },
        token_b: { symbol: 'TOKEN_B', mint: tokenB, decimals: 6 },
        teed_up_at: Date.now(),
        detected_status_6: false
      });
      
      console.log(`📝 Now tracking ${teedUpPools.size} teed up pools`);
    };

    // Set up the status 6 monitoring (the "swing" detection)
    const subscriptionId = connection.onProgramAccountChange(
      RAYDIUM_PROGRAM_ID,
      async (updatedAccountInfo) => {
        try {
          const poolId = updatedAccountInfo.accountId.toString();
          
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

          // Check if this is a pool we've been tracking (was teed up)
          const teedUpPool = teedUpPools.get(poolId);
          
          if (teedUpPool) {
            // 🎯 PERFECT! This is a pool we've been tracking
            console.log(`\n🏌️‍♂️ SWING DETECTED! Pool ${poolId} hit status 6!`);
            console.log(`⏱️  Time from tee up to swing: ${Math.floor((Date.now() - teedUpPool.teed_up_at) / 1000)}s`);
            console.log(`🎯 Base: ${teedUpPool.token_a.mint}`);
            console.log(`🎯 Quote: ${teedUpPool.token_b.mint}`);
            
            // Update tracking
            teedUpPool.detected_status_6 = true;
            teedUpPool.status_6_detected_at = Date.now();

            // Remove from tracking (mission accomplished)
            teedUpPools.delete(poolId);
            
            swingCount++;
            console.log(`📊 Swing count: ${swingCount}/${MAX_SWINGS_TO_CAPTURE}`);

            if (swingCount >= MAX_SWINGS_TO_CAPTURE) {
              console.log(`\n🎯 Captured ${MAX_SWINGS_TO_CAPTURE} swings!`);
              console.log('🛑 Stopping monitoring...');
              await connection.removeProgramAccountChangeListener(subscriptionId);
              console.log('✅ Monitoring stopped');
              process.exit(0);
            }

          } else {
            // This is a status 6 pool we weren't tracking (missed the tee up)
            console.log(`\n⚠️  Status 6 pool detected but we missed the tee up: ${poolId}`);
            console.log(`Base: ${poolState.baseMint}`);
            console.log(`Quote: ${poolState.quoteMint}`);
            console.log(`🔄 This is a missed opportunity - we didn't see the initialize2`);
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

    console.log('✅ Hybrid monitoring active!');
    console.log('📡 Listening for status 6 pools (swings)...');
    console.log('⏹️  Press Ctrl+C to stop\n');

    // Simulate some tee ups (in real implementation, these come from initialize2 detection)
    setTimeout(() => {
      console.log('\n🎬 Simulating tee ups...');
      simulateTeeUp('FYAnFcdjkcfAkbtZqixnTqNVLoDjJft82L5FFgPaSWe3', 'So11111111111111111111111111111111111111112', 'JB2wezZLdzWfnaCfHxLg193RS3Rh51ThiXxEDWQDpump');
    }, 5000);

    setTimeout(() => {
      simulateTeeUp('4xxM4cdb6MEsCxM52xvYqkNbzvdeWWsPDZrBcTqVGUar', '63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9', 'So11111111111111111111111111111111111111112');
    }, 10000);

    // Keep the script running
    process.on('SIGINT', async () => {
      console.log('\n🛑 Stopping hybrid monitoring...');
      try {
        await connection.removeProgramAccountChangeListener(subscriptionId);
        console.log('✅ Monitoring stopped');
        console.log(`📊 Final stats:`);
        console.log(`   - Teed up pools: ${teedUpPools.size}`);
        console.log(`   - Swings detected: ${swingCount}`);
        process.exit(0);
      } catch (error) {
        console.error('❌ Error stopping monitoring:', error);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('❌ Error setting up hybrid monitoring:', error);
    process.exit(1);
  }
}

// Run the test
testHybridMonitoring().catch(console.error); 