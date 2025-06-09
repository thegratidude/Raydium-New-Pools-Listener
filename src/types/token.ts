import { PublicKey } from '@solana/web3.js';

export interface TokenInfo {
  symbol: string;
  decimals: number;
  mint: string | PublicKey;
}

export interface TokenMap {
  [mint: string]: TokenInfo;
}

// Type guard function
export function isTokenInfo(obj: unknown): obj is TokenInfo {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'symbol' in obj &&
    'decimals' in obj &&
    'mint' in obj &&
    typeof (obj as TokenInfo).symbol === 'string' &&
    typeof (obj as TokenInfo).decimals === 'number' &&
    (
      typeof (obj as TokenInfo).mint === 'string' ||
      (obj as TokenInfo).mint instanceof PublicKey
    )
  );
} 