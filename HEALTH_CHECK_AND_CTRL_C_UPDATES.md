# Health Check and Ctrl+C Improvements

## Overview

This document describes the improvements made to add a 1-minute health check to the NestJS console and enhance the Ctrl+C mechanism in the Python client.

## Changes Made

### 1. NestJS Health Check Enhancement

#### Files Modified:
- `src/gateway/gateway.service.ts`
- `src/scripts/new-raydium-pools/listener.ts`

#### New Features:
- **1-minute console health check**: Added a new health check that runs every 60 seconds and displays in the NestJS console
- **Raydium message tracking**: Integrated Raydium message counting into the health monitoring system
- **Enhanced health metrics**: Shows server uptime, Raydium messages received, messages per minute, and socket service status

#### Health Check Output:
```
═══════════════════════════════════════════════════════════════════════════════════
🏥 NESTJS HEALTH CHECK - 19:05:36
⏱️  Server uptime: 0h 11m 20s
📨 Raydium messages received: 15 (last 60s)
📊 Raydium messages per minute: 15
🔗 Socket service ready: true
═══════════════════════════════════════════════════════════════════════════════════
```

#### Implementation Details:
- Added `consoleHealthCheckInterval` to run every 60 seconds
- Added `raydiumMessagesSinceLastCheck` counter
- Added `trackRaydiumMessage()` method to GatewayService
- Updated listener.ts to call `gatewayService.trackRaydiumMessage()` when Raydium messages are detected
- Removed duplicate 1-minute health check from listener.ts
- **Updated**: Raydium message tracking now counts ALL Raydium program messages (not just initialize2 or status 6)
- **Purpose**: General activity indicator to confirm code is alive and show Raydium network activity levels

### 2. Python Client Ctrl+C Enhancement

#### Files Modified:
- `test_websocket_listener.py`
- `test_ctrl_c.py` (new test file)

#### New Features:
- **Robust signal handling**: Enhanced Ctrl+C mechanism with graceful shutdown
- **Timeout protection**: 5-second timeout for graceful shutdown before force exit
- **Better user feedback**: Clear status messages during shutdown process
- **Error handling**: Improved error handling during disconnect operations
- **Resource cleanup**: Proper cleanup of connections and resources

#### Ctrl+C Behavior:
1. **First Ctrl+C**: Initiates graceful shutdown
   ```
   🛑 Shutdown requested (Ctrl+C)...
   ⏳ Disconnecting from server and cleaning up...
   🔌 Disconnecting from Socket.IO server...
   ✅ Successfully disconnected from server
   ✅ Shutdown complete
   ```

2. **Second Ctrl+C (within 5 seconds)**: Force shutdown
   ```
   Force shutting down...
   ```

3. **Timeout (5 seconds)**: Automatic force shutdown
   ```
   Force shutdown after timeout
   ```

#### Implementation Details:
- Added `shutdown_requested` flag to prevent multiple shutdown attempts
- Added `graceful_shutdown()` async function for proper cleanup
- Added timeout mechanism using `threading.Timer`
- Enhanced error handling in all event handlers
- Added checks for `running` flag in all event handlers
- Improved connection management and retry logic

### 3. Test File

#### New File:
- `test_ctrl_c.py`: Simple test script to verify Ctrl+C mechanism works properly

## Usage

### Starting NestJS Server:
```bash
npm run build
npm run start:prod
```

### Starting Python Client:
```bash
python test_websocket_listener.py
```

### Testing Ctrl+C:
1. Start the Python client
2. Press `Ctrl+C` to test graceful shutdown
3. The client should disconnect cleanly and exit

### Testing Health Check:
1. Start the NestJS server
2. Watch the console for 1-minute health check messages
3. The health check will show Raydium message statistics (ALL messages, not just filtered events)

## Benefits

1. **Better Monitoring**: 1-minute health checks provide regular visibility into system performance
2. **Raydium Message Tracking**: Clear visibility into overall Raydium network activity (ALL messages)
3. **Graceful Shutdown**: Python client can be stopped cleanly without leaving hanging connections
4. **User Experience**: Clear feedback during shutdown process
5. **Error Resilience**: Better error handling prevents crashes during shutdown

## Technical Notes

- The health check runs independently of the Socket.IO health broadcasts
- Raydium message counting is integrated into the existing GatewayService
- The Ctrl+C mechanism uses both SIGINT and SIGTERM signal handlers
- All async operations are properly handled during shutdown
- The timeout mechanism prevents hanging during shutdown
- **Raydium message tracking**: Counts ALL Raydium program messages as a general activity indicator
- **Purpose**: Shows overall Raydium network activity and confirms code is alive
- **Independent**: Not filtered by initialize2 or status 6 events 