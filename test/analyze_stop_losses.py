#!/usr/bin/env python3
import re
import json

def parse_log_file(log_file_path):
    trades = []
    current_trade = {}
    
    with open(log_file_path, 'r') as f:
        for line in f:
            if 'ENTERED EARLY POSITION' in line:
                if current_trade:
                    trades.append(current_trade)
                current_trade = {
                    'entry_amount': None,
                    'exit_reason': None,
                    'pnl': None
                }
                
                pool_match = re.search(r'ENTERED EARLY POSITION: ([A-Za-z0-9]+)', line)
                if pool_match:
                    current_trade['pool_id'] = pool_match.group(1)
            
            elif 'Paper Trade' in line and 'tokens purchased for' in line:
                match = re.search(r'(\d+\.?\d*) tokens purchased for (\d+\.?\d*) SOL', line)
                if match and current_trade:
                    current_trade['entry_amount'] = float(match.group(2))
            
            elif 'FULL EXIT' in line:
                if current_trade:
                    exit_match = re.search(r'FULL EXIT: [A-Za-z0-9]+ \| ([A-Z_]+)', line)
                    if exit_match:
                        current_trade['exit_reason'] = exit_match.group(1)
            
            elif 'Paper Trade' in line and 'tokens sold for' in line:
                match = re.search(r'(\d+\.?\d*) tokens sold for (\d+\.?\d*) SOL', line)
                if match and current_trade:
                    current_trade['exit_amount'] = float(match.group(2))
                    
                    if current_trade['entry_amount'] and current_trade['exit_amount']:
                        current_trade['pnl'] = current_trade['exit_amount'] - current_trade['entry_amount']
                    
                    trades.append(current_trade)
                    current_trade = {}
    
    return trades

def main():
    print("🛑 STOP LOSS WORST CASE ANALYSIS")
    print("=" * 60)
    
    trades = parse_log_file('../logs/nestjs.log')
    
    # Filter stop loss trades
    stop_loss_trades = [t for t in trades if t.get('exit_reason') in ['STOP_LOSS', 'TRAILING_STOP_LOSS'] and t.get('entry_amount')]
    
    total_stop_trades = len(stop_loss_trades)
    total_entry_amount = sum(t['entry_amount'] for t in stop_loss_trades)
    total_pnl = sum(t['pnl'] for t in stop_loss_trades if t.get('pnl') is not None)
    
    print(f'📊 Total Stop Loss Trades: {total_stop_trades}')
    print(f'💰 Total Entry Amount: {total_entry_amount:.4f} SOL')
    print(f'📉 Total PnL: {total_pnl:.4f} SOL')
    print()
    
    print('📋 INDIVIDUAL STOP LOSS TRADES:')
    print('-' * 60)
    
    for i, trade in enumerate(stop_loss_trades, 1):
        entry = trade.get('entry_amount', 0)
        pnl = trade.get('pnl', 0)
        exit_reason = trade.get('exit_reason', 'UNKNOWN')
        pool_id = trade.get('pool_id', 'N/A')[:8]
        print(f'  {i:2d}. {exit_reason:20s} | Pool: {pool_id}... | Entry: {entry:.1f} SOL | PnL: {pnl:+.4f} SOL')
    
    print()
    print('📊 POSITION SIZE BREAKDOWN:')
    print('-' * 60)
    
    # Count position sizes
    position_sizes = {}
    for trade in stop_loss_trades:
        size = trade['entry_amount']
        position_sizes[size] = position_sizes.get(size, 0) + 1
    
    for size, count in sorted(position_sizes.items()):
        print(f'  {size:.1f} SOL positions: {count} trades')
    
    print()
    print('💀 WORST CASE SCENARIO (100% losses):')
    print('=' * 60)
    print(f'   💸 Total Entry Amount: {total_entry_amount:.4f} SOL')
    print(f'   📉 Worst Case Losses: -{total_entry_amount:.4f} SOL')
    print(f'   📈 Additional Losses: {-(total_entry_amount + total_pnl):.4f} SOL')
    
    # Calculate new total PnL
    current_total_pnl = 10.3511  # from analysis
    new_total_pnl = current_total_pnl - (total_entry_amount + total_pnl)
    
    print()
    print('🎯 RESULT:')
    print('=' * 60)
    print(f'   💰 Current Total PnL: {current_total_pnl:.4f} SOL')
    print(f'   💀 New Total PnL: {new_total_pnl:.4f} SOL')
    print(f'   📊 Still Profitable: {"YES ✅" if new_total_pnl > 0 else "NO ❌"}')
    print(f'   📈 Profit/Loss Margin: {new_total_pnl:.4f} SOL')

if __name__ == "__main__":
    main() 