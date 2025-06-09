import { Connection, PublicKey } from '@solana/web3.js';
import { Api } from '@raydium-io/raydium-sdk-v2';
import * as dotenv from 'dotenv';

dotenv.config();

// Test one of the pools from the logs
const TEST_POOL_ID = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1/FjPAB3tz7pHPHVYn7HUmGcepodSNfdGXMhZs8395z3AR';

async function testPoolMonitor() {
  console.log('🔍 Testing Pool Monitor for:', TEST_POOL_ID);
  console.log('=====================================');

  const connection = new Connection(process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com');
  const api = new Api({ cluster: 'mainnet', timeout: 30000 });

  try {
    // Method 1: Try Raydium API
    console.log('\n📡 Testing Raydium API...');
    const poolInfo = await api.fetchPoolById({ ids: TEST_POOL_ID });
    
    if (Array.isArray(poolInfo) && poolInfo.length > 0 && poolInfo[0]) {
      const pool = poolInfo[0];
      console.log('✅ Pool found in Raydium API!');
      console.log('Pool data:', {
        mintA: pool.mintA?.address,
        mintB: pool.mintB?.address,
        mintAmountA: pool.mintAmountA,
        mintAmountB: pool.mintAmountB,
        dayVolume: pool.day?.volume,
        weekVolume: pool.week?.volume
      });
    } else {
      console.log('❌ Pool not found in Raydium API');
    }

    // Method 2: Try direct account lookup
    console.log('\n🔍 Testing direct account lookup...');
    const accountInfo = await connection.getAccountInfo(new PublicKey(TEST_POOL_ID));
    
    if (accountInfo) {
      console.log('✅ Pool account exists on-chain!');
      console.log('Account data length:', accountInfo.data.length);
      console.log('Account owner:', accountInfo.owner.toBase58());
      
      // Try to decode as pool state
      try {
        const { LIQUIDITY_STATE_LAYOUT_V4 } = require('./src/scripts/pool-monitor/raydium-layout');
        const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.data);
        console.log('✅ Successfully decoded pool state!');
        console.log('Pool state:', {
          status: poolState.status.toNumber(),
          baseMint: new PublicKey(poolState.coinMintAddress).toBase58(),
          quoteMint: new PublicKey(poolState.pcMintAddress).toBase58(),
          baseVault: new PublicKey(poolState.poolCoinTokenAccount).toBase58(),
          quoteVault: new PublicKey(poolState.poolPcTokenAccount).toBase58(),
          poolOpenTime: new Date(poolState.poolOpenTime.toNumber() * 1000)
        });
      } catch (decodeError) {
        console.log('❌ Could not decode as pool state:', decodeError.message);
      }
    } else {
      console.log('❌ Pool account not found on-chain');
    }

    // Method 3: Check token account balances
    console.log('\n💰 Testing token account balances...');
    try {
      const { LIQUIDITY_STATE_LAYOUT_V4 } = require('./src/scripts/pool-monitor/raydium-layout');
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo!.data);
      
      const baseVault = new PublicKey(poolState.poolCoinTokenAccount);
      const quoteVault = new PublicKey(poolState.poolPcTokenAccount);
      
      const [baseBalance, quoteBalance] = await Promise.all([
        connection.getTokenAccountBalance(baseVault),
        connection.getTokenAccountBalance(quoteVault)
      ]);
      
      console.log('✅ Token account balances:');
      console.log('Base vault balance:', baseBalance.value);
      console.log('Quote vault balance:', quoteBalance.value);
      
      if (baseBalance.value && quoteBalance.value) {
        const baseAmount = baseBalance.value.uiAmount || 0;
        const quoteAmount = quoteBalance.value.uiAmount || 0;
        const price = quoteAmount / baseAmount;
        
        console.log('📊 Calculated price:', price);
        console.log('📊 TVL estimate:', quoteAmount * 2);
      }
      
    } catch (error) {
      console.log('❌ Error checking token balances:', error.message);
    }

  } catch (error) {
    console.error('❌ Error testing pool:', error);
  }
}

testPoolMonitor().catch(console.error); 