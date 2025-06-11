import { LifeguardService } from './src/lifeguard/lifeguard.service';
import { PositionManagerService } from './src/position-manager/position-manager.service';
import { EarlyTradingStrategyService } from './src/position-manager/early-trading-strategy.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

async function testLifeguardService() {
  console.log('🧪 Testing Lifeguard Service...');
  
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
    
    // Check if it's monitoring any pools
    const monitoredCount = lifeguard.getMonitoredPoolsCount();
    console.log(`📊 Currently monitoring ${monitoredCount} pools`);
    
    // Get the monitored pools
    const monitoredPools = lifeguard.getMonitoredPools();
    console.log('🏊‍♂️ Monitored pools:', monitoredPools);
    
    // Wait a bit to see if any monitoring happens
    console.log('⏳ Waiting 10 seconds to see if monitoring produces results...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Check snapshots again
    const snapshots = await positionManagerService.getPoolSnapshots('test', 10);
    console.log(`📸 Snapshots created: ${snapshots.length}`);
    
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testLifeguardService(); 