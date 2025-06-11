# 🚀 Trading & Position Management System

## 📊 **Overview**

The Trading & Position Management System is a comprehensive automated trading solution for Raydium pools. It provides:

- **Automated Pool Analysis** - Real-time analysis of new Status 6 pools
- **Risk Management** - Multi-layered risk controls and position sizing
- **Position Tracking** - Complete lifecycle management of trading positions
- **Performance Monitoring** - Real-time PnL tracking and performance metrics
- **Configurable Strategies** - Multiple trading strategies with customizable parameters

## 🏗️ **Architecture**

### **Core Components:**

1. **TradingService** - Main trading engine with automated execution
2. **PositionManagerService** - Database management for pools and positions
3. **TradingController** - HTTP API for trading operations
4. **Risk Management** - Multi-layered risk controls
5. **Strategy Engine** - Configurable trading strategies

### **Data Flow:**

```
New Pool Detected → Pool Analysis → Risk Assessment → Strategy Evaluation → Position Entry → Monitoring → Exit Conditions → Position Closure
```

## ⚙️ **Configuration**

### **Environment Variables:**

```bash
# Trading Configuration
TRADING_ENABLED=true
MAX_POSITIONS=5
POSITION_SIZE=0.05
MAX_SLIPPAGE=5
STOP_LOSS=10
TAKE_PROFIT=20
MAX_DAILY_LOSS=0.5
MIN_LIQUIDITY=1.0
MAX_PRICE_IMPACT=3
```

### **Configuration File:**

The system uses `trading.config.json` for detailed configuration:

```json
{
  "trading": {
    "enabled": true,
    "mode": "paper",
    "maxPositions": 5,
    "positionSize": 0.05
  }
}
```

## 🎯 **Trading Strategies**

### **1. Momentum Strategy**
- **Weight**: 40%
- **Parameters**:
  - Lookback Period: 5 minutes
  - Momentum Threshold: 5% price increase
  - Volume Threshold: 0.1 SOL minimum

### **2. Liquidity Strategy**
- **Weight**: 30%
- **Parameters**:
  - Minimum Liquidity: 2.0 SOL
  - Liquidity Growth: 10%
  - Depth Threshold: 0.5

### **3. Volatility Strategy**
- **Weight**: 30%
- **Parameters**:
  - Max Volatility: 80%
  - Min Volatility: 10%
  - Volatility Window: 10 minutes

## 🛡️ **Risk Management**

### **Position-Level Risk:**
- **Stop Loss**: 10% maximum loss per position
- **Take Profit**: 20% target profit
- **Position Size**: 0.05 SOL per position
- **Max Slippage**: 5% maximum slippage

### **Portfolio-Level Risk:**
- **Max Positions**: 5 concurrent positions
- **Daily Loss Limit**: 0.5 SOL maximum daily loss
- **Correlation Limit**: 70% maximum correlation between positions
- **VaR Limit**: 5% Value at Risk limit

### **Market Risk:**
- **Liquidity Threshold**: 1.0 SOL minimum liquidity
- **Price Impact**: 3% maximum price impact
- **Volatility Threshold**: 50% maximum acceptable volatility

## 📈 **Position Lifecycle**

### **1. Pool Detection**
```typescript
// New Status 6 pool detected
eventEmitter.emit('pool_stored', {
  pool_id: 'pool_address',
  timestamp: Date.now()
});
```

### **2. Pool Analysis**
```typescript
const analysis = await tradingService.analyzePool(pool);
// Returns: { shouldTrade: boolean, riskScore: number, opportunityScore: number }
```

### **3. Position Entry**
```typescript
// Automatic buy execution
await tradingService.executeBuy(poolId, price);
```

### **4. Position Monitoring**
```typescript
// Continuous monitoring for exit conditions
tradingService.checkExitConditions(poolId, currentPrice);
```

### **5. Position Exit**
```typescript
// Automatic sell execution
await tradingService.executeSell(poolId, price, 'take_profit');
```

## 🔌 **API Endpoints**

### **Trading Status**
```http
GET /trading/status
```
Returns comprehensive trading status including health, configuration, stats, and positions.

### **Positions**
```http
GET /trading/positions
GET /trading/positions?status=open
GET /trading/positions/:poolId
```
Manage and query trading positions.

### **Statistics**
```http
GET /trading/stats
```
Returns daily statistics, performance metrics, and position summaries.

### **Configuration**
```http
GET /trading/config
PUT /trading/config
```
Get and update trading configuration.

### **Position Management**
```http
POST /trading/positions/:poolId/close
```
Manually close a position.

### **Health Check**
```http
GET /trading/health
```
Returns trading service health status.

## 📊 **Performance Metrics**

### **Daily Statistics:**
- Total Trades
- Successful Trades
- Failed Trades
- Total PnL
- Daily Loss
- Win Rate

### **Position Metrics:**
- Active Positions Count
- Average PnL
- Position Duration
- Risk Scores

### **Risk Metrics:**
- Maximum Drawdown
- Sharpe Ratio
- Sortino Ratio
- Value at Risk (VaR)

## 🔄 **Event System**

