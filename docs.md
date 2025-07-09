# Continuum Integration Documentation

## Overview

This fork of Raydium AMM integrates the Continuum sequencer to enforce ordered execution of swap transactions. The integration ensures that all swaps follow a predetermined order list signed by an off-chain sequencer, while maintaining the standard functionality for liquidity provider operations.

## Key Components

### 1. Sequencer Authority
- **Public Key**: `GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ`
- Located in: `program/src/processor.rs:65-68`
- This hardcoded address is the only authorized signer for submitting order lists

### 2. SequencerOrders Account Structure
Located in `program/src/state.rs:1018-1027`

```rust
pub struct SequencerOrders {
    pub orders_hash: [u8; 32],  // Hash of the submitted order list
    pub next_index: u64,         // Next order index expected to be executed
}
```

### 3. New Instructions

#### SubmitSequencerOrders
- **Purpose**: Allows the sequencer to submit a hash of the ordered swap list
- **Authority**: Only callable by the Continuum sequencer
- **Effect**: Resets the orders hash and sets next_index to 0
- **Implementation**: `program/src/processor.rs:6026-6042`

#### SwapBaseInSeq
- **Purpose**: Sequenced version of the base-in swap
- **Parameters**: Includes an `order_index` field
- **Validation**: Must match the current `next_index` in SequencerOrders
- **Implementation**: `program/src/processor.rs:6044-6066`

#### SwapBaseOutSeq
- **Purpose**: Sequenced version of the base-out swap
- **Parameters**: Includes an `order_index` field
- **Validation**: Must match the current `next_index` in SequencerOrders
- **Implementation**: `program/src/processor.rs:6068-6090`

## Integration Flow

### 1. Order Submission
1. The Continuum sequencer collects pending swap transactions
2. Orders them according to its algorithm
3. Computes a hash of the ordered list
4. Calls `SubmitSequencerOrders` with the hash

### 2. Swap Execution
1. Users must use `SwapBaseInSeq` or `SwapBaseOutSeq` instead of regular swap instructions
2. Each swap must include:
   - The SequencerOrders account as the first account
   - The correct `order_index` matching the current `next_index`
3. Upon successful validation:
   - The swap executes normally
   - `next_index` increments by 1

### 3. Order Enforcement
- Swaps with incorrect order indices are rejected with `InvalidInput` error
- Only sequential execution is allowed (no skipping or reordering)
- The sequencer must submit a new orders hash to reset the sequence

## Changes to Existing Functionality

### Modified Operations
- **Swaps**: All swaps must now go through the sequenced variants
  - `SwapBaseIn` → `SwapBaseInSeq`
  - `SwapBaseOut` → `SwapBaseOutSeq`

### Unchanged Operations
- **Liquidity Deposits**: Standard deposit flow remains unchanged
- **Liquidity Withdrawals**: Standard withdrawal flow remains unchanged
- **Pool Initialization**: No changes to pool creation
- **Other Admin Functions**: SetParams, MonitorStep, etc. remain unchanged

## Security Considerations

1. **Centralization**: The sequencer introduces a central point of control for swap ordering
2. **Availability**: If the sequencer is offline, no swaps can be executed
3. **Order Manipulation**: The sequencer has full control over transaction ordering
4. **Front-running Protection**: The enforced ordering prevents MEV and front-running attacks

## Implementation Details

### Account Structure for Sequenced Swaps
```
1. SequencerOrders account (must be first)
2. All standard swap accounts (same as original implementation)
```

### Error Handling
- `InvalidSignAccount`: When submitter is not the authorized sequencer
- `InvalidInput`: When order_index doesn't match expected next_index
- `WrongAccountsNumber`: When SequencerOrders account is missing

## Testing Considerations

When testing sequenced swaps:
1. Initialize a SequencerOrders account
2. Submit an orders hash using the sequencer keypair
3. Execute swaps in the exact order (starting from index 0)
4. Verify that out-of-order swaps are rejected

## Migration Notes

For existing pools:
- Liquidity providers can continue normal operations
- Traders must update their code to use sequenced swap instructions
- A SequencerOrders account must be created for each pool requiring sequenced swaps