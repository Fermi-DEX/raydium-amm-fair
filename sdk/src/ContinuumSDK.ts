import { 
  Connection, 
  PublicKey, 
  Keypair,
  Transaction,
  Commitment
} from '@solana/web3.js';
import { 
  Program, 
  AnchorProvider, 
  Wallet,
  setProvider
} from '@coral-xyz/anchor';
import { BN } from 'bn.js';

import { SequenceManager } from './core/SequenceManager';
import { ContinuumTransactionBuilder } from './core/TransactionBuilder';
import { ContinuumTransactionSubmitter } from './core/TransactionSubmitter';
import { MEVProtection } from './core/MEVProtection';
import { SwapParams, ContinuumConfig } from './types';
import IDL from './idl/continuum_wrapper.json';

export class ContinuumSDK {
  private connection: Connection;
  private program: Program;
  private sequenceManager: SequenceManager;
  private transactionBuilder: ContinuumTransactionBuilder;
  private transactionSubmitter: ContinuumTransactionSubmitter;
  private mevProtection: MEVProtection;
  private config: ContinuumConfig;

  constructor(
    connection: Connection,
    wallet: Wallet,
    config?: Partial<ContinuumConfig>
  ) {
    this.connection = connection;
    
    // Set up Anchor provider
    const provider = new AnchorProvider(
      connection,
      wallet,
      { commitment: 'confirmed' }
    );
    setProvider(provider);

    // Initialize config with defaults
    this.config = {
      connection,
      wrapperProgramId: new PublicKey(config?.wrapperProgramId || IDL.address),
      raydiumProgramId: new PublicKey(config?.raydiumProgramId || '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8')
    };

    // Initialize program
    this.program = new Program(IDL as any, this.config.wrapperProgramId, provider);

    // Initialize core components
    this.sequenceManager = new SequenceManager(this.program, connection);
    this.transactionBuilder = new ContinuumTransactionBuilder(
      this.program,
      this.sequenceManager,
      this.config
    );
    this.transactionSubmitter = new ContinuumTransactionSubmitter(
      connection,
      this.transactionBuilder,
      this.sequenceManager
    );
    this.mevProtection = new MEVProtection(connection);
  }

  /**
   * Initialize the FIFO state account (only needs to be done once)
   */
  async initializeFifoState(payer: Keypair): Promise<string> {
    const tx = await this.transactionBuilder.buildInitializeFifoStateTransaction();
    
    if (tx.instructions.length === 0) {
      console.log("FIFO state already initialized");
      return "";
    }

    return await this.transactionSubmitter.submitTransaction(tx, payer);
  }

  /**
   * Perform a protected swap through the FIFO wrapper
   */
  async swap(params: SwapParams): Promise<string> {
    // Get FIFO state PDA
    const [fifoState] = PublicKey.findProgramAddressSync(
      [Buffer.from("fifo_state")],
      this.config.wrapperProgramId
    );

    // Get next sequence and wait for our turn
    const nextSeq = await this.sequenceManager.getNextSequence(fifoState);
    console.log(`Waiting for sequence ${nextSeq.toString()}...`);
    
    await this.sequenceManager.waitForSequence(fifoState, nextSeq);
    console.log("Our turn! Submitting swap...");

    // Submit swap with automatic retry on sequence conflicts
    const signature = await this.transactionSubmitter.submitSwapWithRetry(params);
    console.log(`Swap submitted: ${signature}`);

    return signature;
  }

  /**
   * Perform a protected swap with additional MEV protection
   */
  async swapWithMEVProtection(
    params: SwapParams,
    options?: {
      priority?: 'low' | 'medium' | 'high';
      useJito?: boolean;
    }
  ): Promise<string> {
    // Enable Jito if requested
    if (options?.useJito) {
      this.mevProtection.enableJitoBundle();
    }

    // Build transaction
    const tx = await this.transactionBuilder.buildSwapTransaction(params);

    // Schedule for optimal slot
    const targetSlot = await this.mevProtection.estimateOptimalSlot(
      options?.priority || 'medium'
    );

    // Submit with MEV protection
    const signature = await this.mevProtection.scheduleTransaction(
      tx,
      targetSlot,
      [params.user]
    );

    return signature;
  }

  /**
   * Get current sequence number
   */
  async getCurrentSequence(): Promise<BN> {
    const [fifoState] = PublicKey.findProgramAddressSync(
      [Buffer.from("fifo_state")],
      this.config.wrapperProgramId
    );

    return await this.sequenceManager.getCurrentSequence(fifoState);
  }

  /**
   * Subscribe to sequence updates
   */
  subscribeToSequenceUpdates(callback: (seq: BN) => void): Promise<number> {
    const [fifoState] = PublicKey.findProgramAddressSync(
      [Buffer.from("fifo_state")],
      this.config.wrapperProgramId
    );

    return this.sequenceManager.subscribeToSequenceUpdates(fifoState, callback);
  }

  /**
   * Unsubscribe from sequence updates
   */
  unsubscribeFromSequenceUpdates(subscriptionId: number): void {
    this.sequenceManager.unsubscribeFromSequenceUpdates(subscriptionId);
  }

  /**
   * Get program instance for advanced usage
   */
  getProgram(): Program {
    return this.program;
  }

  /**
   * Get connection instance
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Get config
   */
  getConfig(): ContinuumConfig {
    return this.config;
  }
}