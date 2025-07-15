# Guide: Forking Raydium AMM to Support Custom Pool Authority

## Overview
This guide outlines the modifications needed to fork Raydium AMM V4 to support custom pool authority during pool creation. This will allow the Continuum wrapper to have full control over pool operations and guarantee FIFO ordering.

## Key Modifications Required

### 1. Pool State Structure
**File**: `programs/amm/src/states/pool.rs` (or equivalent)

Add optional custom authority field to the pool state:
```rust
#[account]
pub struct PoolState {
    // Existing fields...
    pub status: u64,
    pub nonce: u8,
    pub depth: u64,
    pub amm_config: Pubkey,
    pub pool_creator: Pubkey,
    
    // NEW: Add custom authority field
    pub custom_authority: Option<Pubkey>,  // 1 + 32 bytes
    pub authority_type: AuthorityType,     // 1 byte enum
    
    // Existing fields continue...
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum AuthorityType {
    Default = 0,    // Use PDA derivation
    Custom = 1,     // Use custom authority
}
```

### 2. Create Pool Instruction
**File**: `programs/amm/src/instructions/create_pool.rs`

Modify the create pool instruction to accept optional custom authority:

```rust
#[derive(Accounts)]
pub struct CreatePoolV4<'info> {
    /// Pool creator
    #[account(mut)]
    pub pool_creator: Signer<'info>,
    
    /// Amm config account
    pub amm_config: Box<Account<'info, AmmConfig>>,
    
    /// NEW: Optional custom authority
    /// CHECK: Validated in instruction logic
    pub custom_authority: Option<UncheckedAccount<'info>>,
    
    // Other existing accounts...
    
    /// Pool account to be created
    #[account(
        init,
        seeds = [
            POOL_SEED.as_bytes(),
            amm_config.key().as_ref(),
            coin_mint.key().as_ref(),
            pc_mint.key().as_ref(),
        ],
        bump,
        payer = pool_creator,
        space = PoolState::LEN
    )]
    pub pool: Box<Account<'info, PoolState>>,
    
    // Continue with existing accounts...
}

// Update instruction parameters
pub fn create_pool_v4(
    ctx: Context<CreatePoolV4>,
    nonce: u8,
    open_time: u64,
    init_amount_0: u64,
    init_amount_1: u64,
    // NEW: Add custom authority parameter
    use_custom_authority: bool,
) -> Result<()> {
    // Validation logic
    if use_custom_authority {
        require!(
            ctx.accounts.custom_authority.is_some(),
            ErrorCode::InvalidCustomAuthority
        );
    }
    
    // Set pool authority
    let (authority, authority_type) = if use_custom_authority {
        (
            ctx.accounts.custom_authority.as_ref().unwrap().key(),
            AuthorityType::Custom
        )
    } else {
        (
            get_associated_authority(&ctx.accounts.pool.key()),
            AuthorityType::Default
        )
    };
    
    // Initialize pool with custom or default authority
    let pool = &mut ctx.accounts.pool;
    pool.custom_authority = if use_custom_authority {
        Some(authority)
    } else {
        None
    };
    pool.authority_type = authority_type;
    
    // Continue with existing initialization...
}
```

### 3. Authority Validation
**File**: `programs/amm/src/utils/validation.rs`

Create helper functions for authority validation:

```rust
pub fn get_pool_authority(pool: &PoolState, program_id: &Pubkey) -> Pubkey {
    match pool.authority_type {
        AuthorityType::Custom => {
            pool.custom_authority.expect("Custom authority must be set")
        }
        AuthorityType::Default => {
            get_associated_authority_pda(program_id)
        }
    }
}

pub fn validate_pool_authority(
    pool: &PoolState,
    authority: &Pubkey,
    program_id: &Pubkey,
) -> Result<()> {
    let expected_authority = get_pool_authority(pool, program_id);
    require!(
        authority == &expected_authority,
        ErrorCode::InvalidPoolAuthority
    );
    Ok(())
}

// PDA derivation for default authority
pub fn get_associated_authority_pda(program_id: &Pubkey) -> Pubkey {
    let (authority, _) = Pubkey::find_program_address(
        &[AMM_AUTHORITY_SEED],
        program_id,
    );
    authority
}
```

### 4. Update Swap Instructions
**File**: `programs/amm/src/instructions/swap.rs`

Modify swap instructions to use the correct authority:

```rust
#[derive(Accounts)]
pub struct Swap<'info> {
    /// The user performing the swap
    pub payer: Signer<'info>,
    
    /// CHECK: Pool authority (either PDA or custom)
    pub authority: UncheckedAccount<'info>,
    
    /// The AMM
    #[account(
        mut,
        constraint = validate_pool_authority(&amm, &authority.key(), &ID).is_ok()
    )]
    pub amm: Box<Account<'info, PoolState>>,
    
    // Other accounts...
}

pub fn swap(
    ctx: Context<Swap>,
    amount_in: u64,
    minimum_amount_out: u64,
) -> Result<()> {
    let pool = &ctx.accounts.amm;
    
    // Validate authority
    validate_pool_authority(pool, &ctx.accounts.authority.key(), &ctx.program_id)?;
    
    // For custom authority, it should be a signer
    if pool.authority_type == AuthorityType::Custom {
        require!(
            ctx.accounts.authority.is_signer,
            ErrorCode::AuthorityMustSign
        );
    }
    
    // Continue with swap logic...
}
```

### 5. Update PDA Seeds
**File**: `programs/amm/src/constants.rs`

Ensure PDA derivations work with both authority types:

