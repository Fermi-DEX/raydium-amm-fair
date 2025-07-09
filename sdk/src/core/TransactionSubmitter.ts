import { 
  Connection, 
  Transaction, 
  Keypair,
  sendAndConfirmTransaction,
  TransactionSignature,
  Commitment,
  RpcResponseAndContext,
  SignatureResult
} from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { ContinuumTransactionBuilder } from './TransactionBuilder';
import { SequenceManager } from './SequenceManager';
import { SwapParams, ContinuumConfig } from '../types';
import { sleep } from '../utils/helpers';

export class ContinuumTransactionSubmitter {
  private connection: Connection;
  private builder: ContinuumTransactionBuilder;
  private sequenceManager: SequenceManager;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor(
    connection: Connection,
    builder: ContinuumTransactionBuilder,
    sequenceManager: SequenceManager
  ) {
    this.connection = connection;
    this.builder = builder;
    this.sequenceManager = sequenceManager;
  }

  async submitTransaction(
    tx: Transaction,
    signer: Keypair,
    commitment: Commitment = 'confirmed'
  ): Promise<string> {
    let retries = this.maxRetries;
    let lastError: Error | null = null;

    while (retries > 0) {
      try {
        // Get latest blockhash
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        
        // Sign transaction
        tx.sign(signer);
        
        // Send raw transaction
        const signature = await this.connection.sendRawTransaction(
          tx.serialize(),
          {
            skipPreflight: false,
            preflightCommitment: commitment
          }
        );

        // Wait for confirmation
        const confirmation = await this.connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        }, commitment);

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        return signature;
      } catch (error: any) {
        lastError = error;
        console.error(`Transaction failed (${retries} retries left):`, error.message);

        // Check for specific errors
        if (error.message?.includes("BadSeq") || error.message?.includes("0x1770")) {
          console.log("Sequence mismatch detected, waiting before retry...");
          await sleep(this.retryDelay);
          retries--;
        } else if (error.message?.includes("blockhash not found")) {
          // Immediate retry with new blockhash
          retries--;
        } else {
          // Other errors - throw immediately
          throw error;
        }
      }
    }

    throw new Error(`Max retries exceeded. Last error: ${lastError?.message}`);
  }

  async submitSwapWithRetry(
    params: SwapParams,
    commitment: Commitment = 'confirmed'
  ): Promise<string> {
    let retries = this.maxRetries;
    let lastError: Error | null = null;

    while (retries > 0) {
      try {
        // Build fresh transaction with current sequence
        const tx = await this.builder.buildSwapTransaction(params);
        
        // Submit transaction
        const signature = await this.submitTransaction(tx, params.user, commitment);
        
        return signature;
      } catch (error: any) {
        lastError = error;
        
        if (error.message?.includes("BadSeq")) {
          console.log(`Sequence conflict, rebuilding transaction... (${retries} retries left)`);
          await sleep(this.retryDelay);
          retries--;
        } else {
          throw error;
        }
      }
    }

    throw new Error(`Failed to submit swap after ${this.maxRetries} retries. Last error: ${lastError?.message}`);
  }

  async waitForTransaction(
    signature: string,
    commitment: Commitment = 'confirmed'
  ): Promise<RpcResponseAndContext<SignatureResult>> {
    const result = await this.connection.confirmTransaction(signature, commitment);
    
    if (result.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
    }
    
    return result;
  }

  async getTransactionStatus(signature: string): Promise<SignatureResult | null> {
    const status = await this.connection.getSignatureStatus(signature);
    return status.value;
  }

  setMaxRetries(retries: number): void {
    this.maxRetries = retries;
  }

  setRetryDelay(delay: number): void {
    this.retryDelay = delay;
  }
}