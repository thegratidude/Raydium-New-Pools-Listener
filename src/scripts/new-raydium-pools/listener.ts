import { Logger } from '@nestjs/common';
import {
  Connection,
  ParsedInstruction,
  PartiallyDecodedInstruction,
  PublicKey,
} from '@solana/web3.js';
import { RAYDIUM_PUBLIC_KEY } from 'src/main';
import { sleep } from 'src/utils/sleep';
import { liuquidityPoolIndex, quoteIndex, tokenMintIndex } from './constants';
import { getPoolMonitor } from './pool-monitor';

let txnSignature = '';

// Health check: count messages seen
let messageCount = 0;
setInterval(() => {
  console.log(`🩺 Health check: ${messageCount} messages seen in the last minute`);
  messageCount = 0;
}, 60_000);

function isPartiallyDecodedInstruction(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
): instruction is PartiallyDecodedInstruction {
  return (instruction as PartiallyDecodedInstruction).accounts !== undefined;
}

// Fetch raydium mints and add to pool monitor
async function fetchRaydiumMints(txId: string, connection: Connection) {
  try {
    const tx = await connection.getParsedTransaction(txId, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) {
      console.log('Transaction not found:', txId);
      return;
    }

    if (txId) {
      txnSignature = txId;
    }

    Logger.log('Signature', txnSignature);

    const instructions = tx.transaction.message.instructions;

    const raydiumInstruction = instructions.find(
      (ix) => ix.programId.toBase58() === RAYDIUM_PUBLIC_KEY,
    );

    await sleep(2000);

    if (
      raydiumInstruction &&
      isPartiallyDecodedInstruction(raydiumInstruction)
    ) {
      const accounts = raydiumInstruction.accounts as PublicKey[];

      // Token A mint
      let tokenAAccount = accounts[tokenMintIndex];

      // Token B mint
      let tokenBAccount = accounts[quoteIndex];

      if (
        tokenBAccount.toBase58() !==
          'So11111111111111111111111111111111111111112' &&
        tokenBAccount.toBase58() !==
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      ) {
        [tokenAAccount, tokenBAccount] = [tokenBAccount, tokenAAccount];
      }

      // Liquidity pool address
      const liquidityPoolAddressAccount =
        accounts[liuquidityPoolIndex]?.toBase58();

      Logger.log('token mint address', tokenAAccount);
      Logger.log('quote address', tokenBAccount);
      Logger.log('liquidity pool address', liquidityPoolAddressAccount);

      // Add pool to monitor if we have all required addresses
      if (liquidityPoolAddressAccount) {
        const monitor = getPoolMonitor(connection);
        await monitor.addPool(
          liquidityPoolAddressAccount,
          tokenAAccount.toBase58(),
          tokenBAccount.toBase58()
        );
      }
    }
  } catch (error) {
    Logger.log('error', error);
  }
}

export async function startConnection(
  connection: Connection,
  programAddress: PublicKey,
  searchInstruction: string,
): Promise<void> {
  console.log('Monitoring logs for program:', programAddress.toString());
  connection.onLogs(
    programAddress,
    ({ logs, err, signature }) => {
      if (err) return;

      // Increment message count for every log event
      messageCount++;

      if (logs && logs.some((log) => log.includes(searchInstruction))) {
        console.log(
          "Signature for 'initialize2':",
          `https://explorer.solana.com/tx/${signature}`,
        );
        fetchRaydiumMints(signature, connection);
      }
    },
    'confirmed',
  );
}
