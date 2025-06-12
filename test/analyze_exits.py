#!/usr/bin/env python3
import re
import json
import os
from datetime import datetime
from collections import defaultdict, Counter

def parse_log_file(log_file_path):
    """Parse the nestjs.log file to extract trading data"""
    trades = []
    current_trade = {}
    
    with open(log_file_path, 'r') as f:
        for line in f:
            # Look for position entries
            if "ENTERED EARLY POSITION" in line:
                if current_trade:
                    trades.append(current_trade)
                current_trade = {
                    'entry_time': None,
                    'entry_amount': None,
                    'entry_tokens': None,
                    'pool_id': None,
                    'exit_time': None,
                    'exit_amount': None,
                    'exit_tokens': None,
                    'exit_reason': None,
                    'pnl': None
                }
                
                # Extract pool ID
                pool_match = re.search(r'ENTERED EARLY POSITION: ([A-Za-z0-9]+)', line)
                if pool_match:
                    current_trade['pool_id'] = pool_match.group(1)
                
                # Extract timestamp
                time_match = re.search(r'\[([^\]]+)\]', line)
                if time_match:
                    current_trade['entry_time'] = time_match.group(1)
            
            # Look for entry trade details
            elif "Paper Trade" in line and "tokens purchased for" in line:
                match = re.search(r'(\d+\.?\d*) tokens purchased for (\d+\.?\d*) SOL', line)
                if match and current_trade:
                    current_trade['entry_tokens'] = float(match.group(1))
                    current_trade['entry_amount'] = float(match.group(2))
            
            # Look for exit reasons
            elif "FULL EXIT" in line:
                if current_trade:
                    # Extract exit reason
                    exit_match = re.search(r'FULL EXIT: [A-Za-z0-9]+ \| ([A-Z_]+)', line)
                    if exit_match:
                        current_trade['exit_reason'] = exit_match.group(1)
                    
                    # Extract timestamp
                    time_match = re.search(r'\[([^\]]+)\]', line)
                    if time_match:
                        current_trade['exit_time'] = time_match.group(1)
            
            # Look for exit trade details
            elif "Paper Trade" in line and "tokens sold for" in line:
                match = re.search(r'(\d+\.?\d*) tokens sold for (\d+\.?\d*) SOL', line)
                if match and current_trade:
                    current_trade['exit_tokens'] = float(match.group(1))
                    current_trade['exit_amount'] = float(match.group(2))
                    
                    # Calculate PnL
                    if current_trade['entry_amount'] and current_trade['exit_amount']:
                        current_trade['pnl'] = current_trade['exit_amount'] - current_trade['entry_amount']
                        current_trade['pnl_percent'] = (current_trade['pnl'] / current_trade['entry_amount']) * 100
                    
                    # Add to trades list
                    trades.append(current_trade)
                    current_trade = {}
    
    return trades

def analyze_exits(trades):
    """Analyze exit patterns and calculate statistics"""
    exit_stats = defaultdict(list)
    exit_counts = Counter()
    
    for trade in trades:
        if trade.get('exit_reason') and trade.get('pnl') is not None:
            exit_reason = trade['exit_reason']
            exit_stats[exit_reason].append(trade)
            exit_counts[exit_reason] += 1
    
    # Calculate statistics for each exit type
    results = {}
    total_trades = len([t for t in trades if t.get('exit_reason') and t.get('pnl') is not None])
    
    for exit_type, trade_list in exit_stats.items():
        pnls = [t['pnl'] for t in trade_list]
        pnl_percents = [t['pnl_percent'] for t in trade_list]
        
        profitable_trades = [p for p in pnls if p > 0]
        losing_trades = [p for p in pnls if p < 0]
        
        results[exit_type] = {
            'count': len(trade_list),
            'percentage': (len(trade_list) / total_trades) * 100,
            'avg_pnl': sum(pnls) / len(pnls),
            'avg_pnl_percent': sum(pnl_percents) / len(pnl_percents),
            'total_pnl': sum(pnls),
            'profitable_count': len(profitable_trades),
            'losing_count': len(losing_trades),
            'success_rate': (len(profitable_trades) / len(trade_list)) * 100 if trade_list else 0,
            'max_profit': max(pnls) if pnls else 0,
            'max_loss': min(pnls) if pnls else 0,
            'min_pnl': min(pnls) if pnls else 0,
            'max_pnl': max(pnls) if pnls else 0
        }
    
    return results, exit_counts, total_trades

def save_results_to_json(results, exit_counts, total_trades, trades):
    """Save analysis results to JSON file with timestamp"""
    timestamp = datetime.now().isoformat()
    
    # Calculate overall statistics
    all_pnls = []
    for trade in trades:
        if trade.get('pnl') is not None:
            all_pnls.append(trade['pnl'])
    
    overall_stats = {}
    if all_pnls:
        profitable_trades = [p for p in all_pnls if p > 0]
        losing_trades = [p for p in all_pnls if p < 0]
        
        overall_stats = {
            'total_pnl': sum(all_pnls),
            'avg_pnl_per_trade': sum(all_pnls) / len(all_pnls),
            'overall_success_rate': (len(profitable_trades) / len(all_pnls)) * 100,
            'best_single_trade': max(all_pnls),
            'worst_single_trade': min(all_pnls),
            'profitable_trades': len(profitable_trades),
            'losing_trades': len(losing_trades),
            'total_trades': len(all_pnls)
        }
    
    # Create the complete analysis result
    analysis_result = {
        'timestamp': timestamp,
        'analysis_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total_completed_trades': total_trades,
        'exit_types_found': len(results),
        'exit_type_breakdown': dict(exit_counts),
        'exit_type_stats': results,
        'overall_performance': overall_stats,
        'raw_trades_count': len(trades)
    }
    
    # Load existing results or create new file
    results_file = '../exit_analysis_history.json'
    existing_results = []
    
    if os.path.exists(results_file):
        try:
            with open(results_file, 'r') as f:
                existing_results = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            existing_results = []
    
    # Append new result
    existing_results.append(analysis_result)
    
    # Save back to file
    with open(results_file, 'w') as f:
        json.dump(existing_results, f, indent=2)
    
    print(f"💾 Results saved to {results_file}")
    print(f"📊 Total analysis runs: {len(existing_results)}")
    
    return analysis_result

