# 📊 Exit Analysis Tools

This directory contains tools to analyze and track the performance of different exit types in your Raydium trading system.

## 🛠️ Tools

### 1. `analyze_exits.py`
**Main analysis script that processes logs and generates performance metrics.**

**Usage:**
```bash
# From the test folder
cd test
python analyze_exits.py
```

**What it does:**
- Parses `../logs/nestjs.log` for trading data
- Extracts entry/exit information and calculates PnL
- Categorizes exits by type (TAKE_PROFIT, STOP_LOSS, RUG_DETECTION, etc.)
- Calculates detailed statistics for each exit type
- Saves results to `../exit_analysis_history.json` with timestamp
- Shows comparison with previous runs

**Output includes:**
- Exit type breakdown and success rates
- Average PnL per exit type
- Overall performance metrics
- Performance trends over time

### 2. `view_analysis_history.py`
**Tool to view and compare historical analysis results.**

**Usage:**
```bash
# From the test folder
cd test

# View all historical runs
python view_analysis_history.py

# Compare exit types between runs
python view_analysis_history.py compare
```

**What it does:**
- Displays all historical analysis runs
- Shows performance trends over time
- Compares exit type performance between runs
- Calculates overall improvement metrics

## 📈 Key Metrics Tracked

### Exit Types Analyzed:
- **TAKE_PROFIT**: Successful profit-taking exits
- **STOP_LOSS**: Loss-limiting exits
- **TRAILING_STOP_LOSS**: Dynamic stop-loss exits
- **RUG_DETECTION**: Emergency exits from rug pulls
- **TIMEOUT**: Time-based exits

### Performance Metrics:
- **Count**: Number of trades per exit type
- **Success Rate**: Percentage of profitable trades
- **Average PnL**: Mean profit/loss per trade
- **Total PnL**: Cumulative profit/loss
- **Best/Worst Trade**: Individual trade extremes

## 📁 Files Generated

### `../exit_analysis_history.json`
Contains all historical analysis results with timestamps. Structure:
```json
[
  {
    "timestamp": "2025-06-12T05:59:40.880360",
    "analysis_date": "2025-06-12 05:59:40",
    "total_completed_trades": 98,
    "exit_types_found": 5,
    "exit_type_breakdown": {...},
    "exit_type_stats": {...},
    "overall_performance": {...}
  }
]
```

## 🎯 How to Use

1. **Navigate to test folder:**
   ```bash
   cd test
   ```

2. **Run analysis after trading sessions:**
   ```bash
   python analyze_exits.py
   ```

3. **Check historical performance:**
   ```bash
   python view_analysis_history.py
   ```

4. **Compare performance changes:**
   ```bash
   python view_analysis_history.py compare
   ```

## 📊 Example Output

```
🎯 TAKE_PROFIT EXITS:
   📊 Count: 65 (66.3%)
   💰 Average PnL: +0.1721 SOL (+30.46%)
   📈 Total PnL: +11.1856 SOL
   ✅ Success Rate: 87.7% (57/65)
```

## 🔍 Insights from Analysis

Based on current data:
- **TAKE_PROFIT** exits are the most profitable (66% of trades)
- **RUG_DETECTION** has 100% success rate (excellent risk management)
- **TRAILING_STOP_LOSS** needs optimization (0% success rate)
- Overall system success rate: 74.5%

## 💡 Optimization Opportunities

1. **Review TRAILING_STOP_LOSS logic** - currently losing money
2. **Analyze STOP_LOSS entries** - could improve entry filtering
3. **Monitor TIMEOUT exits** - mostly profitable but could be optimized

## 🚀 Future Enhancements

- Add time-based analysis (hourly/daily performance)
- Include market condition correlation
- Add risk-adjusted return metrics
- Create performance alerts for significant changes

## 📂 File Structure

```
Raydium-New-Pools-Listener/
├── test/
│   ├── analyze_exits.py              # Main analysis script
│   ├── view_analysis_history.py      # History viewer
│   └── EXIT_ANALYSIS_README.md       # This file
├── logs/
│   └── nestjs.log                    # Trading logs (read by scripts)
└── exit_analysis_history.json        # Analysis results (generated)
``` 