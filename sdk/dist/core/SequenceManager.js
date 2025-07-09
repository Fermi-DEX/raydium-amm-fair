"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequenceManager = void 0;
const anchor_1 = require("@coral-xyz/anchor");
class SequenceManager {
    constructor(program, connection) {
        this.sequenceCache = new Map();
        this.program = program;
        this.connection = connection;
    }
    async getNextSequence(fifoStatePubkey) {
        try {
            const fifoState = await this.program.account.fifoState.fetch(fifoStatePubkey);
            const nextSeq = fifoState.seq.add(new anchor_1.BN(1));
            this.sequenceCache.set(fifoStatePubkey.toBase58(), nextSeq);
            return nextSeq;
        }
        catch (error) {
            // If account doesn't exist yet, start at 1
            if (error.message?.includes('Account does not exist')) {
                return new anchor_1.BN(1);
            }
            throw error;
        }
    }
    async getCurrentSequence(fifoStatePubkey) {
        try {
            const fifoState = await this.program.account.fifoState.fetch(fifoStatePubkey);
            return fifoState.seq;
        }
        catch (error) {
            // If account doesn't exist yet, return 0
            if (error.message?.includes('Account does not exist')) {
                return new anchor_1.BN(0);
            }
            throw error;
        }
    }
    async waitForSequence(fifoStatePubkey, targetSeq) {
        const maxWaitTime = 30000; // 30 seconds timeout
        const pollInterval = 100; // 100ms
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitTime) {
            try {
                const currentSeq = await this.getCurrentSequence(fifoStatePubkey);
                // We can proceed if current sequence is targetSeq - 1
                if (currentSeq.gte(targetSeq.sub(new anchor_1.BN(1)))) {
                    return;
                }
                await this.sleep(pollInterval);
            }
            catch (error) {
                console.warn('Error checking sequence:', error);
                await this.sleep(pollInterval);
            }
        }
        throw new Error(`Timeout waiting for sequence ${targetSeq.toString()}`);
    }
    async subscribeToSequenceUpdates(fifoStatePubkey, callback) {
        return this.connection.onAccountChange(fifoStatePubkey, (accountInfo) => {
            try {
                const decoded = this.program.coder.accounts.decode('FifoState', accountInfo.data);
                callback(new anchor_1.BN(decoded.seq));
            }
            catch (error) {
                console.error('Error decoding FifoState:', error);
            }
        }, 'confirmed');
    }
    unsubscribeFromSequenceUpdates(subscriptionId) {
        this.connection.removeAccountChangeListener(subscriptionId);
    }
    clearCache() {
        this.sequenceCache.clear();
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.SequenceManager = SequenceManager;
//# sourceMappingURL=SequenceManager.js.map