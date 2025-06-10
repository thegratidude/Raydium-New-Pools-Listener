import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, decodeRaydiumPoolState } from './src/monitor/raydium-layout';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

interface RawPoolData {
  poolId: string;
  timestamp: string;
  rawAccountData: string;
  decodedPoolState: any;
  accountInfo: any;
}

async function testStatus6Monitoring() {
  console.log('🧪 Testing Status 6 Pool Monitoring - Raw Data Capture...\n');

  const connection = new Connection(
    process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
    {
      wsEndpoint: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
      commitment: 'confirmed'
    }
  );

  const capturedPools: RawPoolData[] = [];
  const MAX_POOLS_TO_CAPTURE = 5;

  try {
    console.log('🔗 Connecting to Solana...');
    
    // Test the connection
    const version = await connection.getVersion();
    console.log('✅ Connected to Solana:', version);

    console.log('\n🎯 Setting up status 6 monitoring...');
    console.log(`📡 Monitoring for pools with status = 6 (tradeable)`);
    console.log(`📝 Will capture first ${MAX_POOLS_TO_CAPTURE} status 6 pools with full raw data`);
    console.log('⏳ Waiting for new status 6 pools...\n');

    // Set up the program account change listener
    const subscriptionId = connection.onProgramAccountChange(
      RAYDIUM_PROGRAM_ID,
      async (updatedAccountInfo) => {
        try {
          const poolId = updatedAccountInfo.accountId.toString();
          
          // Decode the pool state
          const poolState = decodeRaydiumPoolState(updatedAccountInfo.accountInfo.data);
          if (!poolState) {
            console.log(`❌ Could not decode pool state for ${poolId}`);
            return;
          }

          // Only process status 6 pools
          if (poolState.status !== 6) {
            return;
          }

          console.log(`\n🔄 STATUS 6 POOL DETECTED: ${poolId}`);
          console.log(`📊 Pool Status: ${poolState.status}`);
          console.log(`📅 Pool Open Time: ${new Date(poolState.poolOpenTime * 1000)}`);
          console.log(`🪙 Base Mint: ${poolState.baseMint}`);
          console.log(`💱 Quote Mint: ${poolState.quoteMint}`);
          console.log(`🔢 Base Decimals: ${poolState.baseDecimal}`);
          console.log(`🔢 Quote Decimals: ${poolState.quoteDecimal}`);

          // Check if pool is actually open for trading
          const currentTime = Math.floor(Date.now() / 1000);
          const isOpenForTrading = currentTime >= poolState.poolOpenTime;
          
          // NEW: Filter out legacy pools (poolOpenTime: 0)
          if (poolState.poolOpenTime === 0) {
            console.log(`⏭️  Skipping legacy pool (poolOpenTime: 0 - created before timestamp tracking)`);
            return;
          }
          
          // NEW: Filter for pools that became status 6 recently (within last hour)
          const ONE_HOUR = 60 * 60; // 1 hour in seconds
          const poolBecameStatus6Recently = (currentTime - poolState.poolOpenTime) <= ONE_HOUR;
          
          console.log(`⏰ Open for Trading: ${isOpenForTrading ? 'YES' : 'NO'}`);
          console.log(`🕐 Current Time: ${new Date(currentTime * 1000)}`);
          console.log(`🕐 Pool Open Time: ${new Date(poolState.poolOpenTime * 1000)}`);
          console.log(`🆕 Recently Created: ${poolBecameStatus6Recently ? 'YES' : 'NO'}`);
          
          // Only process pools that became status 6 recently
          if (!poolBecameStatus6Recently) {
            console.log(`⏭️  Skipping old pool (created ${Math.floor((currentTime - poolState.poolOpenTime) / 3600)} hours ago)`);
            return;
          }

          // Capture raw data
          const rawPoolData: RawPoolData = {
            poolId,
            timestamp: new Date().toISOString(),
            rawAccountData: updatedAccountInfo.accountInfo.data.toString('base64'),
            decodedPoolState: poolState,
            accountInfo: {
              accountId: updatedAccountInfo.accountId.toString(),
              dataLength: updatedAccountInfo.accountInfo.data.length,
              owner: updatedAccountInfo.accountInfo.owner.toString(),
              executable: updatedAccountInfo.accountInfo.executable,
              lamports: updatedAccountInfo.accountInfo.lamports,
              rentEpoch: updatedAccountInfo.accountInfo.rentEpoch
            }
          };

          capturedPools.push(rawPoolData);
          console.log(`📝 Captured pool ${capturedPools.length}/${MAX_POOLS_TO_CAPTURE}`);

          // Save to file after each capture
          fs.writeFileSync(
            'status_6_pools_raw_data.json', 
            JSON.stringify(capturedPools, null, 2)
          );
          console.log(`💾 Saved raw data to status_6_pools_raw_data.json`);

          // Stop after capturing MAX_POOLS_TO_CAPTURE
          if (capturedPools.length >= MAX_POOLS_TO_CAPTURE) {
            console.log(`\n🎯 Captured ${MAX_POOLS_TO_CAPTURE} status 6 pools!`);
            console.log('📊 Summary of captured pools:');
            
            capturedPools.forEach((pool, index) => {
              console.log(`\n${index + 1}. Pool: ${pool.poolId}`);
              console.log(`   Base: ${pool.decodedPoolState.baseMint}`);
              console.log(`   Quote: ${pool.decodedPoolState.quoteMint}`);
              console.log(`   Open Time: ${new Date(pool.decodedPoolState.poolOpenTime * 1000)}`);
              console.log(`   Data Size: ${pool.accountInfo.dataLength} bytes`);
            });

            console.log('\n🛑 Stopping monitoring...');
            await connection.removeProgramAccountChangeListener(subscriptionId);
            console.log('✅ Monitoring stopped');
            console.log('📄 Check status_6_pools_raw_data.json for complete raw data');
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

    console.log('✅ Status 6 monitoring active!');
    console.log('📡 Listening for status 6 pools...');
    console.log('⏹️  Press Ctrl+C to stop\n');

    // Keep the script running
    process.on('SIGINT', async () => {
      console.log('\n🛑 Stopping status 6 monitoring...');
      try {
        await connection.removeProgramAccountChangeListener(subscriptionId);
        console.log('✅ Monitoring stopped');
        if (capturedPools.length > 0) {
          console.log(`📊 Captured ${capturedPools.length} pools before stopping`);
        }
        process.exit(0);
      } catch (error) {
        console.error('❌ Error stopping monitoring:', error);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('❌ Error setting up status 6 monitoring:', error);
    process.exit(1);
  }
}

// Run the test
testStatus6Monitoring().catch(console.error); 