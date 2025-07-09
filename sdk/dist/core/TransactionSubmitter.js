"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContinuumTransactionSubmitter = void 0;
const helpers_1 = require("../utils/helpers");
class ContinuumTransactionSubmitter {
    constructor(connection, builder, sequenceManager) {
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
        this.connection = connection;
        this.builder = builder;
        this.sequenceManager = sequenceManager;
    }
    async submitTransaction(tx, signer, commitment = 'confirmed') {
        let retries = this.maxRetries;
        let lastError = null;
        while (retries > 0) {
            try {
                // Get latest blockhash
                const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
                tx.recentBlockhash = blockhash;
                // Sign transaction
                tx.sign(signer);
                // Send raw transaction
                const signature = await this.connection.sendRawTransaction(tx.serialize(), {
                    skipPreflight: false,
                    preflightCommitment: commitment
                });
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
            }
            catch (error) {
                lastError = error;
                console.error(`Transaction failed (${retries} retries left):`, error.message);
                // Check for specific errors
                if (error.message?.includes("BadSeq") || error.message?.includes("0x1770")) {
                    console.log("Sequence mismatch detected, waiting before retry...");
                    await (0, helpers_1.sleep)(this.retryDelay);
                    retries--;
                }
                else if (error.message?.includes("blockhash not found")) {
                    // Immediate retry with new blockhash
                    retries--;
                }
                else {
                    // Other errors - throw immediately
                    throw error;
                }
            }
        }
        throw new Error(`Max retries exceeded. Last error: ${lastError?.message}`);
    }
    async submitSwapWithRetry(params, commitment = 'confirmed') {
        let retries = this.maxRetries;
        let lastError = null;
        while (retries > 0) {
            try {
                // Build fresh transaction with current sequence
                const tx = await this.builder.buildSwapTransaction(params);
                // Submit transaction
                const signature = await this.submitTransaction(tx, params.user, commitment);
                return signature;
            }
            catch (error) {
                lastError = error;
                if (error.message?.includes("BadSeq")) {
                    console.log(`Sequence conflict, rebuilding transaction... (${retries} retries left)`);
                    await (0, helpers_1.sleep)(this.retryDelay);
                    retries--;
                }
                else {
                    throw error;
                }
            }
        }
        throw new Error(`Failed to submit swap after ${this.maxRetries} retries. Last error: ${lastError?.message}`);
    }
    async waitForTransaction(signature, commitment = 'confirmed') {
        const result = await this.connection.confirmTransaction(signature, commitment);
        if (result.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
        }
        return result;
    }
    async getTransactionStatus(signature) {
        const status = await this.connection.getSignatureStatus(signature);
        return status.value;
    }
    setMaxRetries(retries) {
        this.maxRetries = retries;
    }
    setRetryDelay(delay) {
        this.retryDelay = delay;
    }
}
exports.ContinuumTransactionSubmitter = ContinuumTransactionSubmitter;
//# sourceMappingURL=TransactionSubmitter.js.map