### **Trading Events:**
```typescript
// Position opened
eventEmitter.emit('position_opened', {
  position_id: 'pos_id',
  pool_id: 'pool_address',
  entry_price: 0.001,
  amount: 0.05,
  timestamp: Date.now()
});

// Position closed
eventEmitter.emit('position_closed', {
  position_id: 'pos_id',
  pool_id: 'pool_address',
  exit_price: 0.0012,
  pnl: 0.01,
  pnl_percentage: 20,
  reason: 'take_profit',
  timestamp: Date.now()
});
```

### **Analysis Events:**
```typescript
// Pool analysis complete
eventEmitter.emit('pool_analysis_complete', {
  pool_id: 'pool_address',
  analysis: {
    shouldTrade: true,
    riskScore: 0.3,
    opportunityScore: 0.7
  },
  timestamp: Date.now()
});
```

## 🧪 **Paper Trading**

The system includes a comprehensive paper trading mode for testing:

### **Features:**
- 90% success rate simulation
- Realistic slippage modeling
- Transaction delay simulation
- PnL calculation
- Risk management enforcement

### **Configuration:**
```json
{
  "execution": {
    "paperTrading": {
      "enabled": true,
      "successRate": 0.9,
      "delay": 1000
    }
  }
}
```

## 🔍 **Monitoring & Alerts**

### **Position Monitoring:**
- 30-second monitoring interval
- Real-time PnL tracking
- Exit condition checking
- Risk score updates

### **Risk Monitoring:**
- 1-minute risk assessment
- Portfolio-level risk tracking
- Drawdown monitoring
- VaR calculations

### **Performance Monitoring:**
- 5-minute performance metrics
- Sharpe ratio calculation
- Sortino ratio calculation
- Maximum drawdown tracking

### **Alert Channels:**
- Console logging
- WebSocket broadcasts
- File logging
- Custom webhook support

## 🚀 **Getting Started**

### **1. Enable Trading:**
```bash
export TRADING_ENABLED=true
export POSITION_SIZE=0.05
export MAX_POSITIONS=5
```

### **2. Start the Application:**
```bash
npm run start
```

### **3. Monitor Trading Status:**
```bash
curl http://localhost:5001/trading/status
```

### **4. View Active Positions:**
```bash
curl http://localhost:5001/trading/positions
```

### **5. Check Performance:**
```bash
curl http://localhost:5001/trading/stats
```

## 🔧 **Advanced Configuration**

### **Strategy Weights:**
```json
{
  "strategies": {
    "momentum": { "weight": 0.4 },
    "liquidity": { "weight": 0.3 },
    "volatility": { "weight": 0.3 }
  }
}
```

### **Risk Parameters:**
```json
{
  "riskManagement": {
    "maxRiskPerTrade": 0.02,
    "maxPortfolioRisk": 0.1,
    "correlationLimit": 0.7
  }
}
```

### **Execution Settings:**
```json
{
  "execution": {
    "slippage": {
      "default": 5,
      "aggressive": 10,
      "conservative": 2
    }
  }
}
```

## 📝 **Best Practices**

### **Risk Management:**
1. Start with paper trading
2. Use conservative position sizes
3. Set appropriate stop losses
4. Monitor daily loss limits
5. Diversify across multiple pools

### **Configuration:**
1. Test strategies thoroughly
2. Monitor performance metrics
3. Adjust parameters based on results
4. Keep position sizes small initially
5. Use proper risk management

### **Monitoring:**
1. Check trading status regularly
2. Monitor active positions
3. Review daily statistics
4. Watch for unusual activity
5. Maintain proper logging

## 🚨 **Troubleshooting**

### **Common Issues:**

1. **No Positions Opening:**
   - Check if trading is enabled
   - Verify position limits
   - Review risk parameters
   - Check daily loss limits

2. **High Failure Rate:**
   - Reduce position size
   - Increase slippage tolerance
   - Check liquidity requirements
   - Review risk scores

3. **Poor Performance:**
   - Adjust strategy weights
   - Review stop loss/take profit levels
   - Check market conditions
   - Analyze historical data

### **Debug Commands:**
```bash
# Check trading status
curl http://localhost:5001/trading/status

# View configuration
curl http://localhost:5001/trading/config

# Get health status
curl http://localhost:5001/trading/health

# View logs
tail -f logs/nestjs.log
```

## 🔮 **Future Enhancements**

### **Planned Features:**
1. **Live Trading Integration** - Connect to actual Raydium swaps
2. **Advanced Strategies** - Machine learning-based strategies
3. **Backtesting Engine** - Historical strategy testing
4. **Portfolio Optimization** - Advanced portfolio management
5. **Real-time Analytics** - Advanced performance analytics
6. **Mobile Dashboard** - Mobile-friendly trading interface

### **Integration Points:**
1. **Raydium SDK** - Direct pool interaction
2. **Price Feeds** - Real-time price data
3. **Risk Models** - Advanced risk modeling
4. **Analytics Platform** - Performance analytics
5. **Alert System** - Advanced notification system

This comprehensive trading and position management system provides a robust foundation for automated trading on Raydium pools with advanced risk management and performance monitoring capabilities. 