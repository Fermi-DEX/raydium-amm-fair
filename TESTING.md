# Continuum Wrapper Testing Guide

This guide documents the complete setup and testing process for the Raydium AMM Continuum FIFO wrapper on localnet.

## Prerequisites

- Solana CLI tools installed
- Node.js 16+ and npm
- Running Solana test validator (`solana-test-validator`)

## Quick Start

For a complete automated setup, run these scripts in order:

```bash
cd sdk

# 1. Setup test environment (wallets, tokens, airdrops)
npx ts-node scripts/setup-test-env.ts

# 2. Setup mock Raydium pool
npx ts-node scripts/setup-raydium-pool.ts

# 3. Initialize continuum wrapper FIFO state
npx ts-node scripts/init-simple.ts

# 4. Run test swap
npx ts-node scripts/test-continuum-swap.ts
```

## Detailed Setup Steps

### 1. Start Local Validator

```bash
# Start the validator (in a separate terminal)
solana-test-validator --reset
```

### 2. Configure Solana CLI

```bash
solana config set --url localhost
```

### 3. Deploy Continuum Wrapper

```bash
# Build the program
cd /home/ubuntu/frm_may/fairswap/raydium-amm-fair
cargo build-sbf -- -p continuum_wrapper

# Deploy to localnet
solana program deploy target/deploy/continuum_wrapper.so --program-id 57tjWXQW4XuhSZd1LnBLPLkC3ZdCUkZsGYReGjG2tPTW
```

### 4. Run Automated Test Setup

```bash
cd sdk

# This script will:
# - Create test wallets (trader and token authority)
# - Airdrop SOL to all wallets
# - Create two test tokens (TEST-A and TEST-B)
# - Mint tokens and distribute to test accounts
npx ts-node scripts/setup-test-env.ts
```

After running, you'll have:
- Test trader wallet: `~/.config/solana/test-trader.json`
- Token authority wallet: `~/.config/solana/token-authority.json`
- Two test tokens with 9 decimals
- Test configuration saved to `sdk/test-config.json`

### 5. Setup Mock Raydium Pool

```bash
# This creates a mock pool configuration for testing
npx ts-node scripts/setup-raydium-pool.ts
```

This saves pool configuration to `sdk/test-pool-config.json`

### 6. Initialize FIFO State

```bash
# Initialize the continuum wrapper's FIFO state
npx ts-node scripts/init-simple.ts
```

## Running Tests

### Basic Swap Test

```bash
# This will perform a test swap through the continuum wrapper
npx ts-node scripts/test-continuum-swap.ts
```

### What the Test Does

1. Loads test configuration (wallets, tokens, pool)
2. Checks current FIFO sequence number
3. Creates a swap transaction that:
   - Approves the delegate PDA to spend tokens
   - Wraps a Raydium swap instruction with FIFO sequencing
   - Ensures the delegate authority is revoked after swap
4. Verifies the sequence number incremented
5. Checks final token balances

## Test Accounts Created

After running the setup scripts, you'll have:

### Wallets
- **Main Wallet**: `GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq`
- **Test Trader**: `FLTSEDYd5QX2TkCttsq2P3Cx5iFTs4HQNrH5bv79p2PL`
- **Token Authority**: `5rVf9WVDUxFe4XU6xP4Aq9igHiFQSzV9XyJGvi4EucDS`

### Tokens
- **Token A**: `4SM79HofRhirwsmNaPeV18yDsXLv9ARjaTn5DrpNYfsf`
- **Token B**: `DZ78EWuui1XiQc7VaZSDmu4giGAqga1UWasUtYBP2EqE`

### Program Accounts
- **Continuum Wrapper**: `57tjWXQW4XuhSZd1LnBLPLkC3ZdCUkZsGYReGjG2tPTW`
- **FIFO State PDA**: `J8BUJiA44s3LLaWJB7Rt7DKXaEYSP8UYFvkvuvkpg4kW`

## Running Tests

### 1. Basic Integration Test

```bash
# Test the wrapper instruction building
npx ts-node scripts/test-raydium-integration.ts
```

### 2. Full Swap Test

```bash
# Run with test trader wallet
WALLET_PATH=~/.config/solana/test-trader.json npm run test-swap
```

### 3. Concurrent Swap Test

Test FIFO ordering with multiple simultaneous swaps:

```bash
# Run multiple swap attempts in parallel
npm run test-concurrent
```

## Test Scenarios

### Scenario 1: Basic Sequential Swaps
1. Trader A swaps TOKEN_A for TOKEN_B (seq=1)
2. Trader B swaps TOKEN_B for TOKEN_A (seq=2)
3. Verify sequences are enforced

### Scenario 2: Out-of-Order Rejection
1. Attempt to submit swap with seq=3 before seq=2
2. Verify transaction fails with BadSeq error

### Scenario 3: Delegate Authority Test
1. Verify delegate PDA has no permanent spending authority
2. Confirm allowance is revoked after each swap

### Scenario 4: MEV Protection
1. Submit multiple swaps rapidly
2. Verify FIFO ordering prevents sandwich attacks

## Verification Steps

After each test:

1. Check FIFO state sequence:
   ```bash
   solana account J8BUJiA44s3LLaWJB7Rt7DKXaEYSP8UYFvkvuvkpg4kW
   ```

2. Verify token balances:
   ```bash
   spl-token accounts
   ```

3. Check transaction logs:
   ```bash
   solana logs --url localhost
   ```

## Troubleshooting

### Common Issues

1. **BadSeq Error**: The sequence number doesn't match expected. Check current sequence and retry.

2. **Insufficient Balance**: Ensure test wallets have enough SOL and tokens.

3. **Program Not Found**: Verify the program is deployed to the correct address.

4. **Token Account Missing**: Create associated token accounts before swapping.

## Cleanup

To reset the test environment:

```bash
# Stop and restart validator
solana-test-validator --reset

# Redeploy programs and reinitialize
```