import { Connection, Transaction, Keypair, SendOptions } from '@solana/web3.js';
export declare class MEVProtection {
    private connection;
    private useJitoBundle;
    private jitoTipAmount;
    constructor(connection: Connection);
    sendProtectedTransaction(tx: Transaction, signers: Keypair[], options?: SendOptions): Promise<string>;
    scheduleTransaction(tx: Transaction, targetSlot: number, signers: Keypair[]): Promise<string>;
    sendWithBackrun(tx: Transaction, signers: Keypair[], backrunDelay?: number): Promise<string>;
    monitorMempool(callback: (tx: any) => void, filter?: {
        programId?: string;
    }): Promise<number>;
    enableJitoBundle(tipAmount?: number): void;
    disableJitoBundle(): void;
    estimateOptimalSlot(priority?: 'low' | 'medium' | 'high'): Promise<number>;
    getRecentPriorityFees(): Promise<number>;
}
//# sourceMappingURL=MEVProtection.d.ts.map