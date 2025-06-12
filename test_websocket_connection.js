const WebSocket = require('ws');

// Test websocket connection
async function testWebSocket() {
  console.log('🔗 Testing Helius WebSocket connection...');
  
  const wsUrl = 'wss://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY';
  const ws = new WebSocket(wsUrl);
  
  let messageCount = 0;
  const maxMessages = 5;
  
  ws.on('open', () => {
    console.log('✅ WebSocket connected successfully');
    
    // Subscribe to program logs for Raydium
    const subscribeRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [
        {
          mentions: ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"]
        },
        {
          commitment: "confirmed"
        }
      ]
    };
    
    ws.send(JSON.stringify(subscribeRequest));
    console.log('📨 Sent subscription request for Raydium program logs');
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      messageCount++;
      
      console.log(`📨 Message #${messageCount}:`, JSON.stringify(message, null, 2));
      
      if (messageCount >= maxMessages) {
        console.log('✅ Received enough messages, closing connection...');
        ws.close();
      }
    } catch (error) {
      console.error('❌ Error parsing message:', error);
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket connection closed');
  });
  
  // Timeout after 30 seconds
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      console.log('⏰ Timeout reached, closing connection...');
      ws.close();
    }
  }, 30000);
}

testWebSocket().catch(console.error); 