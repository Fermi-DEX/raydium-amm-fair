# Raydium AMM FIFO Wrapper - Work in Progress

## Overview
This document tracks the development progress of the Continuum wrapper for Raydium AMM, which enforces FIFO (First-In-First-Out) ordering to prevent sandwich attacks and MEV exploitation.

## Completed Work

### 1. Smart Contract Development (V2)
- **Continuum Wrapper** (`continuum-wrapper/src/lib.rs`): Enhanced Anchor program implementing:
  - Global monotonic sequence counter for FIFO ordering
  - Pool authority control to prevent bypass
  - Dual signing mechanism (delegate + pool authority)
  - Temporary delegation with immediate revocation
  - CPI integration with Raydium AMM programs
  - Program ID: `9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y`

### 2. SDK Implementation
- **ContinuumSDK** (`sdk/src/ContinuumSDK.ts`): TypeScript SDK providing:
  - Sequence management with optimistic caching
  - Transaction building with proper account ordering
  - Automatic retry logic for sequence conflicts
  - MEV protection layer with slot scheduling
  - Integration with Raydium SDK V2

### 3. Core Components
- **SequenceManager** (`sdk/src/core/SequenceManager.ts`): Handles FIFO sequence tracking and synchronization
- **TransactionBuilder** (`sdk/src/core/TransactionBuilder.ts`): Constructs properly formatted wrapper transactions
- **TransactionSubmitter** (`sdk/src/core/TransactionSubmitter.ts`): Manages transaction submission with retry logic
- **MEVProtection** (`sdk/src/core/MEVProtection.ts`): Additional protection layers including Jito bundle support

### 4. Rust Relayer Implementation
- **Continuum Relayer** (`continuum-relayer/`): Complete Rust relayer implementing:
  - HTTP API for receiving swap requests
  - Sequence tracking with persistent storage (sled)
  - Pool management for Continuum-controlled pools
  - Swap executor with transaction building
  - Background monitoring for FIFO queue processing
  - Prometheus metrics support

### 5. Devnet Deployment
- **Wrapper Program V2**: Deployed to devnet at `9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y`
- **FIFO State**: Initialized at `E9S7ikGZJASpHTeFupagxJKvmqXyMsbCMp7KfErQbV3D`
- **Pool Authority State**: `FiMBBJitoJnVZJ7brU1Xr7V8PHTzYmJKyCbZrWszj27j`
- **Pool Authority PDA**: `5KDb1bq8uHcZpqKBA4cQjwZsru5DN1VPdVkuhhK54bbB`
- **Test Tokens**: Created TOKA and TOKB with 1M supply each
- **Test Wallet**: `8Goz5xrckBCGh6nwozBuDkjN2Pjvjy3Uz9T7x1jPWqS8`

## Key Implementation Details to Remember

### 1. Delegate Authority Pattern
```rust
// PDA derivation for delegate authority
[b"delegate", user_source_token_account.key().as_ref()]
```
- The delegate PDA is unique per user token account
- Must use `createApproveCheckedInstruction` with decimals for safety
- Delegation is immediately revoked after CPI to minimize risk

### 2. Pool Authority Pattern (V2)
```rust
// Pool authority PDA derivation
[b"pool_authority", pool_id.as_ref()]
```
- Continuum must be pool authority to prevent bypass
- Dual signing required: delegate + pool authority
- Ensures ALL swaps go through FIFO ordering

### 3. Account Ordering for CPI
The wrapper requires exact account ordering:
1. Wrapper-specific accounts (fifo_state, pool_authority_state, delegate_authority, etc.)
2. Raydium program and token program
3. All Raydium accounts in exact order via `remaining_accounts`

### 4. Sequence Management
- Sequences are global per wrapper instance (not per pool)
- Client must handle `BadSeq` errors with retry logic
- Optimistic caching reduces RPC calls but requires cache invalidation

### 5. Instruction Discriminators (V2)
```
initialize: [175, 175, 109, 31, 13, 152, 155, 237]
initialize_pool_authority: [245, 243, 142, 59, 138, 3, 209, 46]
swap_with_pool_authority: [237, 180, 80, 103, 107, 172, 187, 137]
create_pool_with_authority: [57, 30, 181, 140, 153, 224, 141, 56]
```

### 6. Critical Bug Fixes Applied
- Fixed missing `continuum_wrapper` module in main program
- Corrected IDL address mismatch
- Resolved TypeScript compilation issues with Anchor 0.30/0.31
- Fixed temporary value lifetime issue in revoke instruction
- Updated discriminators for V2 instructions

## Testing Infrastructure

### Scripts Created
1. `init-fifo-simple.ts`: Initializes FIFO state on devnet
2. `test-wrapper-swap-devnet.ts`: Tests wrapper setup and configuration
3. `init-and-test-devnet.ts`: Comprehensive initialization script
4. `test-complete-flow.ts`: Tests pool authority initialization and swap flow
5. `get-v2-discriminators.ts`: Calculates instruction discriminators
6. `swap-through-wrapper.ts`: Demonstrates complete swap transaction structure
7. `create-pool-simple.ts`: Mock pool configuration for testing

