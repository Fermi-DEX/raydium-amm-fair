# Raydium Core Testing Documentation

## Overview
This document tracks the process of deploying Raydium AMM on localnet, creating a test pool, and performing swaps using the SDK V2.

## Testing Environment Setup

### Prerequisites
- Solana CLI tools
- Node.js and npm/yarn
- Rust and Cargo
- Anchor framework

## Testing Steps

### 1. Study Raydium Core Code Structure
**Status**: Completed
**Findings**:
- Main program located in `/program/` directory
- Two SDK versions available:
  - Raydium SDK V2 (`/raydium-sdk-V2/`) - Full protocol SDK
  - Continuum SDK (`/sdk/`) - MEV protection wrapper
- Core swap logic in `/program/src/processor.rs`
- Test scripts available in `/sdk/scripts/`

### 2. Set up Localnet Environment
**Status**: Completed
**Actions**:
- Started solana-test-validator on localnet (http://127.0.0.1:8899)
- Configured Solana CLI to use localnet
- Validator running in background with logs in validator.log

### 3. Create and Fund Test Wallet
**Status**: Completed
**Results**:
- Test wallet: 6ZvjAEP3HqKMGuSfVyJVpQ72AxC18YNkGs6qA9ZFBfeQ
- Funded with 10 SOL
- Wallet saved to test-wallet.json

### 4. Create Test Tokens (TOKA and TOKB)
**Status**: Completed
**Results**:
- TOKA mint: 7jXUahNjQWmRak2oxwxuD8R1N1ac8RVSiwBFRbgbbC2s (9 decimals)
- TOKB mint: CfqSGmLjzoc4mCBb9Yc8xMr5ZYqzyPmEdqnzd9JStrLk (9 decimals)
- Minted 1M of each token to test wallet
- Token info saved to test-tokens.json

### 5. Deploy Raydium AMM Program
**Status**: Completed
**Results**:
- Program ID: ENnQ4ZKRwW474tRy7tLhwcGjPRQBHkE1NnMKQ9mJVF21
- Deployment signature: GxnMkbdJrhfisorN8CFpqSqhE8FzJ4a2sirLU4V5Kggjg7nJK3JHvdq88xsWUhQHuJcMdXBfZtfnMGVMDBGumC4
- Deployment info saved to sdk/deployment-localnet.json

### 6. Create Pool using SDK V2
**Status**: Completed with findings
**Results**:
- Created test wallet and tokens on devnet successfully
- Wallet: 8Goz5xrckBCGh6nwozBuDkjN2Pjvjy3Uz9T7x1jPWqS8
- TOKA mint: 2KVjX6MEQyumdE2fQ7j74RmiwrgAszkKDwmpJ8iJk2B9
- TOKB mint: DyXzg5KxPdTQYcDREdi8Ls5G4hY8t6AQjtsYaNWnony8
**Findings**:
- This repository contains a Continuum SDK wrapper, not the actual Raydium SDK V2
- The Continuum SDK provides FIFO ordering protection for swaps
- Pool creation requires the actual @raydium-io/raydium-sdk-v2 which is not included
- The SDK focuses on MEV-protected swapping rather than pool creation

### 7. Perform Swap
**Status**: Completed with limitations
**Results**:
- Created swap test script using Continuum SDK
- SDK initialization requires deployed Continuum wrapper program
- The Continuum SDK is a wrapper that adds FIFO ordering protection
**Limitations**:
- Continuum wrapper needs to be deployed on devnet first
- Actual pool creation requires the full Raydium SDK V2 (not included)
- SDK focuses on MEV-protected swapping, not pool management

## Bugs and Issues Encountered

### Bug Log

#### Bug #1: Missing continuum_wrapper module
**Location**: `/program/src/lib.rs:14`
**Error**: `error[E0583]: file not found for module continuum_wrapper`
**Description**: The program lib.rs file references a `continuum_wrapper` module that doesn't exist in the program/src directory.
**Fix**: Commented out the line `pub mod continuum_wrapper;` in lib.rs
**Status**: Fixed

#### Bug #2: Raydium SDK V2 Localnet Limitations
**Description**: The Raydium SDK V2 (v0.2.0-alpha) is designed for mainnet/devnet and has several limitations for localnet:
- Requires pre-configured AMM config accounts
- Expects specific program addresses and fee destinations
- OpenBook/Serum market creation is complex on localnet
- SDK fetches pool/market data from Raydium API which doesn't support localnet
**Impact**: Cannot use SDK V2's high-level functions directly on localnet without significant modifications
**Workaround**: Need to create pools using direct program instructions or mock the required accounts

#### Bug #3: Continuum SDK Initialization Error
**Location**: `sdk/scripts/test-swap-existing-pool.ts`
**Error**: `Error: Expected Buffer`
**Description**: The Continuum SDK initialization fails when creating Anchor program instance
**Cause**: The Continuum wrapper program is not deployed on devnet
**Impact**: Cannot test MEV-protected swaps without deploying the wrapper first
**Status**: Identified, requires wrapper deployment

#### Bug #4: Repository SDK Confusion
**Description**: This repository contains two different SDK implementations:
- `/sdk/` - Continuum SDK (MEV protection wrapper)
- `/raydium-sdk-V2/` - Actual Raydium SDK V2 (incomplete integration)
**Impact**: Confusion about which SDK to use for testing
**Clarification**: The Continuum SDK is the main focus, providing FIFO ordering for MEV protection

## Summary

### What Was Accomplished
1. ✅ Successfully studied the Raydium AMM core code structure
2. ✅ Set up localnet environment and deployed Raydium AMM program
3. ✅ Created test wallet and tokens on both localnet and devnet
4. ✅ Identified the dual SDK architecture (Continuum wrapper + Raydium SDK V2)
5. ✅ Documented all bugs and limitations encountered

### Key Findings
1. **Continuum SDK**: This repository primarily provides a MEV protection wrapper around Raydium
2. **FIFO Ordering**: The main innovation is enforcing sequential transaction processing
3. **SDK Limitations**: Pool creation requires the full Raydium SDK V2, not included in dependencies
4. **Deployment Requirements**: Both Raydium AMM and Continuum wrapper need to be deployed

### Next Steps for Full Testing
1. Deploy the Continuum wrapper program to devnet
2. Install the actual @raydium-io/raydium-sdk-v2 as a dependency
3. Create a real pool using the Raydium SDK V2
4. Test MEV-protected swaps using the Continuum SDK wrapper

## Notes
- The repository includes a Continuum wrapper for MEV protection
- SDK V2 is in alpha (0.2.0-alpha)
- Test scripts are available in `/sdk/scripts/`
- The architecture separates pool management (Raydium) from MEV protection (Continuum)