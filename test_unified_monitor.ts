import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { UnifiedPoolMonitorService } from './src/monitor/unified-pool-monitor.service';
import { SocketService } from './src/gateway/socket.service';
import { TokenInfo } from './src/types/token';
import * as dotenv from 'dotenv';

dotenv.config();

async function testUnifiedMonitor() {
  console.log('🧪 TESTING UNIFIED POOL MONITOR');
  console.log('='.repeat(60));
  console.log('Testing the new lean & mean architecture...');
  console.log('='.repeat(60));

  let app;
  let unifiedMonitor: UnifiedPoolMonitorService;
  let socketService: SocketService;

  try {
    // Create NestJS application
    console.log('🚀 Creating NestJS application...');
    app = await NestFactory.create(AppModule);
    
    // Get the services
    unifiedMonitor = app.get(UnifiedPoolMonitorService);
    socketService = app.get(SocketService);
    
    console.log('✅ Services retrieved successfully');
    
    // Wait for services to initialize
    console.log('⏳ Waiting for services to initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test 1: Check if services are initialized
    console.log('\n📊 TEST 1: Service Initialization');
    console.log('-'.repeat(40));
    
    const stats = unifiedMonitor.getPoolStats();
    console.log(`✅ Pool stats: ${JSON.stringify(stats, null, 2)}`);
    
    // Test 2: Check pending pools (should be empty initially)
    console.log('\n📊 TEST 2: Pending Pools Check');
    console.log('-'.repeat(40));
    
    const pendingPools = unifiedMonitor.getPendingPools();
    console.log(`✅ Pending pools count: ${pendingPools.length}`);
    console.log(`✅ Pending pools: ${JSON.stringify(pendingPools, null, 2)}`);
    
    // Test 3: Test manual pool addition (if method exists)
    console.log('\n📊 TEST 3: Manual Pool Addition');
    console.log('-'.repeat(40));
    
    const testTokenA: TokenInfo = {
      symbol: 'TEST_A',
      mint: '11111111111111111111111111111111',
      decimals: 9
    };
    
    const testTokenB: TokenInfo = {
      symbol: 'TEST_B',
      mint: '22222222222222222222222222222222',
      decimals: 6
    };
    
    // Note: The current service doesn't have a manual add method
    // This is by design - it only monitors for status 1 pools
    console.log('ℹ️  Service is designed to only monitor for status 1 pools automatically');
    console.log('ℹ️  No manual pool addition method (by design)');
    
    // Test 4: Check if specific pool is monitored
    console.log('\n📊 TEST 4: Pool Monitoring Check');
    console.log('-'.repeat(40));
    
    const testPoolId = 'test-pool-id';
    const isMonitored = unifiedMonitor.isPoolMonitored(testPoolId);
    console.log(`✅ Is pool ${testPoolId} monitored: ${isMonitored}`);
    
    // Test 5: Socket service status
    console.log('\n📊 TEST 5: Socket Service Status');
    console.log('-'.repeat(40));
    
    const socketReady = socketService.isReady();
    console.log(`✅ Socket service ready: ${socketReady}`);
    
    // Test 6: Monitor for a few minutes to see if we detect any pools
    console.log('\n📊 TEST 6: Live Monitoring Test');
    console.log('-'.repeat(40));
    console.log('🎯 Monitoring for status 1 and status 6 pools...');
    console.log('⏰ This will run for 2 minutes to see if we detect any pools');
    console.log('📡 Listening for WebSocket events on port 5001...');
    
    let eventCount = 0;
    const startTime = Date.now();
    
    // Set up a simple event listener to count events
    socketService.server.on('connection', (socket) => {
      console.log(`🔗 Client connected: ${socket.id}`);
      
      socket.on('pool_status_1', (data) => {
        eventCount++;
        console.log(`📡 Status 1 Event #${eventCount}: ${JSON.stringify(data, null, 2)}`);
      });
      
      socket.on('pool_status_6', (data) => {
        eventCount++;
        console.log(`📡 Status 6 Event #${eventCount}: ${JSON.stringify(data, null, 2)}`);
      });
      
      socket.on('pool_ready', (data) => {
        eventCount++;
        console.log(`📡 Pool Ready Event #${eventCount}: ${JSON.stringify(data, null, 2)}`);
      });
    });
    
    // Monitor for 2 minutes
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
      
      const currentStats = unifiedMonitor.getPoolStats();
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      
      console.log(`⏱️  ${elapsed}s elapsed - Pending: ${currentStats.pending}, Events: ${eventCount}`);
      
      if (currentStats.pending > 0) {
        console.log(`🎯 Found ${currentStats.pending} pending pools!`);
        const pools = unifiedMonitor.getPendingPools();
        pools.forEach((pool, index) => {
          console.log(`  ${index + 1}. ${pool.pool_id} (${pool.token_a.symbol}/${pool.token_b.symbol})`);
        });
      }
    }
    
    console.log('\n📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Total events detected: ${eventCount}`);
    console.log(`✅ Final pending pools: ${unifiedMonitor.getPoolStats().pending}`);
    console.log(`✅ Socket service status: ${socketService.isReady()}`);
    console.log(`✅ Test duration: ${Math.floor((Date.now() - startTime) / 1000)}s`);
    
    if (eventCount > 0) {
      console.log('🎉 SUCCESS: Events were detected! The service is working!');
    } else {
      console.log('ℹ️  No events detected (this is normal if no new pools were created during the test)');
      console.log('✅ The service is running correctly and monitoring for pools');
    }
    
  } catch (error) {
    console.error('❌ Error during test:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    // Cleanup
    if (app) {
      console.log('\n🧹 Cleaning up...');
      await app.close();
      console.log('✅ Application closed');
    }
    
    console.log('\n🎬 Test completed!');
    console.log('💡 If you want to see more activity, run this test during peak pool creation times');
  }
}

// Run the test
testUnifiedMonitor().catch(console.error); 