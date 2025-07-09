import { Connection, Keypair } from '@solana/web3.js';
import { Program, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { SwapParams, ContinuumConfig } from './types';
export declare class ContinuumSDK {
    private connection;
    private program;
    private sequenceManager;
    private transactionBuilder;
    private transactionSubmitter;
    private mevProtection;
    private config;
    constructor(connection: Connection, wallet: Wallet, config?: Partial<ContinuumConfig>);
    /**
     * Initialize the FIFO state account (only needs to be done once)
     */
    initializeFifoState(payer: Keypair): Promise<string>;
    /**
     * Perform a protected swap through the FIFO wrapper
     */
    swap(params: SwapParams): Promise<string>;
    /**
     * Perform a protected swap with additional MEV protection
     */
    swapWithMEVProtection(params: SwapParams, options?: {
        priority?: 'low' | 'medium' | 'high';
        useJito?: boolean;
    }): Promise<string>;
    /**
     * Get current sequence number
     */
    getCurrentSequence(): Promise<BN>;
    /**
     * Subscribe to sequence updates
     */
    subscribeToSequenceUpdates(callback: (seq: BN) => void): Promise<number>;
    /**
     * Unsubscribe from sequence updates
     */
    unsubscribeFromSequenceUpdates(subscriptionId: number): void;
    /**
     * Get program instance for advanced usage
     */
    getProgram(): Program<any>;
    /**
     * Get connection instance
     */
    getConnection(): Connection;
    /**
     * Get config
     */
    getConfig(): ContinuumConfig;
}
//# sourceMappingURL=ContinuumSDK.d.ts.map