# Continuum FIFO Wrapper SDK Testing Guide

## Overview
This guide provides step-by-step instructions for integrating and testing the Continuum FIFO wrapper SDK. The wrapper enforces First-In-First-Out ordering for Raydium swaps to prevent MEV attacks and sandwich trading.

## Prerequisites

### 1. Install Dependencies
```bash
cd sdk
npm install
```

### 2. Set Up Wallet
Create a test wallet for devnet:
```bash
# Generate new wallet or use existing
solana-keygen new --outfile test-wallet-devnet.json
```

### 3. Get Devnet SOL
```bash
solana airdrop 2 --url devnet --keypair test-wallet-devnet.json
```

## Core Components

### Program Addresses (Devnet)
```typescript
const CONTINUUM_PROGRAM_ID = "9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y";
const FIFO_STATE = "E9S7ikGZJASpHTeFupagxJKvmqXyMsbCMp7KfErQbV3D";
const RAYDIUM_AMM_V4 = "HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8";
```

## Step-by-Step Integration

### 1. Initialize SDK

```typescript
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ContinuumSDK } from './src/ContinuumSDK';

// Initialize connection
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Load wallet
const wallet = Keypair.fromSecretKey(/* your wallet secret key */);

// Initialize SDK
const sdk = new ContinuumSDK({
    connection,
    wallet,
    programId: new PublicKey(CONTINUUM_PROGRAM_ID),
    fifoState: new PublicKey(FIFO_STATE),
});
```

### 2. Basic Swap Example

```typescript
// scripts/examples/basic-swap.ts
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';

const CONTINUUM_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');
const FIFO_STATE = new PublicKey('E9S7ikGZJASpHTeFupagxJKvmqXyMsbCMp7KfErQbV3D');

async function performSwap() {
    // Setup
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const wallet = Keypair.fromSecretKey(/* your wallet secret key */);
    
    // Pool and token configuration
    const poolId = new PublicKey('YOUR_POOL_ID');
    const tokenA = new PublicKey('TOKEN_A_MINT');
    const tokenB = new PublicKey('TOKEN_B_MINT');
    
    // Get user token accounts
    const userTokenA = await getAssociatedTokenAddress(tokenA, wallet.publicKey);
    const userTokenB = await getAssociatedTokenAddress(tokenB, wallet.publicKey);
    
    // Swap parameters
    const amountIn = new BN(1000000); // 1 token (assuming 6 decimals)
    const minAmountOut = new BN(0); // Set appropriate slippage
    
    // Build swap transaction
    const swapTx = await buildSwapTransaction({
        connection,
        wallet: wallet.publicKey,
        poolId,
        userSource: userTokenA,
        userDestination: userTokenB,
        amountIn,
        minAmountOut,
    });
    
    // Send transaction
    const signature = await connection.sendTransaction(swapTx, [wallet]);
    await connection.confirmTransaction(signature);
    
    console.log('Swap completed:', signature);
}
```

### 3. Frontend Integration Example

