# Continuum as Pool Authority - Design Document

## Problem Statement
If Continuum is not the pool authority, users can bypass FIFO ordering by swapping directly through Raydium, defeating the MEV protection entirely.

## Solution: Continuum-Controlled Pools

### 1. Pool Creation Changes
When creating a pool, set the authority to a Continuum PDA:
```rust
// Pool authority PDA
[b"pool_authority", pool_id.as_ref()]
```

### 2. Wrapper Program Updates

#### A. New Instructions Needed:
```rust
pub mod continuum_wrapper {
    // Existing
    pub fn initialize(ctx: Context<Initialize>) -> Result<()>
    pub fn swap_with_seq(ctx: Context<SwapWithSeq>, seq: u64, raydium_ix_data: Vec<u8>) -> Result<()>
    
    // New instructions for pool management
    pub fn create_pool_with_fifo(ctx: Context<CreatePoolWithFifo>, params: CreatePoolParams) -> Result<()>
    pub fn add_liquidity_with_seq(ctx: Context<AddLiquidityWithSeq>, seq: u64, params: AddLiquidityParams) -> Result<()>
    pub fn remove_liquidity_with_seq(ctx: Context<RemoveLiquidityWithSeq>, seq: u64, params: RemoveLiquidityParams) -> Result<()>
}
```

#### B. Pool Authority PDA:
```rust
#[account]
pub struct PoolAuthorityState {
    pub pool_id: Pubkey,
    pub created_at: i64,
    pub fifo_enforced: bool,
}

// In swap instruction, sign with BOTH:
// 1. Delegate authority (for user's tokens)
// 2. Pool authority (for pool operations)
let pool_authority_seeds: &[&[u8]] = &[
    b"pool_authority",
    pool_id.as_ref(),
    &[pool_authority_bump],
];

solana_program::program::invoke_signed(
    &ix,
    ctx.remaining_accounts,
    &[delegate_seeds, pool_authority_seeds], // Both signers!
)?;
```

### 3. Implementation Approaches

#### Option A: Full Wrapper (Recommended)
- Continuum wrapper implements ALL pool operations
- Every interaction goes through FIFO ordering
- Complete MEV protection but more complex

#### Option B: Hybrid Approach
- Swaps require FIFO ordering
- Add/remove liquidity can bypass (less critical for MEV)
- Simpler but incomplete protection

#### Option C: Upgradeable Pool Authority
- Start with standard authority
- Transfer to Continuum after pool creation
- Allows gradual migration

### 4. Trade-offs

#### Pros of Continuum Authority:
✅ Complete FIFO enforcement - no bypassing possible
✅ True MEV protection for all users
✅ Can implement additional features (fees, pausing, etc.)

#### Cons:
❌ More complex implementation
❌ Must handle ALL pool operations
❌ Upgrade complexity for existing pools
❌ Potential composability issues

### 5. Migration Path for Existing Pools

For pools already created with standard authority:
1. Cannot change authority (it's immutable in Raydium)
2. Must create new pools with Continuum authority
3. Provide liquidity migration tools
4. Incentivize migration with fee rebates

### 6. Example Pool Creation Flow

```typescript
// Client code
async function createFIFOPool(params: PoolParams) {
    // 1. Derive pool authority PDA
    const [poolAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority"), poolId.toBuffer()],
        CONTINUUM_PROGRAM_ID
    );
    
    // 2. Create pool with Continuum as authority
    const createPoolIx = await continuum.createPoolWithFifo({
        ...params,
        poolAuthority, // Continuum PDA, not standard Raydium
    });
    
    // 3. Pool is now FIFO-enforced
}
```

### 7. Security Considerations

1. **Authority Powers**: Pool authority can freeze/drain pools, so wrapper must be secure
2. **Upgrade Risk**: If wrapper is upgradeable, admin could steal funds
3. **Solution**: Burn upgrade authority after audit
4. **Emergency**: Implement time-locked emergency functions if needed

## Recommendation

For true MEV protection, Continuum MUST be the pool authority. This requires:
1. Updating wrapper to handle all pool operations
2. Creating new pools with Continuum authority
3. Accepting the complexity trade-off for security

Without this, FIFO is just optional and MEV protection is incomplete.