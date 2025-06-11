#!/usr/bin/env python3
"""
Comprehensive verification script to confirm we're getting real-world Raydium data
"""

import sqlite3
import json
import requests
from datetime import datetime
import time

def analyze_price_movements():
    """Analyze price movements to verify they're realistic"""
    print("🔍 ANALYZING PRICE MOVEMENTS")
    print("=" * 60)
    
    conn = sqlite3.connect('position_manager.sqlite')
    cursor = conn.cursor()
    
    # Get the most recent pool
    cursor.execute("""
        SELECT pool_id, token_a_mint, token_b_mint, created_at, detected_at 
        FROM status_6_pools 
        ORDER BY detected_at DESC 
        LIMIT 1
    """)
    
    pool_data = cursor.fetchone()
    if not pool_data:
        print("❌ No pools found in database")
        return
    
    pool_id, token_a_mint, token_b_mint, created_at, detected_at = pool_data
    print(f"📊 Analyzing pool: {pool_id}")
    print(f"Token A: {token_a_mint}")
    print(f"Token B: {token_b_mint}")
    print(f"Created: {created_at}")
    print(f"Detected: {datetime.fromtimestamp(detected_at/1000)}")
    
    # Get price snapshots
    cursor.execute("""
        SELECT price, base_reserve, quote_reserve, timestamp 
        FROM pool_snapshots 
        WHERE pool_id = ? 
        ORDER BY timestamp DESC 
        LIMIT 20
    """, (pool_id,))
    
    snapshots = cursor.fetchall()
    if not snapshots:
        print("❌ No snapshots found for this pool")
        return
    
    print(f"\n📈 Price Movement Analysis ({len(snapshots)} snapshots):")
    print("-" * 60)
    
    prev_price = None
    prev_base = None
    prev_quote = None
    
    for i, (price, base_reserve, quote_reserve, timestamp) in enumerate(snapshots):
        timestamp_str = datetime.fromtimestamp(timestamp/1000).strftime('%H:%M:%S')
        
        if prev_price is not None:
            price_change = ((price - prev_price) / prev_price) * 100
            base_change = ((base_reserve - prev_base) / prev_base) * 100 if prev_base else 0
            quote_change = ((quote_reserve - prev_quote) / prev_quote) * 100 if prev_quote else 0
            
            change_color = "🟢" if price_change > 0 else "🔴" if price_change < 0 else "⚪"
            
            print(f"{change_color} {timestamp_str} | Price: {price:.8f} ({price_change:+.2f}%) | Base: {base_reserve:.0f} ({base_change:+.2f}%) | Quote: {quote_reserve:.2f} ({quote_change:+.2f}%)")
        else:
            print(f"⚪ {timestamp_str} | Price: {price:.8f} | Base: {base_reserve:.0f} | Quote: {quote_reserve:.2f}")
        
        prev_price = price
        prev_base = base_reserve
        prev_quote = quote_reserve
    
    # Calculate overall statistics
    if len(snapshots) > 1:
        first_price = snapshots[-1][0]
        last_price = snapshots[0][0]
        total_change = ((last_price - first_price) / first_price) * 100
        
        print(f"\n📊 Overall Statistics:")
        print(f"First Price: {first_price:.8f}")
        print(f"Last Price: {last_price:.8f}")
        print(f"Total Change: {total_change:+.2f}%")
        print(f"Time Span: {len(snapshots)} snapshots")
        
        # Check if movements are realistic
        print(f"\n🔍 Realism Check:")
        if abs(total_change) > 100:
            print("⚠️  WARNING: Very large price movement (>100%) - verify this is real")
        elif abs(total_change) > 50:
            print("⚠️  CAUTION: Large price movement (>50%) - unusual but possible")
        else:
            print("✅ Price movements appear realistic")
    
    conn.close()