```typescript
// scripts/examples/frontend-integration.ts
import { 
    Connection, 
    PublicKey, 
    Transaction,
    TransactionInstruction,
    ComputeBudgetProgram 
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import BN from 'bn.js';

export class ContinuumSwapClient {
    private connection: Connection;
    private programId: PublicKey;
    private fifoState: PublicKey;
    
    constructor(rpcUrl: string = 'https://api.devnet.solana.com') {
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.programId = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');
        this.fifoState = new PublicKey('E9S7ikGZJASpHTeFupagxJKvmqXyMsbCMp7KfErQbV3D');
    }
    
    /**
     * Build a swap transaction
     * @param walletPubkey - User's wallet public key
     * @param poolId - Raydium pool ID
     * @param tokenInMint - Input token mint
     * @param tokenOutMint - Output token mint
     * @param amountIn - Amount to swap (in token units)
     * @param slippageBps - Slippage tolerance in basis points (e.g., 100 = 1%)
     */
    async buildSwapTransaction(
        walletPubkey: PublicKey,
        poolId: PublicKey,
        tokenInMint: PublicKey,
        tokenOutMint: PublicKey,
        amountIn: number,
        slippageBps: number = 100
    ): Promise<Transaction> {
        // Get token accounts
        const userTokenIn = await getAssociatedTokenAddress(tokenInMint, walletPubkey);
        const userTokenOut = await getAssociatedTokenAddress(tokenOutMint, walletPubkey);
        
        // Get current sequence
        const sequence = await this.getCurrentSequence();
        const nextSequence = sequence + 1n;
        
        // Calculate minimum amount out (with slippage)
        const estimatedOut = await this.estimateSwapOutput(poolId, tokenInMint, amountIn);
        const minAmountOut = estimatedOut * (10000 - slippageBps) / 10000;
        
        // Build transaction
        const tx = new Transaction();
        
        // Add compute budget
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
        
        // Add swap instruction
        const swapIx = await this.buildSwapInstruction({
            wallet: walletPubkey,
            poolId,
            userSource: userTokenIn,
            userDestination: userTokenOut,
            amountIn: new BN(amountIn),
            minAmountOut: new BN(minAmountOut),
            sequence: nextSequence,
        });
        
        tx.add(swapIx);
        
        // Set recent blockhash
        const { blockhash } = await this.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = walletPubkey;
        
        return tx;
    }
    
    /**
     * Get current FIFO sequence number
     */
    async getCurrentSequence(): Promise<bigint> {
        const account = await this.connection.getAccountInfo(this.fifoState);
        if (!account) throw new Error('FIFO state not found');
        return account.data.readBigUInt64LE(8);
    }
    
    /**
     * Estimate swap output amount
     */
    async estimateSwapOutput(
        poolId: PublicKey,
        tokenInMint: PublicKey,
        amountIn: number
    ): Promise<number> {
        // This is a placeholder - implement actual calculation based on pool reserves
        // For production, you would fetch pool state and calculate output
        return amountIn * 0.98; // Mock 2% price impact
    }
    
    /**
     * Build swap instruction
     */
    private async buildSwapInstruction(params: {
        wallet: PublicKey;
        poolId: PublicKey;
        userSource: PublicKey;
        userDestination: PublicKey;
        amountIn: BN;
        minAmountOut: BN;
        sequence: bigint;
    }): Promise<TransactionInstruction> {
        // Implementation details here
        // This would include all the account resolution and instruction building
        throw new Error('See full implementation in SDK');
    }
}

// Usage in React/Next.js frontend
export async function swapTokens(
    wallet: any, // Wallet adapter
    poolId: string,
    tokenIn: string,
    tokenOut: string,
    amount: number,
    slippage: number
) {
    const client = new ContinuumSwapClient();
    
    try {
        const tx = await client.buildSwapTransaction(
            wallet.publicKey,
            new PublicKey(poolId),
            new PublicKey(tokenIn),
            new PublicKey(tokenOut),
            amount,
            slippage
        );
        
        // Sign and send with wallet adapter
        const signature = await wallet.sendTransaction(tx, client.connection);
        await client.connection.confirmTransaction(signature);
        
        return { success: true, signature };
    } catch (error) {
        console.error('Swap failed:', error);
        return { success: false, error };
    }
}
```

### 4. Advanced Features

#### Batch Swaps
```typescript
// scripts/examples/batch-swaps.ts
async function batchSwaps(swapRequests: SwapRequest[]) {
    const client = new ContinuumSwapClient();
    const results = [];
    
    for (const request of swapRequests) {
        try {
            // Each swap gets sequential FIFO ordering
            const tx = await client.buildSwapTransaction(
                request.wallet,
                request.poolId,
                request.tokenIn,
                request.tokenOut,
                request.amount,
                request.slippage
            );
            
            const signature = await sendTransaction(tx);
            results.push({ success: true, signature });
        } catch (error) {
            results.push({ success: false, error });
        }
    }
    
    return results;
}
```

#### MEV Protection Status
```typescript
// scripts/examples/check-mev-protection.ts
async function checkMEVProtection() {
    const client = new ContinuumSwapClient();
    
    // Get current sequence
    const sequence = await client.getCurrentSequence();
    console.log('Current FIFO sequence:', sequence);
    
    // Monitor sequence progression
    const monitor = setInterval(async () => {
        const newSeq = await client.getCurrentSequence();
        if (newSeq > sequence) {
            console.log(`Sequence advanced: ${sequence} -> ${newSeq}`);
            console.log(`${newSeq - sequence} swaps processed`);
        }
    }, 1000);
}
```

## Testing Scripts

### 1. Test Token Creation
```bash
npx ts-node scripts/create-test-tokens.ts
```

### 2. Test Pool Setup
```bash
npx ts-node scripts/use-existing-pool.ts
```

### 3. Test Swap Execution
```bash
npx ts-node scripts/test-real-swap.ts
```

### 4. Monitor FIFO Queue
```bash
npx ts-node scripts/monitor-fifo.ts
```

## Common Integration Patterns

