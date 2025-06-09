import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

dotenv.config();

const RAYDIUM_PUBLIC_KEY = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

async function debugRaydiumProgram() {
  const connection = new Connection(process.env.HTTP_URL || 'https://api.mainnet-beta.solana.com');
  const raydiumProgram = new PublicKey(RAYDIUM_PUBLIC_KEY);

  console.log('🔍 DEBUG: Starting Raydium program monitoring...');
  console.log('Program ID:', raydiumProgram.toString());
  console.log('Monitoring all program logs and account changes...\n');

  let logCount = 0;
  let accountChangeCount = 0;

  // Monitor ALL program logs (not just specific instructions)
  connection.onLogs(
    raydiumProgram,
    ({ logs, err, signature }) => {
      if (err) return;

      logCount++;
      console.log(`📝 LOG #${logCount} - Signature: ${signature}`);
      console.log('Logs:', logs);
      console.log('---\n');

      // Only show first 10 logs to avoid spam
      if (logCount >= 10) {
        console.log('✅ First 10 logs captured. Stopping log monitoring...');
        return;
      }
    },
    'confirmed'
  );

  // Monitor program account changes
  connection.onProgramAccountChange(
    raydiumProgram,
    async (accountInfo, context) => {
      accountChangeCount++;
      console.log(`🔄 ACCOUNT CHANGE #${accountChangeCount} - Account: ${accountInfo.accountId.toString()}`);
      console.log('Slot:', context.slot);
      console.log('Data length:', accountInfo.accountInfo.data.length);
      console.log('---\n');

      // Only show first 5 account changes to avoid spam
      if (accountChangeCount >= 5) {
        console.log('✅ First 5 account changes captured. Stopping account monitoring...');
        return;
      }
    },
    'confirmed'
  );

  console.log('⏰ Monitoring for 60 seconds...');
  console.log('Press Ctrl+C to stop early\n');

  // Run for 60 seconds
  setTimeout(() => {
    console.log('\n📊 DEBUG SUMMARY:');
    console.log(`Total logs captured: ${logCount}`);
    console.log(`Total account changes captured: ${accountChangeCount}`);
    console.log('Debug monitoring complete.');
    process.exit(0);
  }, 60000);
}

debugRaydiumProgram().catch(console.error); 