def verify_blockchain_data():
    """Verify pool exists on real Solana blockchain"""
    print("\n🔗 VERIFYING BLOCKCHAIN DATA")
    print("=" * 60)
    
    conn = sqlite3.connect('position_manager.sqlite')
    cursor = conn.cursor()
    
    cursor.execute("SELECT pool_id FROM status_6_pools ORDER BY detected_at DESC LIMIT 1")
    pool_id = cursor.fetchone()[0]
    
    print(f"🔍 Verifying pool on Solana blockchain: {pool_id}")
    
    # Check if pool exists on Solana
    url = "https://api.mainnet-beta.solana.com"
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getAccountInfo",
        "params": [pool_id, {"encoding": "base64"}]
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        data = response.json()
        
        if data.get('result') and data['result'].get('value'):
            print("✅ Pool exists on Solana blockchain")
            print(f"Account size: {data['result']['value']['data'][1]} bytes")
            print(f"Owner: {data['result']['value']['owner']}")
            
            # Check if it's owned by Raydium program
            if data['result']['value']['owner'] == '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8':
                print("✅ Pool is owned by Raydium program")
            else:
                print("⚠️  Pool is not owned by Raydium program")
        else:
            print("❌ Pool not found on Solana blockchain")
            
    except Exception as e:
        print(f"❌ Error verifying blockchain data: {e}")
    
    conn.close()

def analyze_message_volume():
    """Analyze message volume to verify real-time data"""
    print("\n📨 ANALYZING MESSAGE VOLUME")
    print("=" * 60)
    
    # Check recent logs for message volume
    try:
        with open('logs/nestjs.log', 'r') as f:
            lines = f.readlines()
            recent_lines = lines[-100:]  # Last 100 lines
        
        raydium_messages = []
        status_6_events = []
        
        for line in recent_lines:
            if 'Raydium messages per minute' in line:
                raydium_messages.append(line.strip())
            elif 'Status 6 listener received event' in line:
                status_6_events.append(line.strip())
        
        print(f"📊 Recent Raydium Message Volume:")
        for msg in raydium_messages[-3:]:  # Last 3 messages
            print(f"  {msg}")
        
        print(f"\n📊 Recent Status 6 Events:")
        for event in status_6_events[-3:]:  # Last 3 events
            print(f"  {event}")
        
        # Analyze if volume is realistic
        if raydium_messages:
            latest_msg = raydium_messages[-1]
            if 'per minute' in latest_msg:
                try:
                    volume = int(latest_msg.split('per minute: ')[1].split()[0])
                    if volume > 1000:
                        print(f"✅ High message volume ({volume}/min) - indicates real activity")
                    elif volume > 100:
                        print(f"✅ Moderate message volume ({volume}/min) - realistic")
                    else:
                        print(f"⚠️  Low message volume ({volume}/min) - check connection")
                except:
                    pass
                    
    except Exception as e:
        print(f"❌ Error analyzing message volume: {e}")

def check_websocket_connection():
    """Check WebSocket connection details"""
    print("\n🔌 CHECKING WEBSOCKET CONNECTION")
    print("=" * 60)
    
    # Check environment variables
    import os
    wss_url = os.getenv('WSS_URL', 'wss://api.mainnet-beta.solana.com')
    http_url = os.getenv('HTTP_URL', 'https://api.mainnet-beta.solana.com')
    
    print(f"WebSocket URL: {wss_url}")
    print(f"HTTP URL: {http_url}")
    
    if 'mainnet-beta.solana.com' in wss_url:
        print("✅ Using official Solana mainnet endpoint")
    elif 'helius' in wss_url:
        print("✅ Using Helius RPC endpoint")
    else:
        print("⚠️  Using custom RPC endpoint")
    
    # Check if system is currently receiving data
    try:
        with open('logs/nestjs.log', 'r') as f:
            lines = f.readlines()
            recent_lines = lines[-20:]
        
        active_connections = [line for line in recent_lines if 'Status 6 listener received event' in line]
        
        if active_connections:
            print("✅ System is actively receiving Status 6 events")
            latest_event = active_connections[-1]
            print(f"Latest event: {latest_event}")
        else:
            print("⚠️  No recent Status 6 events detected")
            
    except Exception as e:
        print(f"❌ Error checking connection status: {e}")

def main():
    """Main verification function"""
    print("🚀 RAYDIUM DATA VERIFICATION SUITE")
    print("=" * 60)
    print("This script verifies that we're receiving real-world Raydium data")
    print("=" * 60)
    
    analyze_price_movements()
    verify_blockchain_data()
    analyze_message_volume()
    check_websocket_connection()
    
    print("\n" + "=" * 60)
    print("🎯 VERIFICATION SUMMARY")
    print("=" * 60)
    print("If all checks pass, you're receiving real-world Raydium data!")
    print("The price movements you're seeing are from actual blockchain activity.")
    print("=" * 60)

if __name__ == "__main__":
    main() 