```rust
pub const AMM_AUTHORITY_SEED: &[u8] = b"amm authority";
pub const POOL_SEED: &str = "pool";
pub const POOL_VAULT_SEED: &str = "pool vault";
pub const POOL_LP_MINT_SEED: &str = "pool lp mint";

// For pools with custom authority, may need different vault derivations
pub fn get_pool_vault_signer_seeds<'a>(
    pool: &PoolState,
    pool_key: &'a Pubkey,
    nonce: &'a [u8; 1],
) -> Vec<&'a [u8]> {
    if pool.authority_type == AuthorityType::Custom {
        vec![pool_key.as_ref(), nonce]
    } else {
        vec![pool_key.as_ref(), nonce]
    }
}
```

### 6. Migration for Existing Pools
**File**: `programs/amm/src/instructions/migrate.rs`

Add migration instruction for existing pools (optional):

```rust
pub fn migrate_pool_authority(
    ctx: Context<MigrateAuthority>,
    new_authority: Pubkey,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    
    // Only pool creator or current authority can migrate
    require!(
        ctx.accounts.authority.key() == get_pool_authority(pool, &ctx.program_id)
            || ctx.accounts.authority.key() == pool.pool_creator,
        ErrorCode::Unauthorized
    );
    
    // Update to custom authority
    pool.custom_authority = Some(new_authority);
    pool.authority_type = AuthorityType::Custom;
    
    emit!(AuthorityMigrated {
        pool: pool.key(),
        old_authority: get_pool_authority(pool, &ctx.program_id),
        new_authority,
    });
    
    Ok(())
}
```

### 7. SDK Modifications
**File**: `sdk/src/liquidity/instruction.ts`

Update SDK to support custom authority:

```typescript
export interface CreatePoolV4Params {
  // Existing parameters...
  programId: PublicKey;
  marketInfo: MarketInfo;
  baseMintInfo: MintInfo;
  quoteMintInfo: MintInfo;
  baseAmount: BN;
  quoteAmount: BN;
  startTime: BN;
  
  // NEW: Custom authority option
  customAuthority?: PublicKey;
  useCustomAuthority?: boolean;
}

export function makeCreatePoolV4Instruction(
  params: CreatePoolV4Params,
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: params.poolCreator, isSigner: true, isWritable: true },
    { pubkey: params.ammConfig, isSigner: false, isWritable: false },
    // Add custom authority account if provided
    ...(params.customAuthority ? [
      { pubkey: params.customAuthority, isSigner: false, isWritable: false }
    ] : []),
    // Other accounts...
  ];
  
  const dataLayout = struct([
    u8('instruction'),
    u8('nonce'),
    u64('openTime'),
    u64('initAmount0'),
    u64('initAmount1'),
    // NEW: Add custom authority flag
    u8('useCustomAuthority'),
  ]);
  
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: 1, // Create pool instruction
      nonce: params.nonce,
      openTime: params.startTime,
      initAmount0: params.baseAmount,
      initAmount1: params.quoteAmount,
      useCustomAuthority: params.useCustomAuthority ? 1 : 0,
    },
    data,
  );
  
  return new TransactionInstruction({
    keys,
    programId: params.programId,
    data,
  });
}
```

## Testing Strategy

### 1. Unit Tests
```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_create_pool_with_custom_authority() {
        // Test pool creation with custom authority
        let custom_auth = Keypair::new().pubkey();
        // Assert pool is created with correct authority
    }
    
    #[test]
    fn test_swap_with_custom_authority() {
        // Test that swaps work with custom authority
        // Test that swaps fail with wrong authority
    }
}
```

### 2. Integration Tests
- Create pools with both default and custom authority
- Verify swaps work correctly with each type
- Test authority migration
- Ensure backwards compatibility

## Deployment Steps

1. **Fork Raydium Repository**
   ```bash
   git clone https://github.com/raydium-io/raydium-amm
   cd raydium-amm
   git checkout -b custom-authority-support
   ```

2. **Implement Modifications**
   - Apply changes listed above
   - Update tests
   - Update documentation

3. **Build and Test**
   ```bash
   anchor build
   anchor test
   ```

4. **Deploy to Devnet**
   ```bash
   anchor deploy --provider.cluster devnet
   ```

5. **Update Continuum Integration**
   - Update program IDs
   - Modify pool creation to use custom authority
   - Test end-to-end with FIFO wrapper

## Integration with Continuum

Once deployed, create pools with Continuum as authority:

```typescript
const continuumAuthority = PublicKey.findProgramAddressSync(
  [Buffer.from("pool_authority"), poolId.toBuffer()],
  CONTINUUM_PROGRAM_ID
)[0];

const { execute } = await raydium.liquidity.createPoolV4({
  // ... other params
  customAuthority: continuumAuthority,
  useCustomAuthority: true,
});
```

## Security Considerations

1. **Authority Validation**: Always validate authority in every instruction
2. **Migration Security**: Only allow authorized parties to migrate authority
3. **Backwards Compatibility**: Ensure existing pools continue to work
4. **Audit Changes**: Have security audit before mainnet deployment

## Alternative: Minimal Fork

If you want minimal changes, you could:
1. Only modify `create_pool` to accept custom authority
2. Store it in an existing reserved field
3. Override authority checks to use custom if set

This reduces changes but may be less clean architecturally.

## Resources

- Raydium AMM V4 Source: [GitHub](https://github.com/raydium-io/raydium-amm)
- Solana Program Examples: [Solana Cookbook](https://solanacookbook.com)
- Anchor Documentation: [anchor-lang.com](https://anchor-lang.com)

## Next Steps

1. Clone and analyze Raydium source code
2. Implement modifications in development branch
3. Test thoroughly on localnet
4. Deploy to devnet for integration testing
5. Audit before mainnet deployment

This guide provides the blueprint for modifying Raydium to support custom pool authority, enabling full FIFO enforcement through the Continuum wrapper.