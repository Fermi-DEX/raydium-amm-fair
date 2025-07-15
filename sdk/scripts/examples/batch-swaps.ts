#!/usr/bin/env ts-node
import { 
    Connection, 
    Keypair, 
    PublicKey, 
    Transaction,
    sendAndConfirmTransaction
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import BN from 'bn.js';
import { ContinuumSwapClient } from './frontend-integration';
import * as fs from 'fs';
import * as path from 'path';

interface BatchSwapRequest {
    poolId: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    slippageBps: number;
    label?: string;
}

interface BatchSwapResult {
    label?: string;
    success: boolean;
    signature?: string;
    error?: string;
    sequence?: string;
}

class BatchSwapExecutor {
    private client: ContinuumSwapClient;
    private connection: Connection;
    
    constructor(rpcUrl: string = 'https://api.devnet.solana.com') {
        this.client = new ContinuumSwapClient(rpcUrl);
        this.connection = new Connection(rpcUrl, 'confirmed');
    }
    
    /**
     * Execute multiple swaps in sequence
     */
    async executeBatchSwaps(
        wallet: Keypair,
        requests: BatchSwapRequest[]
    ): Promise<BatchSwapResult[]> {
        console.log(`🚀 Executing ${requests.length} swaps in FIFO order...\n`);
        
        const results: BatchSwapResult[] = [];
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < requests.length; i++) {
            const request = requests[i];
            console.log(`\n[${i + 1}/${requests.length}] Processing swap${request.label ? ` "${request.label}"` : ''}...`);
            console.log(`  Pool: ${request.poolId}`);
            console.log(`  Amount: ${request.amountIn}`);
            
            try {
                // Get current sequence before swap
                const sequenceBefore = await this.client.getCurrentSequence();
                
                // Build and send transaction
                const tx = await this.client.buildSwapTransaction(
                    wallet.publicKey,
                    request
                );
                
                const signature = await sendAndConfirmTransaction(
                    this.connection,
                    tx,
                    [wallet],
                    { commitment: 'confirmed' }
                );
                
                // Get sequence after swap
                const sequenceAfter = await this.client.getCurrentSequence();
                
                console.log(`  ✅ Success! Signature: ${signature.slice(0, 20)}...`);
                console.log(`  📊 Sequence: ${sequenceBefore} → ${sequenceAfter}`);
                
                results.push({
                    label: request.label,
                    success: true,
                    signature,
                    sequence: sequenceAfter.toString()
                });
                
                successCount++;
            } catch (error: any) {
                console.log(`  ❌ Failed: ${error.message}`);
                
                results.push({
                    label: request.label,
                    success: false,
                    error: error.message
                });
                
                failCount++;
                
                // Optional: stop on first failure
                // break;
            }
            
            // Small delay between swaps to avoid rate limits
            if (i < requests.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        // Print summary
        console.log('\n' + '═'.repeat(80));
        console.log('📊 Batch Swap Summary:');
        console.log(`  Total: ${requests.length}`);
        console.log(`  ✅ Success: ${successCount}`);
        console.log(`  ❌ Failed: ${failCount}`);
        console.log(`  Success Rate: ${((successCount / requests.length) * 100).toFixed(1)}%`);
        console.log('═'.repeat(80) + '\n');
        
        return results;
    }
    
    /**
     * Execute swaps in parallel (still respecting FIFO order)
     */
    async executeParallelSwaps(
        wallet: Keypair,
        requests: BatchSwapRequest[],
        concurrency: number = 3
    ): Promise<BatchSwapResult[]> {
        console.log(`🚀 Executing ${requests.length} swaps with concurrency ${concurrency}...\n`);
        
        const results: BatchSwapResult[] = new Array(requests.length);
        const executing: Promise<void>[] = [];
        
        for (let i = 0; i < requests.length; i++) {
            const request = requests[i];
            const index = i;
            
            const promise = this.processSwap(wallet, request, index).then(result => {
                results[index] = result;
            });
            
            executing.push(promise);
            
            if (executing.length >= concurrency) {
                await Promise.race(executing);
                executing.splice(executing.findIndex(p => p), 1);
            }
        }
        
        await Promise.all(executing);
        return results;
    }
    
    private async processSwap(
        wallet: Keypair,
        request: BatchSwapRequest,
        index: number
    ): Promise<BatchSwapResult> {
        try {
            const tx = await this.client.buildSwapTransaction(
                wallet.publicKey,
                request
            );
            
            const signature = await sendAndConfirmTransaction(
                this.connection,
                tx,
                [wallet],
                { commitment: 'confirmed' }
            );
            
            return {
                label: request.label,
                success: true,
                signature
            };
        } catch (error: any) {
            return {
                label: request.label,
                success: false,
                error: error.message
            };
        }
    }
}

// Example usage
async function main() {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Load wallet
    const walletPath = path.join(__dirname, '../../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    
    // Load pool config
    const poolConfig = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../../existing-pool-config-devnet.json'), 'utf8')
    );
    
    // Create batch executor
    const executor = new BatchSwapExecutor();
    
    // Configure pool in client
    executor.client.setPoolConfig(poolConfig.poolId, poolConfig);
    
    // Example batch requests
    const batchRequests: BatchSwapRequest[] = [
        {
            poolId: poolConfig.poolId,
            tokenIn: poolConfig.quoteMint, // SOL
            tokenOut: poolConfig.baseMint,
            amountIn: 0.001 * 1e9, // 0.001 SOL
            slippageBps: 100, // 1%
            label: 'Swap 1: SOL → Base'
        },
        {
            poolId: poolConfig.poolId,
            tokenIn: poolConfig.baseMint,
            tokenOut: poolConfig.quoteMint, // SOL
            amountIn: 100 * 1e9, // 100 tokens
            slippageBps: 100,
            label: 'Swap 2: Base → SOL'
        },
        {
            poolId: poolConfig.poolId,
            tokenIn: poolConfig.quoteMint,
            tokenOut: poolConfig.baseMint,
            amountIn: 0.002 * 1e9, // 0.002 SOL
            slippageBps: 200, // 2%
            label: 'Swap 3: SOL → Base (higher slippage)'
        }
    ];
    
    // Execute swaps sequentially
    console.log('🔄 Sequential Execution:\n');
    const sequentialResults = await executor.executeBatchSwaps(wallet, batchRequests);
    
    // Save results
    const resultsPath = path.join(__dirname, '../../batch-swap-results.json');
    fs.writeFileSync(
        resultsPath,
        JSON.stringify({
            timestamp: new Date().toISOString(),
            mode: 'sequential',
            results: sequentialResults
        }, null, 2)
    );
    
    console.log(`\n💾 Results saved to: ${resultsPath}`);
}

// Utility function for creating test batch requests
export function generateTestBatch(
    poolId: string,
    baseToken: string,
    quoteToken: string,
    count: number
): BatchSwapRequest[] {
    const requests: BatchSwapRequest[] = [];
    
    for (let i = 0; i < count; i++) {
        const isEven = i % 2 === 0;
        requests.push({
            poolId,
            tokenIn: isEven ? quoteToken : baseToken,
            tokenOut: isEven ? baseToken : quoteToken,
            amountIn: (0.001 + i * 0.0001) * 1e9, // Increasing amounts
            slippageBps: 100,
            label: `Test Swap ${i + 1}`
        });
    }
    
    return requests;
}

if (require.main === module) {
    main().catch(console.error);
}