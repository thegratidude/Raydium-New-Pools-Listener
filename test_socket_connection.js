const { io } = require('socket.io-client');

async function testSocketConnection() {
  console.log('🧪 Testing Socket.IO connection to port 5001...');
  
  try {
    // Connect to the Socket.IO server
    const socket = io('http://localhost:5001', {
      transports: ['websocket', 'polling'],
      timeout: 5000
    });

    // Set up event listeners
    socket.on('connect', () => {
      console.log('✅ Connected to Socket.IO server!');
      console.log(`Socket ID: ${socket.id}`);
      console.log(`Transport: ${socket.io.engine.transport.name}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`❌ Disconnected: ${reason}`);
    });

    socket.on('error', (error) => {
      console.log(`❌ Socket error: ${error}`);
    });

    socket.on('new_pool', (data) => {
      console.log('📡 Received new_pool event:', data);
    });

    socket.on('health', (data) => {
      console.log('📡 Received health event:', data);
    });

    socket.on('pool_status_6', (data) => {
      console.log('📡 Received pool_status_6 event:', data);
    });

    // Wait for connection or timeout
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout after 10 seconds'));
      }, 10000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    console.log('✅ Socket connection test successful!');
    console.log('📡 Listening for events... (press Ctrl+C to exit)');
    
    // Keep the connection alive
    process.on('SIGINT', () => {
      console.log('\n🛑 Disconnecting...');
      socket.disconnect();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Socket connection test failed:', error.message);
    process.exit(1);
  }
}

testSocketConnection(); 