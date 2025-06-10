# Lifeguard Service Monitoring Behavior

## Overview

The LifeguardService now implements a precise 15-minute monitoring window for each pool, with automatic cleanup of old pools to keep the system efficient.

## Monitoring Rules

### 🕐 **15-Minute Monitoring Window**
- **New pools**: When a pool is detected, Lifeguard monitors it for exactly 15 minutes from the detection time
- **Existing pools**: On startup, only pools less than 15 minutes old are monitored
- **Automatic stop**: After 15 minutes, monitoring automatically stops and pool status is set to 'analyzed'

### 🧹 **30-Minute Cleanup**
- **Startup cleanup**: Pools older than 30 minutes are marked as 'ignored' and removed from pending list
- **Manual cleanup**: `cleanupOldPools()` method can be called to clean up old pools
- **Data retention**: All snapshot data is preserved for post-analysis

## Pool Lifecycle

```
Pool Detected (Status 6)
         ↓
    < 15 minutes old?
         ↓
    ┌─ YES → Start Monitoring (15min window)
    └─ NO  → Skip Monitoring
         ↓
    Monitoring Active
         ↓
    15 minutes elapsed
         ↓
    Stop Monitoring → Status: 'analyzed'
         ↓
    Snapshot Data Preserved
```

## Startup Behavior

When LifeguardService starts:

1. **Wait for system initialization** (up to 30 seconds)
2. **Load existing pools** from database
3. **Clean up old pools** (>30 minutes → 'ignored')
4. **Start monitoring recent pools** (<15 minutes old)
5. **Skip expired pools** (15-30 minutes old)

## Console Output Examples

### Startup
```
📊 Pool cleanup complete: 3 pools started monitoring, 8 old pools cleaned up (out of 12 total)
🏊‍♂️ Started monitoring pool ABC123 | Priority: high | Interval: 1000ms | Remaining: 12m | Baseline: 0.123456 ratio, $15000.00 TVL
⏰ Skipping pool XYZ789 (age: 18m) - monitoring window expired
```

### During Monitoring
```
🔥 🟢 ABC123 | P/L: +2.45% | 🟢 TVL: +1.23% | Ratio: 0.123456 | $15000.00
⚡ 🔴 DEF456 | P/L: -1.67% | 🔴 TVL: -8.90% | Ratio: 0.098765 | $2500.00
```

### Monitoring Complete
```
⏰ Stopped monitoring pool ABC123 (15min monitoring window completed)
```

## Health Check Information

The health check now includes monitoring window information:

```typescript
const health = await lifeguard.getHealthStatus();
// Returns:
{
  status: 'healthy',
  stats: {
    totalPools: 3,
    monitoringWindows: [
      { poolId: 'ABC123', remainingMinutes: 8, priority: 'high' },
      { poolId: 'DEF456', remainingMinutes: 12, priority: 'medium' }
    ],
    // ... other stats
  },
  issues: []
}
```

## API Methods

### Get Monitoring Stats
```typescript
const stats = lifeguard.getMonitoringStats();
// Returns current monitoring statistics
```

### Get Health Status
```typescript
const health = await lifeguard.getHealthStatus();
// Returns health status with monitoring window info
```

### Manual Cleanup
```typescript
const result = await lifeguard.cleanupOldPools();
// Returns: { cleaned: 5, total: 12 }
```

### Get Pool Details
```typescript
const details = lifeguard.getPoolDetails('poolId');
// Returns specific pool monitoring details
```

## Database Status Flow

1. **'pending'** → Pool detected, ready for monitoring
2. **'analyzed'** → Monitoring completed, data collected
3. **'ignored'** → Pool too old, cleaned up
4. **'traded'** → Pool was traded (future use)

## Benefits

- **Efficient resource usage**: Only monitors pools for 15 minutes
- **Clean database**: Automatically removes old pools
- **Data preservation**: Keeps all snapshot data for analysis
- **Predictable behavior**: Clear monitoring windows
- **Scalable**: Can handle many pools without overwhelming the system

## Configuration

The monitoring duration can be adjusted by changing:
```typescript
private readonly MONITORING_DURATION = 15 * 60 * 1000; // 15 minutes
```

And cleanup threshold:
```typescript
const thirtyMinutes = 30 * 60 * 1000; // 30 minutes cleanup
``` 