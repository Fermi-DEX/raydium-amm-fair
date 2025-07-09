"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContinuumTransactionBuilder = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const helpers_1 = require("../utils/helpers");
class ContinuumTransactionBuilder {
    constructor(program, sequenceManager, config) {
        this.program = program;
        this.sequenceManager = sequenceManager;
        this.config = config;
    }
    async buildSwapTransaction(params) {
        const tx = new web3_js_1.Transaction();
        // Get PDAs
        const [fifoState] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("fifo_state")], this.config.wrapperProgramId);
        const [delegateAuthority] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("delegate"), params.userSource.toBuffer()], this.config.wrapperProgramId);
        // Step 1: Approve delegation to PDA
        const approveIx = (0, spl_token_1.createApproveInstruction)(params.userSource, delegateAuthority, params.user.publicKey, params.amountIn.toNumber());
        tx.add(approveIx);
        // Step 2: Build wrapper instruction
        const wrapperIx = await this.buildWrapperInstruction(params, fifoState, delegateAuthority);
        tx.add(wrapperIx);
        return tx;
    }
    async buildWrapperInstruction(params, fifoState, delegateAuthority) {
        // Get next sequence
        const nextSeq = await this.sequenceManager.getNextSequence(fifoState);
        // Build Raydium swap instruction data
        const raydiumIxData = this.serializeRaydiumSwapData(params);
        // Build account list for wrapper
        const keys = [
            // Wrapper-specific accounts
            (0, helpers_1.accountMeta)({ pubkey: fifoState, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: delegateAuthority, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.user.publicKey, isSigner: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.userSource, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.userDestination, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: this.config.raydiumProgramId }),
            (0, helpers_1.accountMeta)({ pubkey: spl_token_1.TOKEN_PROGRAM_ID }),
            // Raydium accounts (in exact order expected by Raydium)
            ...this.getRaydiumAccounts(params)
        ];
        // Encode instruction data: seq (u64) + raydium_ix_data (bytes)
        const data = Buffer.concat([
            nextSeq.toArrayLike(Buffer, 'le', 8),
            Buffer.from(raydiumIxData)
        ]);
        return new web3_js_1.TransactionInstruction({
            programId: this.config.wrapperProgramId,
            keys,
            data
        });
    }
    serializeRaydiumSwapData(params) {
        // Raydium swap instruction 9 (fixed in)
        const instructionId = 9;
        // Layout: u8 (instruction) + u64 (amountIn) + u64 (minAmountOut)
        const data = Buffer.alloc(1 + 8 + 8);
        let offset = 0;
        // Write instruction ID
        data.writeUInt8(instructionId, offset);
        offset += 1;
        // Write amountIn (little-endian)
        const amountInBuffer = params.amountIn.toArrayLike(Buffer, 'le', 8);
        amountInBuffer.copy(data, offset);
        offset += 8;
        // Write minimumAmountOut (little-endian)
        const minAmountOutBuffer = params.minimumAmountOut.toArrayLike(Buffer, 'le', 8);
        minAmountOutBuffer.copy(data, offset);
        return data;
    }
    getRaydiumAccounts(params) {
        // Build Raydium account metas in the exact order expected
        // Note: The delegate authority should be passed where user authority is expected
        const [delegateAuthority] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("delegate"), params.userSource.toBuffer()], this.config.wrapperProgramId);
        return [
            // Token program
            (0, helpers_1.accountMeta)({ pubkey: spl_token_1.TOKEN_PROGRAM_ID }),
            // AMM accounts
            (0, helpers_1.accountMeta)({ pubkey: params.poolId, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.ammAuthority }),
            (0, helpers_1.accountMeta)({ pubkey: params.openOrders, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.targetOrders, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.poolCoinTokenAccount, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.poolPcTokenAccount, isMut: true }),
            // Serum market accounts
            (0, helpers_1.accountMeta)({ pubkey: params.serumProgram }),
            (0, helpers_1.accountMeta)({ pubkey: params.serumMarket, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.serumBids, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.serumAsks, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.serumEventQueue, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.serumCoinVaultAccount, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.serumPcVaultAccount, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.serumVaultSigner }),
            // User accounts (with delegate authority instead of user)
            (0, helpers_1.accountMeta)({ pubkey: params.userSource, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: params.userDestination, isMut: true }),
            (0, helpers_1.accountMeta)({ pubkey: delegateAuthority, isSigner: true }) // Delegate as signer
        ];
    }
    async buildInitializeFifoStateTransaction() {
        const tx = new web3_js_1.Transaction();
        const [fifoState] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("fifo_state")], this.config.wrapperProgramId);
        // Check if already initialized
        try {
            await this.program.account.fifoState.fetch(fifoState);
            console.log("FifoState already initialized");
            return tx; // Return empty transaction
        }
        catch (e) {
            // Account doesn't exist, proceed with initialization
        }
        const initIx = await this.program.methods
            .initialize()
            .accounts({
            fifoState,
            payer: this.program.provider.wallet.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .instruction();
        tx.add(initIx);
        return tx;
    }
}
exports.ContinuumTransactionBuilder = ContinuumTransactionBuilder;
//# sourceMappingURL=TransactionBuilder.js.map