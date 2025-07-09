"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEVProtection = void 0;
const helpers_1 = require("../utils/helpers");
class MEVProtection {
    constructor(connection) {
        this.useJitoBundle = false;
        this.jitoTipAmount = 1000; // lamports
        this.connection = connection;
    }
    async sendProtectedTransaction(tx, signers, options) {
        // Sign transaction
        tx.sign(...signers);
        // Use lower commitment level for reduced visibility
        const sendOptions = {
            skipPreflight: true,
            preflightCommitment: 'processed',
            maxRetries: 0,
            ...options
        };
        // Send transaction with minimal visibility
        const signature = await this.connection.sendRawTransaction(tx.serialize(), sendOptions);
        return signature;
    }
    async scheduleTransaction(tx, targetSlot, signers) {
        // Get current slot
        const currentSlot = await this.connection.getSlot();
        // Calculate delay (approximately 400ms per slot)
        const slotsToWait = targetSlot - currentSlot;
        const delay = Math.max(0, slotsToWait * 400);
        console.log(`Waiting ${delay}ms for slot ${targetSlot} (current: ${currentSlot})`);
        if (delay > 0) {
            await (0, helpers_1.sleep)(delay);
        }
        // Send transaction
        return this.sendProtectedTransaction(tx, signers);
    }
    async sendWithBackrun(tx, signers, backrunDelay = 50 // ms
    ) {
        // Send main transaction
        const signature = await this.sendProtectedTransaction(tx, signers);
        // Small delay to allow transaction to propagate
        await (0, helpers_1.sleep)(backrunDelay);
        return signature;
    }
    async monitorMempool(callback, filter) {
        // Note: This is a simplified version. Real mempool monitoring
        // would require access to validator mempool or specialized RPC
        console.warn("Mempool monitoring requires specialized RPC access");
        // Return dummy subscription ID
        return 0;
    }
    enableJitoBundle(tipAmount) {
        this.useJitoBundle = true;
        if (tipAmount) {
            this.jitoTipAmount = tipAmount;
        }
        console.log("Jito bundle protection enabled (requires Jito RPC endpoint)");
    }
    disableJitoBundle() {
        this.useJitoBundle = false;
    }
    async estimateOptimalSlot(priority = 'medium') {
        const currentSlot = await this.connection.getSlot();
        // Add slots based on priority
        const slotsToAdd = {
            'low': 5, // ~2 seconds
            'medium': 2, // ~800ms
            'high': 0 // immediate
        };
        return currentSlot + slotsToAdd[priority];
    }
    async getRecentPriorityFees() {
        // Get recent priority fees to estimate optimal fee
        try {
            const recentBlockhash = await this.connection.getRecentBlockhash();
            // In production, you would analyze recent transactions
            // to determine optimal priority fee
            return 1000; // Default 1000 lamports
        }
        catch (error) {
            console.error("Error fetching priority fees:", error);
            return 1000;
        }
    }
}
exports.MEVProtection = MEVProtection;
//# sourceMappingURL=MEVProtection.js.map