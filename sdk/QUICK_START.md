# Continuum FIFO Wrapper - Quick Start Guide

## 🚀 5-Minute Setup

### 1. Install SDK
```bash
cd sdk
npm install
```

### 2. Configure Wallet
```bash
# Create or use existing wallet
export WALLET_PATH="./test-wallet-devnet.json"
```

### 3. Run Your First Swap
```bash
npx ts-node scripts/examples/basic-swap.ts
```

## 📦 Frontend Integration

### Install Client
```typescript
import { ContinuumSwapClient } from './continuum-client';

const client = new ContinuumSwapClient();
```

### Configure Pool
```typescript
client.setPoolConfig('POOL_ID', {
    poolId: 'FWP3JA31eauPJA6RJftReaus3T75rUZc4xVCgGpz7CQQ',
    // ... other config
});
```

### Execute Swap
```typescript
const tx = await client.buildSwapTransaction(
    wallet.publicKey,
    {
        poolId: 'POOL_ID',
        tokenIn: 'SOL_MINT',
        tokenOut: 'TOKEN_MINT',
        amountIn: 1000000000, // 1 SOL
        slippageBps: 100 // 1%
    }
);

const sig = await wallet.sendTransaction(tx);
```

## 🔑 Key Addresses (Devnet)

```typescript
const ADDRESSES = {
    program: '9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y',
    fifoState: 'E9S7ikGZJASpHTeFupagxJKvmqXyMsbCMp7KfErQbV3D',
    testPool: 'FWP3JA31eauPJA6RJftReaus3T75rUZc4xVCgGpz7CQQ'
};
```

## 📊 Monitor FIFO Queue
```bash
npx ts-node scripts/examples/monitor-fifo.ts
```

## 🔄 Batch Swaps
```bash
npx ts-node scripts/examples/batch-swaps.ts
```

## ⚡ React Hook Example

```tsx
import { useContinuumSwap } from './hooks/useContinuumSwap';

function SwapButton() {
    const { swap, loading, error } = useContinuumSwap();
    const wallet = useWallet();
    
    const handleSwap = async () => {
        const result = await swap(wallet, {
            poolId: 'YOUR_POOL',
            tokenIn: 'TOKEN_A',
            tokenOut: 'TOKEN_B',
            amountIn: 1000000,
            slippageBps: 100
        });
        
        if (result.success) {
            console.log('Swap completed:', result.signature);
        }
    };
    
    return (
        <button onClick={handleSwap} disabled={loading}>
            {loading ? 'Swapping...' : 'Swap'}
        </button>
    );
}
```

## 🛡️ Error Handling

```typescript
try {
    await performSwap();
} catch (error) {
    if (error.message.includes('BadSeq')) {
        // Sequence mismatch - retry
    } else if (error.message.includes('InsufficientBalance')) {
        // Not enough tokens
    } else if (error.message.includes('SlippageExceeded')) {
        // Price moved too much
    }
}
```

## 📚 Full Documentation
See [sdk_testing.md](./sdk_testing.md) for comprehensive guide.