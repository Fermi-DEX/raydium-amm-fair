# Raydium AMM Fair - Architecture Documentation

## Overview

This project implements a MEV-protected version of Raydium AMM V4 through a two-layer architecture:
1. **Modified Raydium AMM**: Fork of Raydium with custom authority support
2. **Continuum Wrapper**: FIFO ordering enforcement layer

## System Architecture

```
┌─────────────────────┐
│   User Interface    │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│  Continuum Wrapper  │ ← FIFO Queue Management
│  (MEV Protection)   │ ← Sequence Enforcement
└──────────┬──────────┘
           │ CPI
           v
┌─────────────────────┐
│ Modified Raydium    │ ← Custom Authority Support
│     AMM V4          │ ← Pool State Management
└─────────────────────┘
```

## Component Details

### 1. Modified Raydium AMM V4

**Program ID (Devnet)**: `ENnQ4ZKRwW474tRy7tLhwcGjPRQBHkE1NnMKQ9mJVF21`

#### Key Modifications

##### Pool State Structure (`state.rs`)
```rust
pub struct AmmInfo {
    // ... existing fields ...
    
    /// padding - reduced from [u64; 8] to [u64; 6]
    pub padding1: [u64; 6],
    
    /// Authority type: 0 = Default PDA, 1 = Custom
    pub authority_type: u64,
    
    /// Custom authority (only used if authority_type == 1)
    pub custom_authority: Pubkey,
}
```

##### Authority Resolution
```rust
pub fn get_pool_authority(
    program_id: &Pubkey,
    amm: &AmmInfo,
) -> Result<Pubkey, AmmError> {
    if amm.authority_type == 1 {
        // Custom authority mode
        Ok(amm.custom_authority)
    } else {
        // Default PDA authority
        Self::authority_id(program_id, AUTHORITY_AMM, amm.nonce as u8)
    }
}
```

##### Initialize Instruction
```rust
pub struct InitializeInstruction2 {
    pub nonce: u8,
    pub open_time: u64,
    pub init_pc_amount: u64,
    pub init_coin_amount: u64,
    pub authority_type: u8,      // NEW: Authority mode
    pub custom_authority: Pubkey, // NEW: Custom authority pubkey
}
```

#### Authority Modes

1. **Default Mode** (`authority_type = 0`)
   - Uses Program Derived Address (PDA)
   - Seed: `["amm authority", nonce]`
   - Backward compatible with existing pools
   - Standard Raydium behavior

2. **Custom Mode** (`authority_type = 1`)
   - Uses provided custom authority
   - Authority cannot be changed post-creation
   - All operations require custom authority signature
   - Enables external program control

### 2. Continuum Wrapper

**Program ID (Devnet)**: `9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y`

#### Core Components

##### FIFO State Account
```rust
pub struct FifoState {
    pub is_initialized: bool,
    pub current_sequence: u64,
    pub admin: Pubkey,
}
```

##### Pool Authority PDA
- Derived from: `["pool_authority", pool_id]`
- Acts as the custom authority for Raydium pools
- Ensures only Continuum can execute swaps

#### Key Instructions

1. **Initialize FIFO**
   - Creates global FIFO state
   - Sets initial sequence to 0
   - Establishes admin authority

2. **Create Pool**
   - Creates Raydium pool via CPI
   - Sets Continuum PDA as custom authority
   - Initializes pool-specific state

3. **Submit Order**
   - Validates sequence number
   - Stores order details
   - Increments global sequence

4. **Execute Order**
   - Verifies FIFO sequence
   - Executes swap via CPI to Raydium
   - Updates order status

## Data Flow

### Pool Creation Flow
```
1. User → Continuum: Create pool request
2. Continuum:
   - Generate pool keypair
   - Calculate Continuum pool authority PDA
   - Prepare InitializeInstruction2 with:
     - authority_type = 1
     - custom_authority = Continuum PDA
3. Continuum → Raydium: CPI with custom authority
4. Raydium: Create pool with Continuum as authority
5. Result: Pool controlled exclusively by Continuum
```

### Swap Execution Flow
```
1. User → Continuum: Submit swap order
2. Continuum:
   - Assign sequence number
   - Store order details
   - Wait for FIFO turn
3. Continuum → Raydium: Execute swap when sequence matches
4. Raydium: Validate Continuum authority and execute
5. Result: MEV-protected swap execution
```

## Security Model

### Authority Control
- Pools created with custom authority can ONLY be operated by that authority
- Direct calls to Raydium with custom authority pools will fail
- Authority is immutable after pool creation

### FIFO Enforcement
- Global sequence counter prevents order manipulation
- Orders must be executed in submission order
- No front-running or sandwich attacks possible

### Attack Vectors Mitigated
1. **Sandwich Attacks**: FIFO ordering prevents insertion of malicious transactions
2. **Front-running**: Sequence enforcement ensures order priority
3. **Authority Bypass**: Custom authority prevents direct Raydium access

## Integration Points

### SDK Architecture
```
sdk/
├── src/
│   ├── index.ts          # Main SDK entry
│   ├── fifo.ts           # FIFO queue management
│   ├── pool.ts           # Pool creation/management
│   └── swap.ts           # Swap execution
├── scripts/
│   ├── create-pool.ts    # Pool creation example
│   └── swap.ts           # Swap execution example
└── tests/
    └── integration.test.ts
```

### Key SDK Functions
```typescript
// Initialize FIFO system
async function initializeFifo(admin: PublicKey): Promise<PublicKey>

// Create MEV-protected pool
async function createPool(params: {
  tokenA: PublicKey,
  tokenB: PublicKey,
  initialLiquidity: BN
}): Promise<PublicKey>

// Submit swap order
async function submitSwap(params: {
  poolId: PublicKey,
  amountIn: BN,
  minimumAmountOut: BN,
  direction: SwapDirection
}): Promise<string>
```

## Deployment Configuration

### Devnet Deployment
- Modified Raydium: `ENnQ4ZKRwW474tRy7tLhwcGjPRQBHkE1NnMKQ9mJVF21`
- Continuum Wrapper: `9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y`
- OpenBook: `EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj`

### Required Accounts
1. **Pool Creation**
   - AMM Config PDA
   - Pool Authority (Continuum PDA)
   - Token vaults
   - LP mint
   - OpenBook market

2. **Swap Execution**
   - FIFO state account
   - Pool accounts
   - User token accounts
   - Continuum authority

## Performance Considerations

### On-chain Costs
- Additional authority check: ~200 compute units
- FIFO sequence validation: ~500 compute units
- Total overhead: <1000 compute units per swap

### Storage Requirements
- Pool state: +40 bytes for authority fields
- FIFO state: 41 bytes per global state
- Order storage: ~200 bytes per pending order

## Future Enhancements

1. **Batch Processing**: Execute multiple orders in single transaction
2. **Priority Fees**: Optional priority queue for urgent orders
3. **Cross-pool Routing**: MEV-protected multi-hop swaps
4. **Governance**: Decentralized FIFO parameter management

## Testing Strategy

### Unit Tests
- Authority validation logic
- FIFO sequence management
- CPI instruction building

### Integration Tests
- End-to-end pool creation
- Sequential swap execution
- Authority rejection scenarios

### Security Audits
- Authority bypass attempts
- FIFO manipulation tests
- Economic attack simulations

## Conclusion

This architecture provides robust MEV protection through enforced FIFO ordering while maintaining compatibility with the Raydium ecosystem. The two-layer design separates concerns effectively:
- Raydium handles core AMM logic
- Continuum enforces fair ordering

The custom authority mechanism ensures that MEV protection cannot be bypassed, creating a truly fair trading environment.