### Test Configuration Files
- `deployment-devnet.json`: Wrapper deployment information
- `test-tokens-devnet.json`: Test token mints and accounts
- `test-config-devnet.json`: Complete test configuration
- `test-results-devnet.json`: Pool authority test results
- `pool-config-devnet.json`: Mock pool configuration

## Completed Features

### Pool Authority Control ✅
- V2 wrapper implements pool authority PDAs
- Dual signing prevents bypass of FIFO ordering
- Pool authority state tracks which pools are Continuum-controlled

### Rust Relayer ✅
- Complete HTTP API for swap submission
- Persistent sequence tracking with sled database
- Background monitoring of on-chain state
- Ready for production deployment

## Remaining TODOs

### 1. Raydium Pool Creation
- Need to create actual Raydium pool with Continuum as authority
- Requires all pool accounts (vaults, market, etc.)
- Must handle OpenBook market creation

### 2. Complete Integration Testing
- Test with real Raydium pool accounts
- Verify all CPI calls work correctly
- Load test FIFO ordering under high volume

### 3. Production Deployment
- Deploy relayer with proper monitoring
- Set up metrics collection (Prometheus)
- Implement alerting for sequence gaps
- Create operational runbooks

## Security Considerations

### 1. Delegate Authority
- PDA has no private key, preventing offline misuse
- Temporary delegation minimizes exposure window
- Each user token account has unique delegate

### 2. Sequence Enforcement
- Strict sequence checking prevents out-of-order execution
- No transaction can skip the queue
- Griefing protection needed (e.g., timeout mechanism)

### 3. CPI Security
- Wrapper validates Raydium program address
- Account ownership checks prevent substitution
- Immediate revocation prevents lingering approvals

## Development Commands

```bash
# Build wrapper
cd continuum-wrapper && cargo build-sbf

# Deploy to devnet
solana program deploy target/deploy/continuum_wrapper.so --program-id 9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y

# Initialize FIFO state
cd sdk && npx ts-node scripts/init-fifo-simple.ts

# Initialize pool authority
npx ts-node scripts/test-complete-flow.ts

# Build and run relayer
cd continuum-relayer
cargo build --release
RELAYER_PRIVATE_KEY=<base58_key> cargo run

# Test swap submission
curl -X POST http://localhost:8080/swap \
  -H "Content-Type: application/json" \
  -d '{"user_pubkey": "...", "pool_id": "...", "amount_in": 1000000000}'
```

## Future Development Priorities

### Phase 1: Complete Pool Integration
1. Deploy actual Raydium pool on devnet
2. Implement full swap flow through wrapper
3. Test concurrent swaps for FIFO ordering

### Phase 2: Production Readiness
1. Add comprehensive error handling
2. Implement monitoring and alerting
3. Create deployment documentation
4. Security audit preparation

### Phase 3: Advanced Features
1. Multi-pool support with separate sequences
2. Priority fee mechanisms
3. Governance for parameter updates
4. Cross-program composability

## Architecture Notes

### Component Overview
```
User → Relayer API → Sequence Queue → Continuum Wrapper → Raydium Pool
         ↓                ↓                    ↓
    HTTP Request    Sled Database      Pool Authority
```

### Separation of Concerns
- **Wrapper**: Handles FIFO ordering, pool authority, and delegation
- **Raydium**: Executes actual swap logic
- **Relayer**: Manages sequence queue and transaction submission
- **SDK**: Provides TypeScript client interface

### State Management
- **On-chain**: Global sequence counter, pool authority states
- **Off-chain**: Relayer tracks pending swaps in sled database
- **Delegation**: Temporary per-swap, immediately revoked

### Critical Design Decision: Pool Authority
Without Continuum as pool authority, users can bypass FIFO ordering by swapping directly through Raydium. The V2 implementation ensures ALL swaps must go through the wrapper by controlling the pool authority.

## References
- Plan document: `/plan.md`
- Pool authority design: `/continuum-pool-authority-design.md`
- Core testing notes: `/core-testing.md`
- Wrapper source V2: `/continuum-wrapper/src/lib.rs`
- SDK source: `/sdk/src/`
- Relayer source: `/continuum-relayer/src/`

## Key Addresses (Devnet)
- Program: `9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y`
- FIFO State: `E9S7ikGZJASpHTeFupagxJKvmqXyMsbCMp7KfErQbV3D`
- Pool Authority State: `FiMBBJitoJnVZJ7brU1Xr7V8PHTzYmJKyCbZrWszj27j`
- Pool Authority PDA: `5KDb1bq8uHcZpqKBA4cQjwZsru5DN1VPdVkuhhK54bbB`

---
Last updated: 2025-07-15
Status: V2 wrapper deployed with pool authority support, relayer implemented, ready for Raydium pool integration