import { LifeguardService } from './src/lifeguard/lifeguard.service';
import { PositionManagerService } from './src/position-manager/position-manager.service';
import { EarlyTradingStrategyService } from './src/position-manager/early-trading-strategy.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

async function testOptimizedLifeguardService() {
  console.log('🧪 Testing Optimized Lifeguard Service...');
  
  try {
    // Create a mock event emitter
    const eventEmitter = new EventEmitter2();
    
    // Create the Position Manager service
    const positionManagerService = new PositionManagerService(eventEmitter);
    await positionManagerService.onModuleInit();
    console.log('✅ Position Manager service initialized');
    
    // Create the Early Trading Strategy service
    const earlyTradingService = new EarlyTradingStrategyService(positionManagerService, eventEmitter);
    await earlyTradingService.onModuleInit();
    console.log('✅ Early Trading Strategy service initialized');
    
    // Create the Lifeguard service
    const lifeguard = new LifeguardService(eventEmitter, positionManagerService, earlyTradingService);
    console.log('✅ Lifeguard service created');
    
    // Initialize the service
    await lifeguard.onModuleInit();
    console.log('✅ Lifeguard service initialized');
    
    // Set up periodic health checks
    const healthCheckInterval = setInterval(async () => {
      const health = await lifeguard.getHealthStatus();
      const stats = lifeguard.getMonitoringStats();
      
      console.log('\n📊 HEALTH CHECK:');
      console.log(`Status: ${health.status}`);
      console.log(`Total Pools: ${stats.totalPools}`);
      console.log(`Priority Breakdown: H:${stats.priorityBreakdown.high} M:${stats.priorityBreakdown.medium} L:${stats.priorityBreakdown.low}`);
      console.log(`Queue: ${stats.queueStats.pendingUpdates} pending, ${stats.queueStats.requestQueueLength} queued, ${stats.queueStats.activeRequests} active`);
      console.log(`Rate Limit: ${stats.rateLimitStats.requestsPerSecond}/${stats.rateLimitStats.maxRequestsPerSecond} req/s`);
      
      if (health.issues.length > 0) {
        console.log('⚠️ Issues:', health.issues);
      }
      
      // Auto-optimize if there are issues
      if (health.issues.length > 2) {
        console.log('🔧 Running auto-optimization...');
        const optimizations = lifeguard.optimizeMonitoring();
        console.log(`✅ Auto-optimization complete: ${optimizations} changes`);
      }
    }, 30000); // Every 30 seconds
    
    // Set up emergency stop handler
    process.on('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, performing emergency stop...');
      clearInterval(healthCheckInterval);
      lifeguard.emergencyStop();
      process.exit(0);
    });
    
    // Monitor for a few minutes to see the optimization in action
    console.log('\n🎯 Monitoring with optimizations for 5 minutes...');
    console.log('📡 Watch for priority indicators: 🔥 (high), ⚡ (medium), 💤 (low)');
    console.log('📊 Health checks will run every 30 seconds');
    console.log('🛑 Press Ctrl+C for emergency stop');
    
    // Wait for monitoring to run
    await new Promise(resolve => setTimeout(resolve, 300000)); // 5 minutes
    
    // Final stats
    console.log('\n📈 FINAL STATISTICS:');
    const finalStats = lifeguard.getMonitoringStats();
    console.log(JSON.stringify(finalStats, null, 2));
    
    // Cleanup
    clearInterval(healthCheckInterval);
    lifeguard.emergencyStop();
    
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testOptimizedLifeguardService(); 