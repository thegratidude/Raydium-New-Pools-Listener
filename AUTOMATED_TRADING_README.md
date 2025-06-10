# 🤖 Automated Trading System

## Overview

This automated trading system listens for Raydium pool events and automatically executes trades when new pools become available for trading (status 6). It's designed to work with your existing lean monitoring architecture.

## 🎯 How It Works

### Flow:
1. **UnifiedPoolMonitorService** detects status 6 pools
2. **Broadcasts** pool ready events to port 5001
3. **Automated Trading Listener** receives events
4. **Executes trades** using your swap script
5. **Logs results** and maintains rate limits

### Architecture:
```
Status 6 Detection → WebSocket Broadcast → Trading Listener → Trade Execution
```

## 🚀 Quick Start

### 1. Configure Trading Parameters

Copy the trading configuration to your `.env` file:

```bash
# Add these to your .env file
AUTO_TRADING_ENABLED=true
TRADE_SOL_AMOUNT=0.05
TRADE_SLIPPAGE=5
MAX_TRADES_PER_HOUR=10
```

### 2. Start the Automated Trading Listener

```bash
# In a new terminal (keep your monitoring system running)
python automated_trading_listener.py
```

### 3. Monitor the System

The listener will:
- Connect to your monitoring system on port 5001
- Listen for `pool_ready` events
- Automatically execute trades when pools become available
- Log all activities to `logs/automated_trading.log`
- Log trades to `logs/trades_executed.log`

## 📊 Configuration Options

### Environment Variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_TRADING_ENABLED` | `true` | Enable/disable automated trading |
| `TRADE_SOL_AMOUNT` | `0.05` | SOL amount per trade |
| `TRADE_SLIPPAGE` | `5` | Slippage percentage |
| `MAX_TRADES_PER_HOUR` | `10` | Rate limiting |

### Safety Features:

- **Rate Limiting**: Maximum trades per hour
- **Pool Cooldown**: 5-minute cooldown per pool
- **Timeout Protection**: 60-second trade execution timeout
- **Error Handling**: Comprehensive error logging
- **Graceful Shutdown**: Clean disconnection on Ctrl+C

## 🧪 Testing

### Test the System:

```bash
# Test with simulated pool event
python test_automated_trading.py
```

### Monitor Logs:

```bash
# Watch trading logs
tail -f logs/automated_trading.log

# Watch trade executions
tail -f logs/trades_executed.log
```

## 📈 Monitoring Dashboard

The system provides real-time monitoring:

```
🏥 HEALTH CHECK - 14:30:22
   ⏱️  Server uptime: 2h 15m
   💓 Health messages received: 45
   🆕 New pools detected: 3
   💰 Trades executed: 2
   ⏱️  Hourly trades: 2/10
```

## 🔧 Integration with Existing System

### Current Setup:
- **Main Monitoring**: `UnifiedPoolMonitorService` (running)
- **WebSocket Server**: Port 5001 (active)
- **Event Broadcasting**: Status 1 → Status 6 → Pool Ready

### New Addition:
- **Automated Trading**: `automated_trading_listener.py`
- **Trade Execution**: `swap/swap_buy_ammv4.py`
- **Logging**: Separate trade logs

## 🛡️ Safety Features

### Risk Management:
1. **Small Trade Size**: 0.05 SOL per trade (configurable)
2. **Rate Limiting**: Maximum 10 trades per hour
3. **Pool Cooldown**: 5-minute cooldown per pool
4. **Slippage Protection**: 5% slippage tolerance
5. **Timeout Protection**: 60-second execution timeout

### Monitoring:
1. **Real-time Logs**: All activities logged
2. **Trade History**: Complete trade record
3. **Health Checks**: System status monitoring
4. **Error Handling**: Comprehensive error logging

## 📝 Log Files

### `logs/automated_trading.log`
- All WebSocket events
- Connection status
- System health checks

### `logs/trades_executed.log`
- Trade execution details
- Success/failure status
- Trade parameters and results

## 🎬 "Swing away, Merrill!" - Ready to Trade!

Your automated trading system is now ready to:
- ✅ **Listen** for new pool opportunities
- ✅ **Execute** trades automatically
- ✅ **Protect** against excessive trading
- ✅ **Log** all activities for review
- ✅ **Scale** with your trading strategy

## 🚨 Important Notes

1. **Keep your monitoring system running** - The trading listener depends on it
2. **Test with small amounts first** - Start with 0.05 SOL trades
3. **Monitor the logs** - Watch for any errors or issues
4. **Set appropriate limits** - Adjust rate limits based on your strategy
5. **Have sufficient SOL** - Ensure your wallet has enough SOL for trades

## 🔄 Next Steps

1. **Start the trading listener** in a separate terminal
2. **Monitor the logs** for activity
3. **Adjust parameters** based on your strategy
4. **Scale up gradually** as you gain confidence

---

**Ready to automate your Raydium trading! 🚀** 