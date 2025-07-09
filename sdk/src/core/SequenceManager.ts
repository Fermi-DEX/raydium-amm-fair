import { Connection, PublicKey } from '@solana/web3.js';
import { Program, BN } from '@coral-xyz/anchor';
import { FifoState } from '../types';

export class SequenceManager {
  private sequenceCache: Map<string, BN> = new Map();
  private program: Program<any>;
  private connection: Connection;

  constructor(program: Program<any>, connection: Connection) {
    this.program = program;
    this.connection = connection;
  }

  async getNextSequence(fifoStatePubkey: PublicKey): Promise<BN> {
    try {
      const fifoState = await (this.program.account as any).fifoState.fetch(fifoStatePubkey) as FifoState;
      const nextSeq = fifoState.seq.add(new BN(1));
      this.sequenceCache.set(fifoStatePubkey.toBase58(), nextSeq);
      return nextSeq;
    } catch (error: any) {
      // If account doesn't exist yet, start at 1
      if (error.message?.includes('Account does not exist')) {
        return new BN(1);
      }
      throw error;
    }
  }

  async getCurrentSequence(fifoStatePubkey: PublicKey): Promise<BN> {
    try {
      const fifoState = await (this.program.account as any).fifoState.fetch(fifoStatePubkey) as FifoState;
      return fifoState.seq;
    } catch (error: any) {
      // If account doesn't exist yet, return 0
      if (error.message?.includes('Account does not exist')) {
        return new BN(0);
      }
      throw error;
    }
  }

  async waitForSequence(fifoStatePubkey: PublicKey, targetSeq: BN): Promise<void> {
    const maxWaitTime = 30000; // 30 seconds timeout
    const pollInterval = 100; // 100ms
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const currentSeq = await this.getCurrentSequence(fifoStatePubkey);
        
        // We can proceed if current sequence is targetSeq - 1
        if (currentSeq.gte(targetSeq.sub(new BN(1)))) {
          return;
        }
        
        await this.sleep(pollInterval);
      } catch (error) {
        console.warn('Error checking sequence:', error);
        await this.sleep(pollInterval);
      }
    }

    throw new Error(`Timeout waiting for sequence ${targetSeq.toString()}`);
  }

  async subscribeToSequenceUpdates(
    fifoStatePubkey: PublicKey,
    callback: (seq: BN) => void
  ): Promise<number> {
    return this.connection.onAccountChange(
      fifoStatePubkey,
      (accountInfo) => {
        try {
          const decoded = this.program.coder.accounts.decode('FifoState', accountInfo.data);
          callback(new BN(decoded.seq));
        } catch (error) {
          console.error('Error decoding FifoState:', error);
        }
      },
      'confirmed'
    );
  }

  unsubscribeFromSequenceUpdates(subscriptionId: number): void {
    this.connection.removeAccountChangeListener(subscriptionId);
  }

  clearCache(): void {
    this.sequenceCache.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}