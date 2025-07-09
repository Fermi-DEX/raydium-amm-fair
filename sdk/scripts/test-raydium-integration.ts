#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  createApproveInstruction
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import BN from 'bn.js';

// Import Raydium SDK types if available
interface RaydiumSwapInstruction {
  programId: PublicKey;
  keys: any[];
  data: Buffer;
}

async function testRaydiumIntegration() {
  console.log("=== Raydium Integration Test ===\n");

  // Load config
  const configPath = path.join(__dirname, '../config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const WRAPPER_PROGRAM_ID = new PublicKey(config.programId);
  const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
  const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
  
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Wrapper Program ID: ${WRAPPER_PROGRAM_ID.toBase58()}`);
  console.log(`Raydium Program ID: ${RAYDIUM_PROGRAM_ID.toBase58()}\n`);

  // Load wallet
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(new Uint8Array(walletData));
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  // Connect
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Get FIFO state
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from("fifo_state")],
    WRAPPER_PROGRAM_ID
  );
  
  // Check current sequence
  const accountInfo = await connection.getAccountInfo(fifoState);
  if (!accountInfo) {
    console.error("FIFO state not initialized! Run init-simple.ts first.");
    process.exit(1);
  }
  
  const currentSeq = accountInfo.data.readBigUInt64LE(8);
  console.log(`Current sequence: ${currentSeq}`);
  const nextSeq = currentSeq + BigInt(1);
  console.log(`Next sequence: ${nextSeq}\n`);

  // For testing, we'll create a mock Raydium swap instruction
  // In production, you would use the actual Raydium SDK to build this
  console.log("Building mock Raydium swap instruction...");
  
  // Mock user token accounts (you would get these from actual token accounts)
  const userSource = Keypair.generate().publicKey; // Mock source token account
  const userDestination = Keypair.generate().publicKey; // Mock destination token account
  
  // Derive delegate authority PDA
  const [delegateAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegate"), userSource.toBuffer()],
    WRAPPER_PROGRAM_ID
  );
  console.log(`Delegate Authority PDA: ${delegateAuthority.toBase58()}`);

  // Build mock Raydium swap instruction data
  // Instruction 9: swap with fixed input
  const raydiumIxData = Buffer.alloc(1 + 8 + 8);
  raydiumIxData.writeUInt8(9, 0); // instruction ID
  const amountIn = new BN(1000000); // 1 token with 6 decimals
  const minAmountOut = new BN(950000); // 0.95 tokens (5% slippage)
  amountIn.toArrayLike(Buffer, 'le', 8).copy(raydiumIxData, 1);
  minAmountOut.toArrayLike(Buffer, 'le', 8).copy(raydiumIxData, 9);

  // Build wrapper instruction
  console.log("\nBuilding continuum wrapper instruction...");
  
  // Instruction discriminator for "swap_with_seq"
  const discriminator = Buffer.from([51, 199, 40, 53, 152, 157, 30, 242]);
  
  // Encode instruction data: discriminator + seq (u64) + raydium_ix_data (bytes)
  const seqBuffer = Buffer.alloc(8);
  seqBuffer.writeBigUInt64LE(nextSeq);
  
  const raydiumDataLen = Buffer.alloc(4);
  raydiumDataLen.writeUInt32LE(raydiumIxData.length);
  
  const wrapperIxData = Buffer.concat([
    discriminator,
    seqBuffer,
    raydiumDataLen,
    raydiumIxData
  ]);

  // Build wrapper instruction
  const wrapperIx = new TransactionInstruction({
    programId: WRAPPER_PROGRAM_ID,
    keys: [
      // Wrapper-specific accounts
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: delegateAuthority, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: userSource, isSigner: false, isWritable: true },
      { pubkey: userDestination, isSigner: false, isWritable: true },
      { pubkey: RAYDIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      
      // Mock Raydium accounts (in production, these would be real pool accounts)
      // For testing, we'll just use dummy accounts
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token program
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // pool
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }, // authority
      // ... other Raydium accounts would go here
    ],
    data: wrapperIxData
  });

  console.log("Wrapper instruction built successfully!");
  console.log(`- Instruction data length: ${wrapperIxData.length} bytes`);
  console.log(`- Number of accounts: ${wrapperIx.keys.length}`);
  
  // In a real scenario, you would:
  // 1. Create token accounts if needed
  // 2. Add approve instruction for delegate
  // 3. Build the full transaction with both instructions
  // 4. Send and confirm the transaction
  
  console.log("\n✅ Integration test setup complete!");
  console.log("\nTo perform an actual swap:");
  console.log("1. Use the Raydium SDK to fetch pool information");
  console.log("2. Build the proper Raydium swap instruction");
  console.log("3. Wrap it with our continuum wrapper");
  console.log("4. Submit the transaction");
  
  console.log("\n=== Test Complete ===");
}

testRaydiumIntegration().catch(console.error);