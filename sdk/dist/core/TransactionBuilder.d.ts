import { Transaction } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { SwapParams, ContinuumConfig } from '../types';
import { SequenceManager } from './SequenceManager';
export declare class ContinuumTransactionBuilder {
    private program;
    private sequenceManager;
    private config;
    constructor(program: Program<any>, sequenceManager: SequenceManager, config: ContinuumConfig);
    buildSwapTransaction(params: SwapParams): Promise<Transaction>;
    private buildWrapperInstruction;
    private serializeRaydiumSwapData;
    private getRaydiumAccounts;
    buildInitializeFifoStateTransaction(): Promise<Transaction>;
}
//# sourceMappingURL=TransactionBuilder.d.ts.map