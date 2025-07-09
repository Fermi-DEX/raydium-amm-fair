// Main SDK export
export { ContinuumSDK } from './ContinuumSDK';

// Core exports
export { SequenceManager } from './core/SequenceManager';
export { ContinuumTransactionBuilder } from './core/TransactionBuilder';
export { ContinuumTransactionSubmitter } from './core/TransactionSubmitter';
export { MEVProtection } from './core/MEVProtection';

// Type exports
export * from './types';

// Utility exports
export * from './utils/helpers';

// Re-export commonly used Solana types for convenience
export { 
  PublicKey, 
  Keypair, 
  Connection,
  Transaction,
  TransactionInstruction,
  Commitment
} from '@solana/web3.js';

export { BN } from '@coral-xyz/anchor';