### 1. Wallet Adapter Integration
```typescript
import { useWallet } from '@solana/wallet-adapter-react';
import { ContinuumSwapClient } from './continuum-client';

function SwapComponent() {
    const wallet = useWallet();
    const [loading, setLoading] = useState(false);
    
    const handleSwap = async () => {
        if (!wallet.publicKey) return;
        
        setLoading(true);
        try {
            const client = new ContinuumSwapClient();
            const tx = await client.buildSwapTransaction(
                wallet.publicKey,
                poolId,
                tokenIn,
                tokenOut,
                amount,
                slippage
            );
            
            const sig = await wallet.sendTransaction(tx, connection);
            await connection.confirmTransaction(sig);
            
            toast.success('Swap successful!');
        } catch (error) {
            toast.error('Swap failed');
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <button onClick={handleSwap} disabled={loading}>
            {loading ? 'Swapping...' : 'Swap'}
        </button>
    );
}
```

### 2. Price Impact Calculation
```typescript
async function calculatePriceImpact(
    poolId: PublicKey,
    tokenIn: PublicKey,
    amountIn: number
): Promise<number> {
    // Fetch pool reserves
    const pool = await fetchPoolState(poolId);
    
    // Calculate output amount
    const reserveIn = tokenIn.equals(pool.tokenA) ? pool.reserveA : pool.reserveB;
    const reserveOut = tokenIn.equals(pool.tokenA) ? pool.reserveB : pool.reserveA;
    
    const amountOut = (amountIn * reserveOut) / (reserveIn + amountIn);
    const priceImpact = (amountIn / reserveIn) * 100;
    
    return priceImpact;
}
```

### 3. Transaction Status Tracking
```typescript
async function trackTransaction(signature: string) {
    const client = new ContinuumSwapClient();
    
    // Initial status
    let status = await connection.getSignatureStatus(signature);
    
    // Poll for confirmation
    while (!status?.value?.confirmationStatus || 
           status.value.confirmationStatus !== 'finalized') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await connection.getSignatureStatus(signature);
    }
    
    // Get transaction details
    const tx = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0
    });
    
    return {
        confirmed: true,
        slot: tx?.slot,
        logs: tx?.meta?.logMessages
    };
}
```

## Error Handling

### Common Errors and Solutions

1. **Sequence Mismatch**
   ```typescript
   try {
       await performSwap();
   } catch (error) {
       if (error.message.includes('BadSeq')) {
           // Retry with updated sequence
           const newSeq = await client.getCurrentSequence();
           await performSwap(newSeq + 1n);
       }
   }
   ```

2. **Insufficient Balance**
   ```typescript
   // Check balances before swap
   const balance = await getTokenBalance(userTokenAccount);
   if (balance < amountIn) {
       throw new Error('Insufficient balance');
   }
   ```

3. **Pool Not Found**
   ```typescript
   const poolExists = await checkPoolExists(poolId);
   if (!poolExists) {
       throw new Error('Pool not found or not supported');
   }
   ```

## Production Considerations

### 1. RPC Optimization
```typescript
// Use dedicated RPC for better performance
const connection = new Connection(process.env.RPC_URL, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000,
});
```

### 2. Retry Logic
```typescript
async function swapWithRetry(params: SwapParams, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await performSwap(params);
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}
```

### 3. Gas Optimization
```typescript
// Set appropriate compute units
tx.add(ComputeBudgetProgram.setComputeUnitLimit({ 
    units: 300000 // Optimize based on testing
}));

// Set priority fee for faster inclusion
tx.add(ComputeBudgetProgram.setComputeUnitPrice({ 
    microLamports: 1000 
}));
```

## Monitoring and Analytics

### Track Swap Metrics
```typescript
interface SwapMetrics {
    totalSwaps: number;
    totalVolume: number;
    averageSlippage: number;
    failureRate: number;
}

async function collectMetrics(): Promise<SwapMetrics> {
    // Implementation for tracking swap performance
    return {
        totalSwaps: await getTotalSwaps(),
        totalVolume: await getTotalVolume(),
        averageSlippage: await getAverageSlippage(),
        failureRate: await getFailureRate(),
    };
}
```

## Support and Resources

- **Documentation**: See `/docs` folder for detailed API documentation
- **Examples**: Check `/scripts/examples` for more integration examples
- **Tests**: Run `npm test` to see test implementations
- **Issues**: Report issues in the project repository

## Next Steps

1. **Test on Devnet**: Use the provided test tokens and pools
2. **Integrate Frontend**: Use the client examples for your DApp
3. **Monitor Performance**: Track FIFO sequence and swap success rates
4. **Deploy to Mainnet**: Once tested, deploy with production pool authority

Remember: The wrapper enforces FIFO ordering, preventing MEV attacks while maintaining the familiar Raydium swap interface. All swaps must go through the Continuum wrapper to maintain ordering guarantees.