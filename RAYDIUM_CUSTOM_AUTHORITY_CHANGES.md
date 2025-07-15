# Raydium AMM Custom Authority Implementation

## Summary of Changes
This document summarizes the modifications made to the Raydium AMM V4 code to support custom pool authority during pool creation.

## Modified Files

### 1. `/program/src/state.rs`
- Modified `AmmInfo` struct to add custom authority support:
  - Changed padding from `[u64; 8]` to `[u64; 6]` to make room for new fields
  - Added `authority_type: u64` field (0 = Default PDA, 1 = Custom)
  - Added `custom_authority: Pubkey` field
- Added `AuthorityType` enum:
  ```rust
  pub enum AuthorityType {
      DefaultPDA = 0,
      Custom = 1,
  }
  ```
- Added `get_pool_authority()` method to AmmInfo struct

### 2. `/program/src/instruction.rs`
- Modified `InitializeInstruction2` struct to include:
  - `authority_type: u8`
  - `custom_authority: Pubkey`
- Updated unpacking and packing methods to handle new fields with backward compatibility
- Updated the `initialize2` instruction helper function to use default values

### 3. `/program/src/processor.rs`
- Added `get_pool_authority()` helper function to determine the correct authority based on pool configuration
- Modified `process_initialize2` to:
  - Accept custom authority during pool initialization
  - Validate the provided authority matches the authority type
  - Store custom authority in pool state
- Updated all authority validation checks throughout the processor to use `get_pool_authority()` instead of hardcoded PDA checks
- Modified functions include:
  - `check_accounts`
  - `process_deposit`
  - `process_withdraw`
  - `process_swap_base_in`
  - `process_swap_base_out`
  - And all other functions that validate pool authority

## Key Implementation Details

### Authority Type Logic
```rust
pub fn get_pool_authority(
    program_id: &Pubkey,
    amm: &AmmInfo,
) -> Result<Pubkey, AmmError> {
    if amm.authority_type == 1 {
        // Custom authority
        Ok(amm.custom_authority)
    } else {
        // Default PDA authority
        Self::authority_id(program_id, AUTHORITY_AMM, amm.nonce as u8)
    }
}
```

### Pool Initialization
During pool initialization with custom authority:
1. Set `authority_type = 1` in the instruction
2. Provide the custom authority pubkey (e.g., Continuum's pool authority PDA)
3. The pool will store this custom authority
4. All future operations will validate against this custom authority

## Backward Compatibility
- Existing pools continue to work with default PDA authority (authority_type = 0)
- The instruction unpacking supports both old and new formats
- No changes required for existing pools

## Limitations and Considerations

### Signing Requirements
When using custom authority, the invoker functions that require PDA signing will not work directly. This means:
- Token transfers from pool vaults
- Open orders operations
- Other signed operations

These operations would need to be initiated by the custom authority (e.g., through CPI from the Continuum wrapper).

### Security Considerations
1. Custom authority has full control over the pool
2. Cannot be changed after pool creation
3. Ensure the custom authority program implements proper security checks

## Testing Requirements
1. Create pool with custom authority
2. Verify operations fail when not signed by custom authority
3. Test backward compatibility with existing pools
4. Ensure FIFO ordering cannot be bypassed

## Next Steps
1. Deploy modified Raydium AMM to devnet
2. Update Continuum wrapper to create pools with itself as authority
3. Test end-to-end FIFO enforcement
4. Consider implementing CPI handlers for operations requiring signatures