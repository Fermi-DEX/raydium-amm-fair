"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContinuumSDK = void 0;
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const SequenceManager_1 = require("./core/SequenceManager");
const TransactionBuilder_1 = require("./core/TransactionBuilder");
const TransactionSubmitter_1 = require("./core/TransactionSubmitter");
const MEVProtection_1 = require("./core/MEVProtection");
const continuum_wrapper_json_1 = __importDefault(require("./idl/continuum_wrapper.json"));
class ContinuumSDK {
    constructor(connection, wallet, config) {
        this.connection = connection;
        // Set up Anchor provider
        const provider = new anchor_1.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
        (0, anchor_1.setProvider)(provider);
        // Initialize config with defaults
        this.config = {
            connection,
            wrapperProgramId: new web3_js_1.PublicKey(config?.wrapperProgramId || continuum_wrapper_json_1.default.address),
            raydiumProgramId: new web3_js_1.PublicKey(config?.raydiumProgramId || '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8')
        };
        // Initialize program
        this.program = new anchor_1.Program(continuum_wrapper_json_1.default, provider);
        // Initialize core components
        this.sequenceManager = new SequenceManager_1.SequenceManager(this.program, connection);
        this.transactionBuilder = new TransactionBuilder_1.ContinuumTransactionBuilder(this.program, this.sequenceManager, this.config);
        this.transactionSubmitter = new TransactionSubmitter_1.ContinuumTransactionSubmitter(connection, this.transactionBuilder, this.sequenceManager);
        this.mevProtection = new MEVProtection_1.MEVProtection(connection);
    }
    /**
     * Initialize the FIFO state account (only needs to be done once)
     */
    async initializeFifoState(payer) {
        const tx = await this.transactionBuilder.buildInitializeFifoStateTransaction();
        if (tx.instructions.length === 0) {
            console.log("FIFO state already initialized");
            return "";
        }
        return await this.transactionSubmitter.submitTransaction(tx, payer);
    }
    /**
     * Perform a protected swap through the FIFO wrapper
     */
    async swap(params) {
        // Get FIFO state PDA
        const [fifoState] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("fifo_state")], this.config.wrapperProgramId);
        // Get next sequence and wait for our turn
        const nextSeq = await this.sequenceManager.getNextSequence(fifoState);
        console.log(`Waiting for sequence ${nextSeq.toString()}...`);
        await this.sequenceManager.waitForSequence(fifoState, nextSeq);
        console.log("Our turn! Submitting swap...");
        // Submit swap with automatic retry on sequence conflicts
        const signature = await this.transactionSubmitter.submitSwapWithRetry(params);
        console.log(`Swap submitted: ${signature}`);
        return signature;
    }
    /**
     * Perform a protected swap with additional MEV protection
     */
    async swapWithMEVProtection(params, options) {
        // Enable Jito if requested
        if (options?.useJito) {
            this.mevProtection.enableJitoBundle();
        }
        // Build transaction
        const tx = await this.transactionBuilder.buildSwapTransaction(params);
        // Schedule for optimal slot
        const targetSlot = await this.mevProtection.estimateOptimalSlot(options?.priority || 'medium');
        // Submit with MEV protection
        const signature = await this.mevProtection.scheduleTransaction(tx, targetSlot, [params.user]);
        return signature;
    }
    /**
     * Get current sequence number
     */
    async getCurrentSequence() {
        const [fifoState] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("fifo_state")], this.config.wrapperProgramId);
        return await this.sequenceManager.getCurrentSequence(fifoState);
    }
    /**
     * Subscribe to sequence updates
     */
    subscribeToSequenceUpdates(callback) {
        const [fifoState] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("fifo_state")], this.config.wrapperProgramId);
        return this.sequenceManager.subscribeToSequenceUpdates(fifoState, callback);
    }
    /**
     * Unsubscribe from sequence updates
     */
    unsubscribeFromSequenceUpdates(subscriptionId) {
        this.sequenceManager.unsubscribeFromSequenceUpdates(subscriptionId);
    }
    /**
     * Get program instance for advanced usage
     */
    getProgram() {
        return this.program;
    }
    /**
     * Get connection instance
     */
    getConnection() {
        return this.connection;
    }
    /**
     * Get config
     */
    getConfig() {
        return this.config;
    }
}
exports.ContinuumSDK = ContinuumSDK;
//# sourceMappingURL=ContinuumSDK.js.map