#!/bin/bash

echo "🚀 Testing Raydium Pool Monitor"
echo "================================"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "Please create a .env file with your HELIUS_API_KEY"
    exit 1
fi

# Check if HELIUS_API_KEY is set
if ! grep -q "HELIUS_API_KEY" .env; then
    echo "❌ HELIUS_API_KEY not found in .env file!"
    echo "Please add: HELIUS_API_KEY=your_api_key_here"
    exit 1
fi

echo "✅ Environment check passed"
echo "📡 Starting monitor (will capture 5 activities then exit)..."
echo "Press Ctrl+C to stop early"
echo ""

# Run the monitor
npx ts-node raydium_monitor.ts 