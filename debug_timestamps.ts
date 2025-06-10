import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, decodeRaydiumPoolState } from './src/monitor/raydium-layout';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';

dotenv.config();

const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

async function debugTimestamps() {
  console.log('🔍 Debugging Pool Timestamps...\n');

  const connection = new Connection(
    process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com',
    {
      wsEndpoint: process.env.WSS_URL || 'wss://api.mainnet-beta.solana.com',
      commitment: 'confirmed'
    }
  );

  try {
    console.log('🔗 Connecting to Solana...');
    const version = await connection.getVersion();
    console.log('✅ Connected to Solana:', version);

    console.log('\n🎯 Analyzing timestamp issues...\n');

    // Test some known pools with different timestamps
    const testPools = [
      'FYAnFcdjkcfAkbtZqixnTqNVLoDjJft82L5FFgPaSWe3', // poolOpenTime: 0
      '4xxM4cdb6MEsCxM52xvYqkNbzvdeWWsPDZrBcTqVGUar', // poolOpenTime: 1704403182
      '6USpEBbN94DUYLUi4a2wo3AZDCyozon1PLGYu27jzPkX'  // poolOpenTime: 0
    ];

    for (const poolId of testPools) {
      try {
        const accountInfo = await connection.getAccountInfo(new PublicKey(poolId));
        if (!accountInfo) {
          console.log(`❌ Pool ${poolId} not found`);
          continue;
        }

        const poolState = decodeRaydiumPoolState(accountInfo.data);
        if (!poolState) {
          console.log(`❌ Could not decode pool ${poolId}`);
          continue;
        }

        console.log(`\n📊 Pool: ${poolId}`);
        console.log(`🔢 Raw poolOpenTime: ${poolState.poolOpenTime}`);
        console.log(`📅 As Date: ${new Date(poolState.poolOpenTime * 1000)}`);
        console.log(`🕐 As ISO: ${new Date(poolState.poolOpenTime * 1000).toISOString()}`);
        console.log(`🌍 As UTC: ${new Date(poolState.poolOpenTime * 1000).toUTCString()}`);
        
        // Check if it's a valid timestamp
        const isValidTimestamp = poolState.poolOpenTime > 0 && poolState.poolOpenTime < 2000000000;
        console.log(`✅ Valid timestamp: ${isValidTimestamp}`);
        
        if (!isValidTimestamp) {
          console.log(`⚠️  This appears to be an invalid or unset timestamp`);
        }

      } catch (error) {
        console.error(`❌ Error analyzing pool ${poolId}:`, error);
      }
    }

    console.log('\n🔍 Understanding the issue:');
    console.log('- poolOpenTime: 0 means the pool was created before timestamp tracking');
    console.log('- These are likely very old pools from early Raydium days');
    console.log('- We should filter these out or handle them differently');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugTimestamps().catch(console.error); 