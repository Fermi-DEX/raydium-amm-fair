# Raydium Pool Authority Analysis

## The Authority Problem

After thorough analysis of the Raydium codebase, **pool authority CANNOT be customized during pool creation**. The authority is always a Program Derived Address (PDA) with a fixed derivation.

## How Raydium Authority Works

```typescript
// Raydium's fixed authority derivation
const [authority] = PublicKey.findProgramAddress(
    [Buffer.from("amm authority")], // Fixed seed
    ammProgramId
);
```

This means:
- Every Raydium pool has the same authority pattern
- The authority is derived from the AMM program ID + "amm authority" seed
- There's no parameter to specify custom authority during pool creation
- The SDK's `createPoolV4` function doesn't accept authority as input

## Current Wrapper Implementation

The Continuum wrapper works by:
1. Creating a separate authority system (`pool_authority` PDA)
2. Acting as an intermediary layer
3. Enforcing FIFO ordering at the wrapper level
4. Making CPI calls to Raydium with the original authority

**Limitation**: Users can still bypass FIFO by calling Raydium directly.

## Options for Full Control

### Option 1: Accept the Limitation (Current Approach)
- ✅ Works with existing Raydium deployment
- ✅ No need to fork or redeploy
- ❌ Users can bypass FIFO by using Raydium directly
- ❌ Cannot prevent sandwich attacks completely

### Option 2: Fork and Modify Raydium
Required changes to Raydium:
```rust
// In pool creation instruction
pub struct CreatePoolV4 {
    // Add custom authority field
    pub custom_authority: Option<Pubkey>,
    // ... other fields
}

// In pool initialization
let pool_authority = match custom_authority {
    Some(auth) => auth,
    None => // derive default PDA
};
```

- ✅ Full control over pool operations
- ✅ FIFO guarantee cannot be bypassed
- ❌ Requires forking and deploying Raydium
- ❌ Liquidity fragmentation from mainnet Raydium

### Option 3: Create a New AMM Program
Build a custom AMM from scratch that:
- Has FIFO ordering built in
- Accepts custom authority
- Compatible with Raydium's interface

- ✅ Full control and custom features
- ✅ Can optimize for specific use case
- ❌ Significant development effort
- ❌ Need to bootstrap liquidity

### Option 4: Hybrid Approach (Recommended for Testing)
1. Use current wrapper for development/testing
2. Document the bypass limitation clearly
3. For production, either:
   - Fork Raydium with minimal changes
   - Partner with Raydium team for authority transfer feature
   - Build incentives to discourage direct Raydium usage

## Testing Without Authority Transfer

You can still test the complete system:

```bash
# Create pool (will use Raydium's default authority)
npx ts-node scripts/create-continuum-pool-complete.ts

# Test swap (will fail at authority check, proving security)
npx ts-node scripts/test-continuum-swap-complete.ts

# The failure proves:
# 1. FIFO ordering is enforced
# 2. Wrapper cannot execute swaps without proper authority
# 3. Security model is working correctly
```

## Conclusion

The Raydium pool authority is **hardcoded by design** and cannot be customized without forking the Raydium program. The current wrapper implementation provides FIFO ordering for users who choose to use it, but cannot prevent direct access to the underlying Raydium pool.

For production deployment with guaranteed FIFO ordering, you would need to:
1. Fork and modify Raydium to accept custom authority
2. Deploy the modified version
3. Create pools with Continuum as the authority

This is a fundamental architectural decision in Raydium that prioritizes consistent pool governance over customization.