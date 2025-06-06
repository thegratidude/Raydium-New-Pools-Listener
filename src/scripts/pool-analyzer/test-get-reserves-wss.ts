// @ts-nocheck
import { Connection, PublicKey } from '@solana/web3.js';
import { Api } from '@raydium-io/raydium-sdk-v2';
import * as dotenv from 'dotenv';
import * as BufferLayout from '@solana/buffer-layout';
import BN from 'bn.js';

dotenv.config();

const HTTP_URL = process.env.HTTP_URL!;
const WSS_URL = process.env.WSS_URL!;
// Example: SOL/USDC pool address
const POOL_ADDRESS = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';

// @ts-ignore
const RAYDIUM_AMM_LAYOUT = BufferLayout.struct([
  BufferLayout.blob(8), // padding
  BufferLayout.nu64('status'),
  BufferLayout.nu64('nonce'),
  BufferLayout.blob(32), // tokenProgramId
  BufferLayout.blob(32), // tokenAMint
  BufferLayout.blob(32), // tokenBMint
  BufferLayout.blob(32), // tokenAVault
  BufferLayout.blob(32), // tokenBVault
  BufferLayout.blob(32), // lpMint
  BufferLayout.blob(32), // openOrders
  BufferLayout.blob(32), // targetOrders
  BufferLayout.blob(32), // withdrawQueue
  BufferLayout.blob(32), // lpVault
  BufferLayout.blob(8, 'tokenAReserve'), // <-- Token A reserve as buffer
  BufferLayout.blob(8, 'tokenBReserve'), // <-- Token B reserve as buffer
  BufferLayout.blob(112), // rest of struct
]) as unknown as BufferLayout.Layout<any>;

function decodeReserves(data: Buffer) {
  const decoded = RAYDIUM_AMM_LAYOUT.decode(data) as any;
  // Use BN to decode the 8-byte buffers as little-endian u64
  const tokenAReserve = new BN(decoded.tokenAReserve, 'le');
  const tokenBReserve = new BN(decoded.tokenBReserve, 'le');
  return { tokenAReserve, tokenBReserve };
}

async function subscribeToPoolState(poolAddress: string) {
  try {
    // Use HTTP for Raydium SDK
    const api = new Api({ cluster: 'mainnet', timeout: 30000, endpoint: HTTP_URL });
    const poolInfo = await api.fetchPoolById({ ids: poolAddress });
    if (!Array.isArray(poolInfo) || poolInfo.length === 0 || !poolInfo[0]) {
      console.warn('Pool not found or not yet indexed.');
      return;
    }
    const pool = poolInfo[0];
    const stateAccount = pool.id;
    if (!stateAccount) {
      console.warn('State account not found in pool info.');
      return;
    }
    // Get token mints, symbols, and decimals
    const tokenAInfo = pool.mintA;
    const tokenBInfo = pool.mintB;
    const tokenASymbol = tokenAInfo?.symbol || 'TokenA';
    const tokenBSymbol = tokenBInfo?.symbol || 'TokenB';
    const tokenADecimals = tokenAInfo?.decimals ?? 6;
    const tokenBDecimals = tokenBInfo?.decimals ?? 6;
    console.log('Pool address (input):', poolAddress);
    console.log('State account (used for WSS):', stateAccount);
    console.log(`Token A: ${tokenASymbol} (decimals: ${tokenADecimals})`);
    console.log(`Token B: ${tokenBSymbol} (decimals: ${tokenBDecimals})`);
    // Use HTTP for main connection, WSS for subscriptions
    const connection = new Connection(HTTP_URL, { wsEndpoint: WSS_URL });
    connection.onAccountChange(
      new PublicKey(stateAccount),
      (accountInfo, context) => {
        // Decode reserves
        try {
          const { tokenAReserve, tokenBReserve } = decodeReserves(accountInfo.data);
          // Convert to human-readable amounts
          const tokenAAmount = tokenAReserve.div(new BN(10).pow(new BN(tokenADecimals))).toString();
          const tokenBAmount = tokenBReserve.div(new BN(10).pow(new BN(tokenBDecimals))).toString();
          console.log('---');
          console.log('Slot:', context.slot);
          console.log(`Reserves: ${tokenAAmount} ${tokenASymbol} | ${tokenBAmount} ${tokenBSymbol}`);
          console.log(`Raw: ${tokenAReserve.toString()} | ${tokenBReserve.toString()}`);
        } catch (e) {
          console.log('Failed to decode reserves:', e);
        }
      }
    );
    console.log('Subscribed to pool state account changes via WSS.');
    console.log('Waiting for updates...');
  } catch (error: any) {
    console.error('Error fetching pool state account:', error?.message || error);
  }
}

subscribeToPoolState(POOL_ADDRESS); 