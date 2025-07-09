# Continuum SDK

TypeScript SDK for interacting with the Raydium FIFO ordering wrapper that prevents sandwich attacks and MEV.

## Installation

```bash
cd sdk
npm install
npm run build
```

## Deployment & Setup

### 1. Deploy the Contract

```bash
# Set your RPC and wallet
export RPC_URL=https://api.devnet.solana.com
export WALLET_PATH=~/.config/solana/id.json

# Deploy to devnet
npm run deploy
```

### 2. Initialize FIFO State

```bash
npm run init
```

### 3. Test Swap

```bash
npm run test-swap
```

## Usage

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import { ContinuumSDK, SwapParams, BN } from '@raydium-fair/continuum-sdk';

// Initialize SDK
const connection = new Connection('https://api.devnet.solana.com');
const wallet = new Wallet(keypair);
const sdk = new ContinuumSDK(connection, wallet);

// Perform protected swap
const swapParams: SwapParams = {
  user: keypair,
  userSource: sourceTokenAccount,
  userDestination: destTokenAccount,
  amountIn: new BN(1000000),
  minimumAmountOut: new BN(950000),
  // ... other Raydium pool parameters
};

const signature = await sdk.swap(swapParams);
```

## Features

- **FIFO Ordering**: Enforces strict first-in-first-out transaction ordering
- **MEV Protection**: Prevents sandwich attacks and front-running
- **Automatic Retries**: Handles sequence conflicts gracefully
- **Sequence Monitoring**: Real-time updates on queue position
- **TypeScript Support**: Full type safety and IntelliSense

## API Reference

### `ContinuumSDK`

Main SDK class for interacting with the wrapper.

#### Methods

- `initializeFifoState(payer: Keypair)`: Initialize the global FIFO state
- `swap(params: SwapParams)`: Execute a protected swap
- `swapWithMEVProtection(params, options)`: Swap with additional MEV protection
- `getCurrentSequence()`: Get the current sequence number
- `subscribeToSequenceUpdates(callback)`: Monitor sequence changes

## Architecture

The SDK consists of several core components:

1. **SequenceManager**: Tracks and manages FIFO sequence numbers
2. **TransactionBuilder**: Constructs wrapper transactions
3. **TransactionSubmitter**: Handles submission and retries
4. **MEVProtection**: Additional anti-MEV measures

## Security Considerations

- Always verify the program ID matches the deployed contract
- Token delegation is temporary and revoked immediately after swap
- Sequence enforcement prevents transaction reordering
- Use MEV protection for high-value swaps

## Testing

Run the test suite:

```bash
npm test
```

## License

MIT