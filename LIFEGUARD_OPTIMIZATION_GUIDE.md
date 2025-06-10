# Lifeguard Service Optimization Guide

## Overview

The LifeguardService has been enhanced with advanced rate limiting, priority-based monitoring, and intelligent optimization features to handle multiple pools efficiently while respecting RPC rate limits.

## Key Optimizations

### 🚀 Priority-Based Monitoring

Pools are automatically categorized by priority based on TVL:

- **🔥 High Priority** (TVL > $10,000): Updates every 1-2 seconds
- **⚡ Medium Priority** (TVL > $1,000): Updates every 2 seconds  
- **💤 Low Priority** (TVL < $1,000): Updates every 4 seconds

### 📊 Rate Limiting System

- **Max Requests/Second**: 10 requests (conservative for RPC limits)
- **Max Concurrent Requests**: 5 simultaneous requests
- **Batch Processing**: 3 pools processed per batch
- **Exponential Backoff**: Automatic retry with increasing delays

### 🔄 Dynamic Update Intervals

Update frequency automatically adjusts based on pool activity:

- **High Activity** (>5% P/L change or >10% TVL change): More frequent updates
- **Low Activity** (<1% P/L change and <2% TVL change): Less frequent updates
- **Error Handling**: Exponential backoff for failed requests

### 📈 Monitoring Features

#### Health Checks
```typescript
const health = await lifeguard.getHealthStatus();
// Returns: { status, stats, issues }
```

#### Statistics
```typescript
const stats = lifeguard.getMonitoringStats();
// Returns: priority breakdown, queue stats, rate limit info
```

#### Pool Details
```typescript
const details = lifeguard.getPoolDetails(poolId);
// Returns: priority, update interval, error count, etc.
```

### 🛠️ Optimization Methods

#### Auto-Optimization
```typescript
const optimizations = lifeguard.optimizeMonitoring();
// Automatically adjusts priorities and removes problematic pools
```

#### Emergency Stop
```typescript
lifeguard.emergencyStop();
// Immediately stops all monitoring and clears queues
```

#### Resume Monitoring
```typescript
await lifeguard.resumeMonitoring();
// Reloads pools from database and resumes monitoring
```

## Console Output Format

```
🔥 🟢 DmFrELj9i | P/L: +2.45% | 🟢 TVL: +1.23% | Ratio: 0.123456 | $15000.00
⚡ 🔴 HPD7Ux2p5 | P/L: -1.67% | 🔴 TVL: -8.90% | Ratio: 0.098765 | $2500.00
💤 🟢 6UfWWBn3Y | P/L: +0.12% | 🟢 TVL: +0.45% | Ratio: 0.111111 | $500.00
```

**Legend:**
- 🔥⚡💤 = Priority level (High/Medium/Low)
- 🟢🔴 = Profit/Loss indicator
- 🟢🔴 = TVL change indicator

## Configuration

### Rate Limit Settings
```typescript
private readonly rateLimitConfig: RateLimitConfig = {
  maxRequestsPerSecond: 10,    // Adjust based on RPC provider
  maxConcurrentRequests: 5,    // Concurrent request limit
  batchSize: 3,                // Pools per batch
  backoffMultiplier: 1.5,      // Exponential backoff factor
  maxBackoffMs: 30000          // Maximum backoff time
};
```

### Priority Thresholds
```typescript
private determinePriority(tvl: number): 'high' | 'medium' | 'low' {
  if (tvl > 10000) return 'high';   // $10,000+ TVL
  if (tvl > 1000) return 'medium';  // $1,000+ TVL
  return 'low';                     // < $1,000 TVL
}
```

## Performance Benefits

### Before Optimization
- Fixed 1-second intervals for all pools
- No rate limiting
- Potential RPC overload
- No priority system

### After Optimization
- **50-75% reduction** in RPC requests for low-priority pools
- **Intelligent rate limiting** prevents RPC overload
- **Priority-based monitoring** focuses on high-value pools
- **Automatic error recovery** with exponential backoff
- **Dynamic scaling** based on pool activity

## Testing

Run the optimized test:
```bash
npx ts-node test_lifeguard_optimized.ts
```

This will:
- Monitor pools with priority indicators
- Show health checks every 30 seconds
- Auto-optimize when issues are detected
- Provide emergency stop capability

## Monitoring Best Practices

1. **Start Small**: Begin with 3-5 pools to test the system
2. **Monitor Health**: Check `getHealthStatus()` regularly
3. **Adjust Rate Limits**: Modify based on your RPC provider's limits
4. **Use Emergency Stop**: If you see too many errors, stop and restart
5. **Review Statistics**: Use `getMonitoringStats()` to understand performance

## Troubleshooting

### High Queue Length
- Increase `maxRequestsPerSecond` if your RPC provider allows
- Reduce `batchSize` to process fewer pools at once
- Check for pools with many consecutive errors

### Stale Pools
- Pools not updating for >30 seconds indicate issues
- Check RPC connection and rate limits
- Consider emergency stop and resume

### Memory Usage
- Monitor the number of active pools
- Use `emergencyStop()` to clear all monitoring
- Restart the service if memory usage is high

## Future Enhancements

- **WebSocket Support**: Real-time updates instead of polling
- **Machine Learning**: Predict optimal update intervals
- **Pool Clustering**: Group similar pools for batch processing
- **Advanced Metrics**: More sophisticated TVL and P/L calculations
- **Alert System**: Notifications for significant changes 