import { Connection } from '@solana/web3.js';
import { PendingPoolManager } from './pending-pool-manager';
import { PoolMonitorService } from './pool-monitor.service';
import { SocketService } from '../gateway/socket.service';
import { PoolMonitorManager } from './pool-monitor-manager';
import express from 'express';
import * as dotenv from 'dotenv';

dotenv.config();

const HTTP_URL = process.env.HTTP_URL!;

// Create connection
const connection = new Connection(HTTP_URL);

// Create mock Express app
const app = express();

// Create required services
const socketService = new SocketService();
const poolMonitorManager = new PoolMonitorManager(connection, socketService);
const poolMonitorService = new PoolMonitorService(connection, socketService, poolMonitorManager);

// Create manager with required dependencies
const manager = new PendingPoolManager(connection, poolMonitorService);

// Test pool
const TEST_POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';

async function testPendingPoolManager() {
  try {
    console.log('Starting test pending pool manager...');
    manager.addPool(TEST_POOL, 'SOL', 'USDC');
    console.log('Pool added to pending manager');
  } catch (error) {
    console.error('Error in test pending pool manager:', error);
  }
}

testPendingPoolManager().catch(console.error); 