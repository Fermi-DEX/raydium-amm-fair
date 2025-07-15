#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import chalk from 'chalk';

const CONTINUUM_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');
const FIFO_STATE = new PublicKey('E9S7ikGZJASpHTeFupagxJKvmqXyMsbCMp7KfErQbV3D');

interface FifoState {
    initialized: boolean;
    sequence: bigint;
    admin: PublicKey;
}

class FifoMonitor {
    private connection: Connection;
    private lastSequence: bigint | null = null;
    private startTime: number;
    private swapCount: number = 0;
    
    constructor(rpcUrl: string = 'https://api.devnet.solana.com') {
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.startTime = Date.now();
    }
    
    async start() {
        console.log(chalk.green('🚀 Starting FIFO Queue Monitor\n'));
        console.log(chalk.cyan('Program ID:'), CONTINUUM_PROGRAM_ID.toBase58());
        console.log(chalk.cyan('FIFO State:'), FIFO_STATE.toBase58());
        console.log(chalk.gray('─'.repeat(80)) + '\n');
        
        // Initial state
        await this.checkState();
        
        // Monitor loop
        setInterval(() => this.checkState(), 1000);
        
        // Stats every 30 seconds
        setInterval(() => this.printStats(), 30000);
    }
    
    private async checkState() {
        try {
            const account = await this.connection.getAccountInfo(FIFO_STATE);
            if (!account) {
                console.error(chalk.red('❌ FIFO state account not found'));
                return;
            }
            
            const state = this.decodeFifoState(account.data);
            
            if (this.lastSequence === null) {
                console.log(chalk.yellow('📊 Initial State:'));
                console.log(chalk.white(`   Sequence: ${state.sequence}`));
                console.log(chalk.white(`   Admin: ${state.admin.toBase58()}\n`));
                this.lastSequence = state.sequence;
            } else if (state.sequence > this.lastSequence) {
                const diff = state.sequence - this.lastSequence;
                this.swapCount += Number(diff);
                
                const timestamp = new Date().toISOString();
                console.log(chalk.green(`✅ [${timestamp}] New swaps detected!`));
                console.log(chalk.white(`   Previous sequence: ${this.lastSequence}`));
                console.log(chalk.white(`   Current sequence: ${state.sequence}`));
                console.log(chalk.yellow(`   Swaps processed: ${diff}`));
                
                // Calculate rate
                const elapsed = (Date.now() - this.startTime) / 1000;
                const rate = this.swapCount / elapsed;
                console.log(chalk.cyan(`   Average rate: ${rate.toFixed(2)} swaps/second\n`));
                
                this.lastSequence = state.sequence;
            }
        } catch (error) {
            console.error(chalk.red('Error checking state:'), error);
        }
    }
    
    private decodeFifoState(data: Buffer): FifoState {
        return {
            initialized: data[0] === 1,
            sequence: data.readBigUInt64LE(8),
            admin: new PublicKey(data.slice(16, 48))
        };
    }
    
    private printStats() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        const minutes = Math.floor(elapsed / 60);
        const seconds = Math.floor(elapsed % 60);
        
        console.log(chalk.gray('─'.repeat(80)));
        console.log(chalk.blue('📈 Statistics:'));
        console.log(chalk.white(`   Runtime: ${minutes}m ${seconds}s`));
        console.log(chalk.white(`   Total swaps: ${this.swapCount}`));
        console.log(chalk.white(`   Current sequence: ${this.lastSequence || 'N/A'}`));
        console.log(chalk.white(`   Average rate: ${(this.swapCount / elapsed).toFixed(2)} swaps/second`));
        console.log(chalk.gray('─'.repeat(80)) + '\n');
    }
}

// Additional monitoring functions
async function getRecentTransactions(programId: PublicKey, limit: number = 10) {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    console.log(chalk.blue('\n📜 Recent Transactions:'));
    
    try {
        const signatures = await connection.getSignaturesForAddress(programId, { limit });
        
        for (const sig of signatures) {
            const tx = await connection.getTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0
            });
            
            if (tx && tx.meta && !tx.meta.err) {
                console.log(chalk.green(`\n✅ ${sig.signature}`));
                console.log(chalk.gray(`   Slot: ${sig.slot}`));
                console.log(chalk.gray(`   Time: ${new Date(sig.blockTime! * 1000).toISOString()}`));
                
                // Extract logs
                if (tx.meta.logMessages) {
                    const swapLogs = tx.meta.logMessages.filter(log => 
                        log.includes('swap') || log.includes('Sequence')
                    );
                    if (swapLogs.length > 0) {
                        console.log(chalk.yellow('   Logs:'));
                        swapLogs.forEach(log => console.log(chalk.gray(`     ${log}`)));
                    }
                }
            }
        }
    } catch (error) {
        console.error(chalk.red('Error fetching transactions:'), error);
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--transactions') || args.includes('-t')) {
        await getRecentTransactions(CONTINUUM_PROGRAM_ID);
    } else {
        const monitor = new FifoMonitor();
        await monitor.start();
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log(chalk.yellow('\n\n👋 Shutting down monitor...'));
            process.exit(0);
        });
    }
}

main().catch(console.error);