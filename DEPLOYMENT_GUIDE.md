# Continuum Wrapper Deployment Guide

This guide walks through deploying and testing the Raydium FIFO ordering wrapper on Solana devnet.

## Prerequisites

- Solana CLI tools installed
- Rust and cargo-build-sbf installed
- Node.js 16+ and npm
- A Solana wallet with at least 2 SOL for deployment

## Step 1: Build Everything

```bash
./build.sh
```

This will:
- Build the Rust smart contract
- Install SDK dependencies
- Compile the TypeScript SDK

## Step 2: Deploy to Devnet

```bash
cd sdk
export NETWORK=devnet
export RPC_URL=https://api.devnet.solana.com
export WALLET_PATH=~/.config/solana/id.json

npm run deploy
```

This will:
- Deploy the continuum_wrapper program
- Save the program ID to `sdk/config.json`

## Step 3: Initialize FIFO State

```bash
npm run init
```

This creates the global FIFO state account that tracks the sequence number.

## Step 4: Test the System

```bash
npm run test-swap
```

This will attempt a test swap on devnet using the RAY-SOL pool.

## How It Works

1. **Sequence Enforcement**: Every swap must include the next sequential number
2. **Temporary Delegation**: Users approve a PDA to spend tokens only during the swap
3. **Immediate Revocation**: Token approval is revoked after the Raydium CPI
4. **FIFO Ordering**: Transactions are processed in strict order, preventing sandwiching

## Integration Example

```typescript
import { ContinuumSDK } from '@raydium-fair/continuum-sdk';

// Initialize SDK
const sdk = new ContinuumSDK(connection, wallet);

// Perform protected swap
const signature = await sdk.swap({
  user: keypair,
  userSource: sourceTokenAccount,
  userDestination: destTokenAccount,
  amountIn: new BN(1000000),
  minimumAmountOut: new BN(950000),
  // ... pool parameters
});
```

## Security Notes

1. **Program Authority**: Should be burned after audit
2. **PDA Security**: The delegate PDA has no private key
3. **Atomic Operations**: Approval and revocation happen in same instruction
4. **Sequence Gaps**: Any gap causes transaction failure

## Monitoring

Monitor the FIFO state account to see:
- Current sequence number
- Transaction throughput
- Queue depth

## Troubleshooting

### "BadSeq" Error
- The sequence number doesn't match expected
- SDK automatically retries with fresh sequence

### "Account does not exist"
- FIFO state not initialized
- Run `npm run init`

### Insufficient Balance
- Need SOL for deployment (~1-2 SOL)
- Need SOL for transaction fees

## Production Considerations

1. **RPC Endpoints**: Use dedicated nodes for production
2. **Sequence Coordination**: Consider a sequencer service
3. **Monitoring**: Set up alerts for sequence gaps
4. **Rate Limiting**: Implement client-side rate limits

## Next Steps

1. Audit the smart contract
2. Burn upgrade authority
3. Deploy to mainnet
4. Integrate with Raydium UI
5. Add liquidity provider incentives