def main():
    print("🔍 Analyzing Exit Patterns and PnL Performance...")
    print("=" * 80)
    
    # Parse the log file - adjust path for test folder
    log_file_path = '../logs/nestjs.log'
    if not os.path.exists(log_file_path):
        print(f"❌ Log file not found: {log_file_path}")
        print("💡 Make sure you're running from the test folder and logs exist in ../logs/")
        return
    
    trades = parse_log_file(log_file_path)
    
    print(f"📊 Raw trades found: {len(trades)}")
    
    # Analyze exits
    results, exit_counts, total_trades = analyze_exits(trades)
    
    print(f"📊 Total Completed Trades: {total_trades}")
    print(f"📈 Total Exit Types Found: {len(results)}")
    print("=" * 80)
    
    # Display results for each exit type
    for exit_type, stats in sorted(results.items(), key=lambda x: x[1]['count'], reverse=True):
        print(f"\n🎯 {exit_type} EXITS:")
        print(f"   📊 Count: {stats['count']} ({stats['percentage']:.1f}%)")
        print(f"   💰 Average PnL: {stats['avg_pnl']:+.4f} SOL ({stats['avg_pnl_percent']:+.2f}%)")
        print(f"   📈 Total PnL: {stats['total_pnl']:+.4f} SOL")
        print(f"   ✅ Success Rate: {stats['success_rate']:.1f}% ({stats['profitable_count']}/{stats['count']})")
        print(f"   📊 Profit Range: {stats['min_pnl']:+.4f} to {stats['max_pnl']:+.4f} SOL")
        print(f"   🎯 Best Trade: {stats['max_profit']:+.4f} SOL")
        print(f"   📉 Worst Trade: {stats['max_loss']:+.4f} SOL")
    
    # Summary statistics
    print("\n" + "=" * 80)
    print("📋 SUMMARY STATISTICS:")
    print("=" * 80)
    
    all_pnls = []
    for trade in trades:
        if trade.get('pnl') is not None:
            all_pnls.append(trade['pnl'])
    
    if all_pnls:
        profitable_trades = [p for p in all_pnls if p > 0]
        losing_trades = [p for p in all_pnls if p < 0]
        
        print(f"💰 Overall Performance:")
        print(f"   📊 Total PnL: {sum(all_pnls):+.4f} SOL")
        print(f"   📈 Average PnL per Trade: {sum(all_pnls)/len(all_pnls):+.4f} SOL")
        print(f"   ✅ Overall Success Rate: {(len(profitable_trades)/len(all_pnls)*100):.1f}%")
        print(f"   🎯 Best Single Trade: {max(all_pnls):+.4f} SOL")
        print(f"   📉 Worst Single Trade: {min(all_pnls):+.4f} SOL")
        print(f"   📊 Profit Distribution: {len(profitable_trades)} profitable, {len(losing_trades)} losing")
    
    # Exit type breakdown
    print(f"\n🎯 Exit Type Breakdown:")
    for exit_type, count in exit_counts.most_common():
        percentage = (count / total_trades) * 100
        print(f"   {exit_type}: {count} trades ({percentage:.1f}%)")
    
    # Save results to JSON
    print("\n" + "=" * 80)
    analysis_result = save_results_to_json(results, exit_counts, total_trades, trades)
    
    # Show comparison with previous runs if available
    results_file = '../exit_analysis_history.json'
    if os.path.exists(results_file):
        try:
            with open(results_file, 'r') as f:
                history = json.load(f)
            
            if len(history) > 1:
                print(f"\n📈 PERFORMANCE COMPARISON:")
                print("=" * 80)
                
                # Compare with previous run
                current = history[-1]
                previous = history[-2]
                
                current_pnl = current['overall_performance'].get('total_pnl', 0)
                previous_pnl = previous['overall_performance'].get('total_pnl', 0)
                pnl_change = current_pnl - previous_pnl
                
                current_trades = current['overall_performance'].get('total_trades', 0)
                previous_trades = previous['overall_performance'].get('total_trades', 0)
                trades_change = current_trades - previous_trades
                
                print(f"💰 PnL Change: {pnl_change:+.4f} SOL")
                print(f"📊 New Trades: +{trades_change}")
                print(f"📅 Previous Analysis: {previous['analysis_date']}")
                print(f"📅 Current Analysis: {current['analysis_date']}")
                
                if pnl_change > 0:
                    print(f"📈 Performance: IMPROVING (+{pnl_change:.4f} SOL)")
                elif pnl_change < 0:
                    print(f"📉 Performance: DECLINING ({pnl_change:.4f} SOL)")
                else:
                    print(f"➡️ Performance: STABLE")
                    
        except Exception as e:
            print(f"⚠️ Could not load comparison data: {e}")

if __name__ == "__main__":
    main() 