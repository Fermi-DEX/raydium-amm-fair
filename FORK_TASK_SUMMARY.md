# Raydium Fork Task Summary

## Objective
Fork and modify Raydium AMM V4 to support custom pool authority during pool creation, enabling the Continuum FIFO wrapper to have full control over pool operations.

## Current Situation
- Raydium pools always use a hardcoded PDA as authority: `findProgramAddress(["amm authority"], programId)`
- This prevents external programs from controlling pool operations
- The Continuum wrapper (`9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y`) needs to be the pool authority for FIFO enforcement

## Required Modifications

### 1. Core Changes to Raydium Program
- Add `custom_authority: Option<Pubkey>` field to pool state
- Add `authority_type: AuthorityType` enum (Default/Custom)
- Modify `create_pool_v4` instruction to accept optional custom authority
- Update all swap/liquidity instructions to validate against correct authority
- Ensure PDA derivations work for both authority types

### 2. Key Files to Modify (estimated paths)
- `programs/amm/src/states/pool.rs` - Add custom authority fields
- `programs/amm/src/instructions/create_pool.rs` - Accept custom authority parameter
- `programs/amm/src/instructions/swap.rs` - Validate custom authority
- `programs/amm/src/utils/validation.rs` - Authority validation helpers
- `sdk/src/liquidity/instruction.ts` - SDK support for custom authority

### 3. Integration Points
When creating a pool, Continuum's pool authority PDA should be set:
```typescript
const [continuumPoolAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("pool_authority"), poolId.toBuffer()],
  new PublicKey("9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y")
);
```

## Testing Requirements
1. Create pool with custom authority (Continuum PDA)
2. Verify only Continuum can execute swaps
3. Ensure FIFO ordering cannot be bypassed
4. Test backwards compatibility with existing pools

## Deployment
1. Deploy modified Raydium to devnet
2. Update Continuum wrapper to use new Raydium program ID
3. Create test pools with Continuum as authority
4. Verify end-to-end FIFO enforcement

## Success Criteria
- Pools can be created with Continuum PDA as authority
- Direct swaps to Raydium fail (only through Continuum wrapper succeed)
- FIFO ordering is guaranteed and cannot be bypassed
- Existing Raydium pools still function (backwards compatible)

## Resources
- Detailed modification guide: `RAYDIUM_FORK_GUIDE.md`
- Continuum wrapper source: `/continuum-wrapper/src/lib.rs`
- Current test scripts: `/sdk/scripts/`

## Notes
- This is a significant modification requiring careful testing
- Consider security audit before mainnet deployment
- Alternative: Build custom AMM with FIFO built-in (more work but cleaner)