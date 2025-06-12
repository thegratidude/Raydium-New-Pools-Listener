#!/usr/bin/env python3
import json
import os
from datetime import datetime

def view_analysis_history():
    """View historical analysis results"""
    results_file = '../exit_analysis_history.json'
    
    if not os.path.exists(results_file):
        print("❌ No analysis history found. Run analyze_exits.py first.")
        print("💡 Make sure you're running from the test folder and exit_analysis_history.json exists in ../")
        return
    
    with open(results_file, 'r') as f:
        history = json.load(f)
    
    print("📊 EXIT ANALYSIS HISTORY")
    print("=" * 80)
    print(f"📈 Total Analysis Runs: {len(history)}")
    print("=" * 80)
    
    for i, analysis in enumerate(history):
        print(f"\n🔍 ANALYSIS #{i+1} - {analysis['analysis_date']}")
        print("-" * 60)
        
        overall = analysis['overall_performance']
        print(f"💰 Total PnL: {overall.get('total_pnl', 0):+.4f} SOL")
        print(f"📊 Total Trades: {overall.get('total_trades', 0)}")
        print(f"📈 Avg PnL per Trade: {overall.get('avg_pnl_per_trade', 0):+.4f} SOL")
        print(f"✅ Success Rate: {overall.get('overall_success_rate', 0):.1f}%")
        print(f"🎯 Best Trade: {overall.get('best_single_trade', 0):+.4f} SOL")
        print(f"📉 Worst Trade: {overall.get('worst_single_trade', 0):+.4f} SOL")
        
        # Show exit type breakdown
        breakdown = analysis['exit_type_breakdown']
        print(f"🎯 Exit Types: {', '.join([f'{k}({v})' for k, v in breakdown.items()])}")
    
    # Show trends if multiple runs
    if len(history) > 1:
        print("\n" + "=" * 80)
        print("📈 PERFORMANCE TRENDS")
        print("=" * 80)
        
        pnls = [h['overall_performance'].get('total_pnl', 0) for h in history]
        trades = [h['overall_performance'].get('total_trades', 0) for h in history]
        dates = [h['analysis_date'] for h in history]
        
        print(f"📊 PnL Progression:")
        for i, (date, pnl) in enumerate(zip(dates, pnls)):
            if i > 0:
                change = pnl - pnls[i-1]
                change_str = f"({change:+.4f})" if change != 0 else "(no change)"
            else:
                change_str = "(baseline)"
            print(f"   {date}: {pnl:+.4f} SOL {change_str}")
        
        print(f"\n📈 Trade Count Progression:")
        for i, (date, trade_count) in enumerate(zip(dates, trades)):
            if i > 0:
                change = trade_count - trades[i-1]
                change_str = f"(+{change})" if change > 0 else f"({change})"
            else:
                change_str = "(baseline)"
            print(f"   {date}: {trade_count} trades {change_str}")
        
        # Calculate overall improvement
        first_pnl = pnls[0]
        last_pnl = pnls[-1]
        total_improvement = last_pnl - first_pnl
        
        print(f"\n🎯 OVERALL PERFORMANCE SUMMARY:")
        print(f"   📊 First Run: {first_pnl:+.4f} SOL")
        print(f"   📊 Latest Run: {last_pnl:+.4f} SOL")
        print(f"   📈 Total Improvement: {total_improvement:+.4f} SOL")
        
        if total_improvement > 0:
            print(f"   🚀 Performance: IMPROVING (+{total_improvement:.4f} SOL)")
        elif total_improvement < 0:
            print(f"   📉 Performance: DECLINING ({total_improvement:.4f} SOL)")
        else:
            print(f"   ➡️ Performance: STABLE")

def compare_exit_types():
    """Compare exit type performance across runs"""
    results_file = '../exit_analysis_history.json'
    
    if not os.path.exists(results_file):
        print("❌ No analysis history found.")
        print("💡 Make sure you're running from the test folder and exit_analysis_history.json exists in ../")
        return
    
    with open(results_file, 'r') as f:
        history = json.load(f)
    
    if len(history) < 2:
        print("❌ Need at least 2 analysis runs to compare.")
        return
    
    print("🎯 EXIT TYPE PERFORMANCE COMPARISON")
    print("=" * 80)
    
    # Get latest and previous runs
    latest = history[-1]
    previous = history[-2]
    
    print(f"📅 Comparing: {previous['analysis_date']} → {latest['analysis_date']}")
    print("=" * 80)
    
    latest_stats = latest['exit_type_stats']
    previous_stats = previous['exit_type_stats']
    
    # Compare each exit type
    for exit_type in set(latest_stats.keys()) | set(previous_stats.keys()):
        print(f"\n🎯 {exit_type}:")
        
        if exit_type in latest_stats and exit_type in previous_stats:
            latest_data = latest_stats[exit_type]
            previous_data = previous_stats[exit_type]
            
            count_change = latest_data['count'] - previous_data['count']
            pnl_change = latest_data['total_pnl'] - previous_data['total_pnl']
            avg_pnl_change = latest_data['avg_pnl'] - previous_data['avg_pnl']
            
            print(f"   📊 Count: {previous_data['count']} → {latest_data['count']} ({count_change:+d})")
            print(f"   💰 Total PnL: {previous_data['total_pnl']:+.4f} → {latest_data['total_pnl']:+.4f} ({pnl_change:+.4f})")
            print(f"   📈 Avg PnL: {previous_data['avg_pnl']:+.4f} → {latest_data['avg_pnl']:+.4f} ({avg_pnl_change:+.4f})")
            print(f"   ✅ Success Rate: {previous_data['success_rate']:.1f}% → {latest_data['success_rate']:.1f}%")
            
        elif exit_type in latest_stats:
            latest_data = latest_stats[exit_type]
            print(f"   🆕 NEW: {latest_data['count']} trades, {latest_data['total_pnl']:+.4f} SOL")
            
        else:
            previous_data = previous_stats[exit_type]
            print(f"   ❌ REMOVED: {previous_data['count']} trades, {previous_data['total_pnl']:+.4f} SOL")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "compare":
        compare_exit_types()
    else:
        view_analysis_history() 