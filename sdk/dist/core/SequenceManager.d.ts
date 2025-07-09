import { Connection, PublicKey } from '@solana/web3.js';
import { Program, BN } from '@coral-xyz/anchor';
export declare class SequenceManager {
    private sequenceCache;
    private program;
    private connection;
    constructor(program: Program<any>, connection: Connection);
    getNextSequence(fifoStatePubkey: PublicKey): Promise<BN>;
    getCurrentSequence(fifoStatePubkey: PublicKey): Promise<BN>;
    waitForSequence(fifoStatePubkey: PublicKey, targetSeq: BN): Promise<void>;
    subscribeToSequenceUpdates(fifoStatePubkey: PublicKey, callback: (seq: BN) => void): Promise<number>;
    unsubscribeFromSequenceUpdates(subscriptionId: number): void;
    clearCache(): void;
    private sleep;
}
//# sourceMappingURL=SequenceManager.d.ts.map