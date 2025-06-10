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

class RaydiumPoolMonitor {
  private ws: WebSocket | null = null;
  private activityCount = 0;
  private maxActivities = 5;
  private poolAddress: string;
  private baseMint?: string;
  private quoteMint?: string;

  constructor(poolAddress: string, baseMint?: string, quoteMint?: string) {
    this.poolAddress = poolAddress;
    this.baseMint = baseMint;
    this.quoteMint = quoteMint;
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
      this.startPing();
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

  private startPing() {
    setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        console.log('🏓 Ping sent (keeping connection alive)');
      }
    }, 30000); // Ping every 30 seconds
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
    console.log(`⚡ Compute Units: ${meta.computeUnitsConsumed.toLocaleString()}`);
    console.log(`✅ Status: ${meta.err ? '❌ Failed' : '✅ Success'}`);

    // Parse balance changes
    this.parseBalanceChanges(meta);

    // Parse logs for swap information
    this.parseSwapLogs(meta.logMessages);

    // Parse token balance changes
    this.parseTokenBalances(meta);

    console.log(`${'─'.repeat(80)}`);
  }

  private parseBalanceChanges(meta: any) {
    if (meta.preBalances && meta.postBalances && meta.preBalances.length === meta.postBalances.length) {
      console.log('\n💸 SOL Balance Changes:');
      for (let i = 0; i < meta.preBalances.length; i++) {
        const preBalance = meta.preBalances[i] / 1e9;
        const postBalance = meta.postBalances[i] / 1e9;
        const change = postBalance - preBalance;
        
        if (Math.abs(change) > 0.000001) { // Only show significant changes
          console.log(`   Account ${i}: ${change > 0 ? '+' : ''}${change.toFixed(6)} SOL`);
        }
      }
    }
  }

  private parseSwapLogs(logMessages: string[]) {
    console.log('\n📋 Program Logs:');
    
    // Look for swap-related logs
    const relevantLogs = logMessages.filter(log => 
      log.includes('swap') || 
      log.includes('Instruction:') ||
      log.includes('Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') ||
      log.includes('Transfer') ||
      log.includes('amount')
    );

    if (relevantLogs.length > 0) {
      relevantLogs.slice(0, 5).forEach(log => { // Show first 5 relevant logs
        console.log(`   📄 ${log}`);
      });
    } else {
      // Show first few logs anyway
      logMessages.slice(0, 3).forEach(log => {
        console.log(`   📄 ${log}`);
      });
    }
  }

  private parseTokenBalances(meta: any) {
    if (meta.preTokenBalances?.length > 0 || meta.postTokenBalances?.length > 0) {
      console.log('\n🪙 Token Balance Changes:');
      
      // Create a map of account indices to track changes
      const tokenChanges = new Map();

      // Process pre-balances
      meta.preTokenBalances?.forEach((balance: any) => {
        tokenChanges.set(`${balance.accountIndex}-${balance.mint}`, {
          mint: balance.mint,
          preAmount: parseFloat(balance.uiTokenAmount.uiAmountString || '0'),
          postAmount: 0,
          decimals: balance.uiTokenAmount.decimals
        });
      });

      // Process post-balances
      meta.postTokenBalances?.forEach((balance: any) => {
        const key = `${balance.accountIndex}-${balance.mint}`;
        const existing = tokenChanges.get(key) || {
          mint: balance.mint,
          preAmount: 0,
          postAmount: 0,
          decimals: balance.uiTokenAmount.decimals
        };
        
        existing.postAmount = parseFloat(balance.uiTokenAmount.uiAmountString || '0');
        tokenChanges.set(key, existing);
      });

      // Display changes
      tokenChanges.forEach((change, key) => {
        const difference = change.postAmount - change.preAmount;
        if (Math.abs(difference) > 0.000001) {
          const mintDisplay = this.getMintDisplayName(change.mint);
          console.log(`   🏷️  ${mintDisplay}: ${difference > 0 ? '+' : ''}${difference.toFixed(6)}`);
        }
      });
    }
  }

  private getMintDisplayName(mint: string): string {
    // Common token mints for better readability
    const knownMints: { [key: string]: string } = {
      'So11111111111111111111111111111111111111112': 'WSOL',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
      'DezXAZ2zCFz3vfkj5bw4YAhGPvGR4FUAXHLdNT8rSaL': 'BONK'
    };

    if (this.baseMint === mint) return 'BONK (BASE)';
    if (this.quoteMint === mint) return 'SOL (QUOTE)';
    
    return knownMints[mint] || `${mint.slice(0, 8)}...`;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// BONK/SOL pool - High activity for testing
const BONK_SOL_POOL = "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv"; // BONK/SOL pool
const BONK_MINT = "DezXAZ2zCFz3vfkj5bw4YAhGPvGR4FUAXHLdNT8rSaL"; // BONK token mint
const SOL_MINT = "So11111111111111111111111111111111111111112"; // Wrapped SOL mint

console.log('🚀 Starting Raydium Pool Monitor Test');
console.log('📁 Make sure your .env file contains HELIUS_API_KEY');
console.log('🎯 Monitoring BONK/SOL pool for high activity testing');

const monitor = new RaydiumPoolMonitor(
  BONK_SOL_POOL,
  BONK_MINT, // BONK as base token
  SOL_MINT   // SOL as quote token
);

monitor.connect();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  monitor.disconnect();
  process.exit(0);
});