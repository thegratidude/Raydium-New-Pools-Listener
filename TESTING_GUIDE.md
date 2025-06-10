# Raydium Pool Monitor Testing Guide

## Quick Start

### 1. Environment Setup
Your `.env` file should contain:
```
HELIUS_API_KEY=47098f60-a0bc-48ca-9d4d-6cd722281a89
```

### 2. Test Methods

#### Method A: Simple Test (Recommended for first-time testing)
```bash
./test_monitor.sh
```
This runs the original script with the BONK/SOL pool.

#### Method B: Simplified Test (Faster, less verbose)
```bash
npx ts-node test_monitor_simple.ts
```
This runs a simplified version that:
- Monitors USDC/SOL pool (usually more active)
- Captures only 3 transactions
- Has a 2-minute timeout
- Shows less detailed output

#### Method C: Direct Execution
```bash
npx ts-node raydium_monitor.ts
```
This runs the full-featured monitor with BONK/SOL pool.

## What to Expect

### Successful Connection
```
🚀 Starting Raydium Pool Monitor Test
📁 Make sure your .env file contains HELIUS_API_KEY
🎯 Monitoring BONK/SOL pool for high activity testing
🔗 Connecting to Helius WebSocket...
✅ WebSocket connected successfully
📡 Monitoring pool: HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv
🎯 Waiting for first 5 transactions...
📨 Subscription request sent
✅ Subscription confirmed. ID: 12345
```

### Transaction Activity
```
🔥 ACTIVITY #1
📝 Signature: 5KJvsngHeMso884zQhPv2T5Tdf3iz6CEMu5R5oyxV7b1...
🎰 Slot: 2,345,678
💰 Fee: 0.000005 SOL
⚡ Compute Units: 200,000
✅ Status: ✅ Success

💸 SOL Balance Changes:
   Account 0: +0.001234 SOL
   Account 1: -0.001239 SOL

📋 Program Logs:
   📄 Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke [1]
   📄 Program log: Instruction: Swap

🪙 Token Balance Changes:
   🏷️  BONK (BASE): -1000.000000
   🏷️  SOL (QUOTE): +0.001234
```

## Troubleshooting

### 1. WebSocket Connection Error (401)
**Problem**: `❌ WebSocket error: Error: Unexpected server response: 401`
**Solution**: Check your `.env` file format. It should be:
```
HELIUS_API_KEY=your_api_key_here
```
NOT:
```
HELIUS_API_KEY=wss://atlas-mainnet.helius-rpc.com/?api-key=your_api_key_here
```

### 2. No Activity Detected
**Problem**: Script runs but shows no transactions
**Solutions**:
- Try the USDC/SOL pool (more active): `test_monitor_simple.ts`
- Wait longer (some pools have low activity)
- Check if the pool address is correct
- Try during peak trading hours

### 3. TypeScript Compilation Errors
**Problem**: `Cannot find module 'ws'` or similar
**Solution**: Install dependencies:
```bash
npm install
```

### 4. Permission Denied
**Problem**: `Permission denied` when running test script
**Solution**: Make script executable:
```bash
chmod +x test_monitor.sh
```

## Pool Addresses for Testing

- **BONK/SOL**: `HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv` (High activity)
- **USDC/SOL**: `58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2` (Very high activity)
- **USDT/SOL**: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` (High activity)

## Stopping the Monitor

- **Automatic**: Script stops after capturing the specified number of transactions
- **Manual**: Press `Ctrl+C` to stop gracefully
- **Timeout**: Simple test auto-exits after 2 minutes if no activity

## Expected Output

The monitor will show:
1. Connection status
2. Subscription confirmation
3. Transaction details for each activity:
   - Signature
   - Slot number
   - Transaction fee
   - Success/failure status
   - Balance changes
   - Program logs
   - Token balance changes

## Performance Notes

- **With Helius API**: Faster, more reliable, higher rate limits
- **Without API key**: Uses public Solana RPC (slower, may have rate limits)
- **Activity frequency**: Depends on pool popularity and market conditions
- **Memory usage**: Low (~50-100MB)
- **Network usage**: Minimal (WebSocket connection only) 