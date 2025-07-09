import { Connection, Transaction, Keypair, Commitment, RpcResponseAndContext, SignatureResult } from '@solana/web3.js';
import { ContinuumTransactionBuilder } from './TransactionBuilder';
import { SequenceManager } from './SequenceManager';
import { SwapParams } from '../types';
export declare class ContinuumTransactionSubmitter {
    private connection;
    private builder;
    private sequenceManager;
    private maxRetries;
    private retryDelay;
    constructor(connection: Connection, builder: ContinuumTransactionBuilder, sequenceManager: SequenceManager);
    submitTransaction(tx: Transaction, signer: Keypair, commitment?: Commitment): Promise<string>;
    submitSwapWithRetry(params: SwapParams, commitment?: Commitment): Promise<string>;
    waitForTransaction(signature: string, commitment?: Commitment): Promise<RpcResponseAndContext<SignatureResult>>;
    getTransactionStatus(signature: string): Promise<SignatureResult | null>;
    setMaxRetries(retries: number): void;
    setRetryDelay(delay: number): void;
}
//# sourceMappingURL=TransactionSubmitter.d.ts.map