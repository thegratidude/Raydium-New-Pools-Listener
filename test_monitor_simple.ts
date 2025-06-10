import * as WebSocket from 'ws';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface TransactionNotification {
  jsonrpc: string;
  method: string;
  params: {
    subscription: number;
    result: {
      transaction: {
        transaction: any;
        meta: {
          err: any;
          status: any;
          fee: number;
          preBalances: number[];
          postBalances: number[];
          innerInstructions: any[];
          logMessages: string[];
          preTokenBalances: any[];
          postTokenBalances: any[];
          rewards: any;
          loadedAddresses: any;
          computeUnitsConsumed: number;
        };
      };
      signature: string;
      slot: number;
    };
  };
}

class SimpleRaydiumMonitor {
  private ws: WebSocket | null = null;
  private activityCount = 0;
  private maxActivities = 3; // Reduced for faster testing
  private poolAddress: string;

  constructor(poolAddress: string) {
    this.poolAddress = poolAddress;
  }

  connect() {
    const apiKey = process.env.HELIUS_API_KEY;
    let wsUrl: string;
    
    if (apiKey) {
      wsUrl = `wss://atlas-mainnet.helius-rpc.com/?api-key=${apiKey}`;
      console.log('🔗 Connecting to Helius WebSocket...');
    } else {
      wsUrl = 'wss://api.mainnet-beta.solana.com';
      console.log('🔗 Connecting to public Solana WebSocket (no API key found)...');
    }
    
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('✅ WebSocket connected successfully');
      console.log(`📡 Monitoring pool: ${this.poolAddress}`);
      console.log(`🎯 Waiting for first ${this.maxActivities} transactions...\n`);
      this.subscribeToPool();
    });

    this.ws.on('message', (data: Buffer) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error: Error) => {
      console.error('❌ WebSocket error:', error);
    });

    this.ws.on('close', () => {
      console.log('🔌 WebSocket connection closed');
    });
  }

  private subscribeToPool() {
    if (!this.ws) return;

    const request = {
      jsonrpc: "2.0",
      id: 420,
      method: "transactionSubscribe",
      params: [
        {
          accountInclude: [this.poolAddress]
        },
        {
          commitment: "processed",
          encoding: "jsonParsed",
          transactionDetails: "full",
          showRewards: true,
          maxSupportedTransactionVersion: 0
        }
      ]
    };

    this.ws.send(JSON.stringify(request));
    console.log('📨 Subscription request sent');
  }

  private handleMessage(data: Buffer) {
    try {
      const messageStr = data.toString('utf8');
      const messageObj = JSON.parse(messageStr);

      // Handle subscription confirmation
      if (messageObj.id === 420 && messageObj.result) {
        console.log(`✅ Subscription confirmed. ID: ${messageObj.result}`);
        return;
      }

      // Handle transaction notifications
      if (messageObj.method === 'transactionNotification') {
        this.activityCount++;
        this.parseTransaction(messageObj as TransactionNotification);

        // Stop after max activities
        if (this.activityCount >= this.maxActivities) {
          console.log(`\n🎉 Captured ${this.maxActivities} activities. Disconnecting...`);
          this.disconnect();
        }
      }
    } catch (error) {
      console.error('❌ Failed to parse message:', error);
    }
  }

  private parseTransaction(notification: TransactionNotification) {
    const { transaction, signature, slot } = notification.params.result;
    const { meta } = transaction;

    console.log(`\n🔥 ACTIVITY #${this.activityCount}`);
    console.log(`📝 Signature: ${signature}`);
    console.log(`🎰 Slot: ${slot.toLocaleString()}`);
    console.log(`💰 Fee: ${meta.fee / 1e9} SOL`);
    console.log(`✅ Status: ${meta.err ? '❌ Failed' : '✅ Success'}`);

    // Show first few log messages
    if (meta.logMessages && meta.logMessages.length > 0) {
      console.log('\n📋 First 3 Log Messages:');
      meta.logMessages.slice(0, 3).forEach((log, index) => {
        console.log(`   ${index + 1}. ${log}`);
      });
    }

    console.log(`${'─'.repeat(50)}`);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Test with a different pool (USDC/SOL - usually more active)
const USDC_SOL_POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"; // USDC/SOL pool

console.log('🧪 Simple Raydium Pool Monitor Test');
console.log('📁 Testing with USDC/SOL pool (usually more active)');
console.log('🎯 Will capture 3 transactions then exit automatically');

const monitor = new SimpleRaydiumMonitor(USDC_SOL_POOL);

monitor.connect();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  monitor.disconnect();
  process.exit(0);
});

// Auto-exit after 2 minutes if no activity
setTimeout(() => {
  console.log('\n⏰ Timeout reached. No activity detected.');
  monitor.disconnect();
  process.exit(0);
}, 120000); 