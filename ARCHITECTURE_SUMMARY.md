# Raydium Pool Listener Architecture Summary

## Overview

The system implements a **two-listener architecture** for monitoring Raydium pools:

1. **Listener 1**: Monitors for `initialize2` instructions (new pool creation)
2. **Listener 2**: Monitors for `status 6` pools (ready for trading)

Both listeners run in parallel and can handle multiple pools simultaneously.

## Architecture Flow

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Listener 1    │    │  Pending Pools  │    │   Listener 2    │
│                 │    │                 │    │                 │
│ Monitor for     │───▶│ Map<string,     │───▶│ Monitor for     │
│ initialize2     │    │ PendingPool>    │    │ status 6        │
│ instructions    │    │                 │    │ pools           │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Extract pool    │    │ Track multiple  │    │ Broadcast to    │
│ info from tx    │    │ pools waiting   │    │ port 5001      │
│                 │    │ for status 6    │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Implementation Details

### Listener 1: Initialize2 Detection
- **Method**: `connection.onLogs(raydiumProgram, ...)`
- **Trigger**: Detects `initialize2` instruction in program logs
- **Action**: 
  - Extracts pool information from transaction
  - Adds pool to `pendingPools` Map
  - **Note**: Tracks ALL Raydium messages for health monitoring (not just initialize2)

### Listener 2: Status 6 Detection
- **Method**: `connection.onProgramAccountChange(raydiumProgram, ...)`
- **Trigger**: Detects pools with status = 6
- **Action**:
  - Checks if pool is in `pendingPools` Map
  - If found, broadcasts `pool_ready` event to port 5001
  - Removes pool from pending list
  - **Note**: Tracks ALL Raydium account changes for health monitoring (not just status 6)

### Pending Pools Management
- **Storage**: `Map<string, PendingPool>` in `SimplePoolTracker`
- **Structure**:
  ```typescript
  interface PendingPool {
    pool_id: string;
    base_mint: string;
    quote_mint: string;
    detected_at: number;
  }
  ```
- **Concurrent Handling**: Can track multiple pools simultaneously

## Key Features

### ✅ Parallel Operation
- Both listeners run simultaneously without conflict
- Status 6 listener only processes pools previously detected by initialize2 listener
- No race conditions or duplicate processing

### ✅ Multiple Pool Support
- Can handle multiple pending pools at the same time
- Each pool is tracked independently
- Automatic cleanup when status 6 is reached

### ✅ Health Monitoring
- 1-minute console health checks showing:
  - Server uptime
  - **Raydium messages received** (ALL messages, not just filtered events)
  - Messages per minute rate
  - Socket service status
- **Purpose**: General activity indicator to confirm code is alive and show Raydium network activity levels
- **Logging**: Reduced verbosity - only shows essential events and 1-minute summaries

### ✅ Robust Python Client
- Enhanced Ctrl+C mechanism with graceful shutdown
- 5-second timeout protection
- Clear user feedback during shutdown
- Proper resource cleanup

## File Structure

```
src/
├── scripts/new-raydium-pools/
│   └── listener.ts              # Main two-listener implementation
├── gateway/
│   ├── gateway.service.ts       # Health monitoring service
│   └── socket.service.ts        # Socket.IO server
└── monitor/
    └── monitor.module.ts        # DISABLED (conflicting services)
```

## Recent Improvements

### 1. Health Check Enhancement
- Added 1-minute console health checks to NestJS
- **Updated**: Raydium message tracking now counts ALL messages (general activity indicator)
- Enhanced health metrics display

### 2. Ctrl+C Mechanism
- Robust signal handling in Python client
- Graceful shutdown with timeout protection
- Better error handling and user feedback

### 3. Conflict Resolution
- Disabled conflicting monitor services in `MonitorModule`
- Ensured only the new listener runs
- Eliminated duplicate processing

### 4. Message Tracking Clarification
- **Raydium messages received**: Counts ALL Raydium program messages
- **Purpose**: Shows overall Raydium network activity and confirms code is alive
- **Independent**: Not filtered by initialize2 or status 6 events

## Usage

### Starting NestJS Server
```bash
npm run build
npm run start:prod
```

### Starting Python Client
```bash
python test_websocket_listener.py
```

### Health Check Output
```
═══════════════════════════════════════════════════════════════════════════════════
🏥 NESTJS HEALTH CHECK - 19:05:36
⏱️  Server uptime: 0h 11m 20s
📨 Raydium messages received: 15 (last 60s)  # ALL Raydium messages
📊 Raydium messages per minute: 15
🔗 Socket service ready: true
═══════════════════════════════════════════════════════════════════════════════════
```

### Ctrl+C Behavior
```
🛑 Shutdown requested (Ctrl+C)...
⏳ Disconnecting from server and cleaning up...
🔌 Disconnecting from Socket.IO server...
✅ Successfully disconnected from server
✅ Shutdown complete
```

## Benefits

1. **Scalable**: Can handle multiple pools simultaneously
2. **Reliable**: No conflicts between listeners
3. **Monitorable**: Comprehensive health checks with general activity indicators
4. **Maintainable**: Clean separation of concerns
5. **User-Friendly**: Robust shutdown mechanisms

## Technical Notes

- **Raydium Program ID**: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`
- **Socket Port**: 5001
- **Health Check Interval**: 60 seconds
- **Status 6 Filter**: Only processes pools in pending list
- **Graceful Shutdown**: 5-second timeout for Python client
- **Message Tracking**: ALL Raydium messages (general activity indicator) 