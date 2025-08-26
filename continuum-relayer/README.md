# Continuum Relayer

This crate provides a relayer service that forwards user swap requests to the on-chain Continuum program while enforcing a strict sequence for every swap.

## User Flow

1. The user constructs a swap transaction containing the Raydium swap instruction wrapped by the Continuum program.
2. The sequence field in the instruction data is left as a placeholder (all zero bytes).
3. The user partially signs the transaction and sends the serialized payload to the relayer.

### Minimal user example

```ts
import {Connection, PublicKey, Transaction, TransactionInstruction} from '@solana/web3.js';

// Build approve and swap instructions with a zeroed sequence
const swapIx = new TransactionInstruction({
  keys: [/* user accounts */],
  programId: new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y'),
  data: Buffer.concat([
    Buffer.from([237,180,80,103,107,172,187,137]), // swap_with_pool_authority discriminator
    Buffer.alloc(8), // sequence placeholder to be filled by relayer
    Buffer.from(/* serialized Raydium swap data */),
  ])
});

const tx = new Transaction().add(/* approve ix */, swapIx);
// User signs but does not submit
tx.partialSign(userKeypair);
const payload = tx.serialize({requireAllSignatures: false}).toString('base64');
// send `payload` to relayer
```

## Relayer Workflow

1. The relayer receives the partially signed transaction and parses the `SwapRequest` payload.
2. `SequenceTracker::get_next_sequence` is called to fetch the next sequence number.
3. The sequence is appended into the instruction data and the relayer partially signs the transaction via `SwapExecutor`.
4. Once both user and relayer signatures are present, the transaction is sent to `CONTINUUM_PROGRAM_ID`.

## Signature Requirements

Both the user and the relayer must sign the transaction. The user authorizes the token transfer, while the relayer pays fees and enforces sequencing. Transactions lacking either signature will be rejected when submitted to the Continuum program.

## Example `SwapRequest` Payload

```json
{
  "user_pubkey": "User1111111111111111111111111111111111111",
  "pool_id": "Pool1111111111111111111111111111111111111",
  "amount_in": 1000000,
  "minimum_amount_out": 990000,
  "token_a_account": "Source1111111111111111111111111111111111",
  "token_b_account": "Dest1111111111111111111111111111111111111",
  "is_a_to_b": true
}
```

## On-chain Sequence Tracking

* `SequenceTracker` stores the latest confirmed sequence. `get_next_sequence` returns the next value expected on chain.
* After each successful swap, the Continuum program records the sequence and the relayer updates its tracker.
* If a transaction arrives out of order, it is held until all prior sequences have been confirmed, ensuring swaps execute sequentially.
