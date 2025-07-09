# Client-Side Modifications for Raydium FIFO Ordering Wrapper

## Overview
The Continuum wrapper enforces FIFO (First-In-First-Out) ordering for Raydium swaps to prevent sandwiching and MEV attacks. This document outlines the necessary client-side modifications to integrate with the wrapper contract.

## Key Contract Requirements
- Global monotonically increasing sequence number (`seq`)
- Temporary delegation of token spending authority to a PDA
- Immediate revocation of delegation after swap
- Exact account ordering for Raydium CPI

## Client-Side Architecture Components

### 1. Sequence Manager
**Purpose**: Track and manage the global FIFO sequence number

**Implementation**:
```typescript
class SequenceManager {
  private sequenceCache: Map<string, bigint> = new Map();
  
  async getNextSequence(fifoStatePubkey: PublicKey): Promise<bigint> {
    // Fetch current sequence from on-chain FifoState account
    const fifoState = await program.account.fifoState.fetch(fifoStatePubkey);
    return BigInt(fifoState.seq) + 1n;
  }
  
  async waitForSequence(fifoStatePubkey: PublicKey, targetSeq: bigint): Promise<void> {
    // Poll until the on-chain sequence reaches targetSeq - 1
    while (true) {
      const currentSeq = await this.getCurrentSequence(fifoStatePubkey);
      if (currentSeq >= targetSeq - 1n) break;
      await sleep(100); // 100ms polling interval
    }
  }
}
```

### 2. Transaction Builder
**Purpose**: Construct properly formatted transactions for the wrapper

**Key Steps**:
1. Pre-approve token delegation to the PDA
2. Build Raydium swap instruction data
3. Order accounts correctly for the wrapper

```typescript
class ContinuumTransactionBuilder {
  async buildSwapTransaction(params: SwapParams): Promise<Transaction> {
    const tx = new Transaction();
    
    // Step 1: Approve delegation to PDA
    const [delegateAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("delegate"), params.userSource.toBuffer()],
      WRAPPER_PROGRAM_ID
    );
    
    tx.add(
      Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        params.userSource,
        delegateAuthority,
        params.user,
        [],
        params.amountIn
      )
    );
    
    // Step 2: Build wrapper instruction
    const wrapperIx = await this.buildWrapperInstruction(params);
    tx.add(wrapperIx);
    
    return tx;
  }
  
  private async buildWrapperInstruction(params: SwapParams): Promise<TransactionInstruction> {
    // Serialize Raydium swap instruction data
    const raydiumIxData = this.serializeRaydiumSwapData(params);
    
    // Get next sequence
    const nextSeq = await sequenceManager.getNextSequence(params.fifoState);
    
    // Build account list
    const keys = [
      // Wrapper-specific accounts
      { pubkey: params.fifoState, isSigner: false, isWritable: true },
      { pubkey: delegateAuthority, isSigner: false, isWritable: false },
      { pubkey: params.user, isSigner: true, isWritable: false },
      { pubkey: params.userSource, isSigner: false, isWritable: true },
      { pubkey: params.userDestination, isSigner: false, isWritable: true },
      { pubkey: RAYDIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      
      // Raydium accounts (in exact order)
      ...this.getRaydiumAccounts(params)
    ];
    
    return new TransactionInstruction({
      programId: WRAPPER_PROGRAM_ID,
      keys,
      data: Buffer.concat([
        new BN(nextSeq).toArrayLike(Buffer, 'le', 8),
        Buffer.from(raydiumIxData)
      ])
    });
  }
}
```

### 3. Transaction Submitter
**Purpose**: Handle transaction submission with retry logic and sequence management

```typescript
class ContinuumTransactionSubmitter {
  async submitTransaction(tx: Transaction, signer: Keypair): Promise<string> {
    let retries = 3;
    
    while (retries > 0) {
      try {
        // Get latest blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        
        // Sign and send
        tx.sign(signer);
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        });
        
        // Wait for confirmation
        await connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        });
        
        return signature;
      } catch (error) {
        if (error.message.includes("BadSeq")) {
          // Sequence mismatch - rebuild transaction with fresh sequence
          console.log("Sequence mismatch, rebuilding transaction...");
          tx = await this.rebuildWithFreshSequence(tx);
          retries--;
        } else {
          throw error;
        }
      }
    }
    
    throw new Error("Max retries exceeded");
  }
}
```

### 4. MEV Protection Layer
**Purpose**: Additional client-side protections

```typescript
class MEVProtection {
  // Use commitment levels to reduce visibility
  async sendProtectedTransaction(tx: Transaction): Promise<string> {
    return await connection.sendTransaction(tx, [signer], {
      skipPreflight: true,
      preflightCommitment: 'processed',
      commitment: 'processed',
      maxRetries: 0
    });
  }
  
  // Implement time-based ordering
  async scheduleTransaction(tx: Transaction, targetSlot: number): Promise<void> {
    const currentSlot = await connection.getSlot();
    const delay = (targetSlot - currentSlot) * 400; // ~400ms per slot
    await sleep(Math.max(0, delay));
  }
}
```

### 5. Integration Example
**Complete flow for a protected swap**:

```typescript
async function performProtectedSwap(params: SwapParams) {
  // 1. Build transaction
  const builder = new ContinuumTransactionBuilder();
  const tx = await builder.buildSwapTransaction(params);
  
  // 2. Wait for our turn in the sequence
  const nextSeq = await sequenceManager.getNextSequence(params.fifoState);
  await sequenceManager.waitForSequence(params.fifoState, nextSeq);
  
  // 3. Submit with MEV protection
  const submitter = new ContinuumTransactionSubmitter();
  const signature = await submitter.submitTransaction(tx, params.signer);
  
  // 4. Monitor result
  console.log(`Swap completed: ${signature}`);
  
  return signature;
}
```

## Deployment Considerations

### 1. Sequence Coordination
- Implement a mempool or pending transaction tracker
- Consider using a dedicated sequencer service for high-volume scenarios
- Add exponential backoff for sequence conflicts

### 2. Network Optimization
- Use dedicated RPC nodes with low latency
- Implement connection pooling
- Consider geographic distribution for global users

### 3. Error Handling
- Graceful degradation if wrapper is unavailable
- Clear user messaging about FIFO queue position
- Automatic fallback to direct Raydium swaps if needed

### 4. Monitoring
- Track sequence gaps and delays
- Monitor for suspicious patterns (sequence hoarding)
- Alert on wrapper contract issues

## Security Considerations

1. **Client Validation**: Always validate sequence numbers client-side before submission
2. **Timeout Protection**: Implement maximum wait times for sequence turns
3. **Rate Limiting**: Prevent sequence number exhaustion attacks
4. **Audit Trail**: Log all swap attempts with sequences for analysis

## Testing Strategy

1. **Unit Tests**: Test each component in isolation
2. **Integration Tests**: Test full swap flow with mock Raydium
3. **Load Tests**: Verify behavior under high sequence contention
4. **Failure Tests**: Test sequence mismatch recovery

## Migration Path

1. **Phase 1**: Deploy wrapper with opt-in support
2. **Phase 2**: Gradual migration of liquidity providers
3. **Phase 3**: Make FIFO ordering default for all swaps
4. **Phase 4**: Deprecate direct Raydium access

## Conclusion

This client-side architecture provides a robust foundation for integrating with the Continuum FIFO wrapper while maintaining good UX and protecting against MEV. The key is balancing strict ordering requirements with responsive user experience through intelligent sequence management and retry logic.