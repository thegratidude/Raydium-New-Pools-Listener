import { PositionManagerDB } from './src/position-manager/database/position-manager-db';

async function calculatePoolMetrics() {
  console.log('🧮 Calculating Pool Metrics in New Format...');
  
  const db = new PositionManagerDB();
  await db.initialize();
  
  try {
    // Get a specific pool's data
    const poolId = '7aP5Q52FxgkVtGNdU3EXe4b7BNvepG73xgU8Srw6rtwK';
    
    // Get pool info
    const pool = await db.getStatus6Pool(poolId);
    if (!pool) {
      console.log('❌ Pool not found');
      return;
    }
    
    console.log(`📊 Pool: ${poolId}`);
    console.log(`🔢 Decimals: ${pool.decimals_a}/${pool.decimals_b}`);
    console.log(`💰 Token A: ${pool.token_a_mint}`);
    console.log(`💰 Token B (SOL): ${pool.token_b_mint}`);
    
    // Get snapshots
    const snapshots = await db.getPoolSnapshots(poolId, 10);
    if (snapshots.length === 0) {
      console.log('❌ No snapshots found');
      return;
    }
    
    // Sort by timestamp (oldest first)
    snapshots.sort((a, b) => a.timestamp - b.timestamp);
    
    // Get baseline (first snapshot)
    const baseline = snapshots[0];
    const current = snapshots[snapshots.length - 1];
    
    console.log('\n📈 Baseline Snapshot:');
    console.log(`   Timestamp: ${new Date(baseline.timestamp).toISOString()}`);
    console.log(`   Base Reserve: ${baseline.base_reserve}`);
    console.log(`   Quote Reserve (SOL): ${baseline.quote_reserve}`);
    
    console.log('\n📈 Current Snapshot:');
    console.log(`   Timestamp: ${new Date(current.timestamp).toISOString()}`);
    console.log(`   Base Reserve: ${current.base_reserve}`);
    console.log(`   Quote Reserve (SOL): ${current.quote_reserve}`);
    
    // Calculate metrics
    const baselinePrice = baseline.quote_reserve / baseline.base_reserve;
    const currentPrice = current.quote_reserve / current.base_reserve;
    const priceChangePercent = ((currentPrice - baselinePrice) / baselinePrice) * 100;
    
    // Calculate TVL in SOL
    const tvlSOL = current.quote_reserve;
    
    // Calculate ratio (base_reserve / quote_reserve)
    const ratio = current.base_reserve / current.quote_reserve;
    
    console.log('\n🧮 Calculated Metrics:');
    console.log(`   Baseline Price: ${baselinePrice.toFixed(8)} SOL`);
    console.log(`   Current Price: ${currentPrice.toFixed(8)} SOL`);
    console.log(`   Price Change: ${priceChangePercent.toFixed(2)}%`);
    console.log(`   TVL: ${tvlSOL.toFixed(2)} SOL`);
    console.log(`   Ratio: ${ratio.toFixed(6)}`);
    
    // New display format
    const priceDisplay = `${currentPrice.toFixed(8)} SOL (${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`;
    const tvlDisplay = `${tvlSOL.toFixed(2)} SOL`;
    
    console.log('\n🎯 New Display Format:');
    console.log(`💤 🔴 ${poolId.slice(0, 8)} | Price: ${priceDisplay} | 🟢 TVL: ${tvlDisplay} | Ratio: ${ratio.toFixed(6)}`);
    
    // Show price trend
    console.log('\n📊 Price Trend (last 5 snapshots):');
    snapshots.slice(-5).forEach((snapshot, index) => {
      const price = snapshot.quote_reserve / snapshot.base_reserve;
      const change = ((price - baselinePrice) / baselinePrice) * 100;
      const time = new Date(snapshot.timestamp).toLocaleTimeString();
      console.log(`   ${time}: ${price.toFixed(8)} SOL (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await db.close();
  }
}

calculatePoolMetrics().catch(console.error); 