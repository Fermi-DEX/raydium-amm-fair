import { PublicKey } from '@solana/web3.js';

export interface AccountMetaOptions {
  pubkey: PublicKey;
  isSigner?: boolean;
  isMut?: boolean;
  isWritable?: boolean;
}

export function accountMeta(options: AccountMetaOptions) {
  return {
    pubkey: options.pubkey,
    isSigner: options.isSigner || false,
    isWritable: options.isMut || options.isWritable || false
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}