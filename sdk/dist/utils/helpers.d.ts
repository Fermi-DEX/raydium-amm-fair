import { PublicKey } from '@solana/web3.js';
export interface AccountMetaOptions {
    pubkey: PublicKey;
    isSigner?: boolean;
    isMut?: boolean;
    isWritable?: boolean;
}
export declare function accountMeta(options: AccountMetaOptions): {
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
};
export declare function sleep(ms: number): Promise<void>;
//# sourceMappingURL=helpers.d.ts.map