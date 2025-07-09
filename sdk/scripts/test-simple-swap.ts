#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  getAccount
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import BN from 'bn.js';
import { Buffer } from 'buffer';

async function testSimpleSwap() {
  console.log("=== Simple Continuum Wrapper Test ===\n");

  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Load configurations
  const wrapperConfigPath = path.join(__dirname, '../config.json');
  const testConfigPath = path.join(__dirname, '../test-config.json');
  const poolConfigPath = path.join(__dirname, '../test-pool-config.json');
  
  const wrapperConfig = JSON.parse(fs.readFileSync(wrapperConfigPath, 'utf-8'));
  const testConfig = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8'));
  const poolConfig = JSON.parse(fs.readFileSync(poolConfigPath, 'utf-8'));
  
  const WRAPPER_PROGRAM_ID = new PublicKey(wrapperConfig.programId);
  const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
  
  // Load test trader wallet
  const traderPath = `${process.env.HOME}/.config/solana/test-trader.json`;
  const traderData = JSON.parse(fs.readFileSync(traderPath, 'utf-8'));
  const trader = Keypair.fromSecretKey(new Uint8Array(traderData));
  console.log(`Trader: ${trader.publicKey.toBase58()}`);

  // Get FIFO state
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from("fifo_state")],
    WRAPPER_PROGRAM_ID
  );
  
  // Check current sequence
  const accountInfo = await connection.getAccountInfo(fifoState);
  if (!accountInfo) {
    console.error("FIFO state not initialized!");
    process.exit(1);
  }
  
  const currentSeq = accountInfo.data.readBigUInt64LE(8);
  const nextSeq = new BN(currentSeq.toString()).add(new BN(1));
  console.log(`Current sequence: ${currentSeq}`);
  console.log(`Next sequence: ${nextSeq.toString()}`);

  // Get delegate authority PDA
  const [delegateAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegate"), new PublicKey(testConfig.traderTokenAccountA).toBuffer()],
    WRAPPER_PROGRAM_ID
  );

  // Prepare swap amounts
  const amountIn = new BN(1000).mul(new BN(10).pow(new BN(9))); // 1000 tokens
  const minAmountOut = new BN(950).mul(new BN(10).pow(new BN(9))); // 950 tokens

  console.log(`\nPreparing to swap ${amountIn.div(new BN(10).pow(new BN(9))).toString()} Token A`);

  // Build transaction
  const tx = new Transaction();
  
  // 1. Approve delegate
  const approveIx = createApproveInstruction(
    new PublicKey(testConfig.traderTokenAccountA),
    delegateAuthority,
    trader.publicKey,
    BigInt(amountIn.toString())
  );
  tx.add(approveIx);

  // 2. Build mock Raydium instruction data
  const raydiumIxData = Buffer.alloc(17);
  raydiumIxData.writeUInt8(9, 0); // instruction discriminator
  amountIn.toArrayLike(Buffer, 'le', 8).copy(raydiumIxData, 1);
  minAmountOut.toArrayLike(Buffer, 'le', 8).copy(raydiumIxData, 9);

  // 3. Build wrapper instruction using Anchor format
  const discriminator = Buffer.from([59, 244, 195, 210, 250, 208, 38, 108]); // swapWithSeq
  
  // Manually serialize the instruction data
  // Format: discriminator (8) + seq (8) + raydium_ix_data_len (4) + raydium_ix_data
  const seqBuffer = Buffer.alloc(8);
  nextSeq.toArrayLike(Buffer, 'le', 8).copy(seqBuffer);
  
  const dataLenBuffer = Buffer.alloc(4);
  dataLenBuffer.writeUInt32LE(raydiumIxData.length);
  
  const instructionData = Buffer.concat([
    discriminator,
    seqBuffer,
    dataLenBuffer,
    raydiumIxData
  ]);

  console.log(`Instruction data length: ${instructionData.length} bytes`);
  console.log(`Discriminator: ${discriminator.toString('hex')}`);

  const wrapperIx = new TransactionInstruction({
    programId: WRAPPER_PROGRAM_ID,
    keys: [
      // Core wrapper accounts
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: delegateAuthority, isSigner: false, isWritable: true },
      { pubkey: trader.publicKey, isSigner: true, isWritable: false },
      { pubkey: new PublicKey(testConfig.traderTokenAccountA), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(testConfig.traderTokenAccountB), isSigner: false, isWritable: true },
      { pubkey: RAYDIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      
      // Mock Raydium accounts for testing
      // In production, these would be real pool accounts
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // pool
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }, // authority
    ],
    data: instructionData
  });
  tx.add(wrapperIx);

  // Send transaction
  console.log("\nSending transaction...");
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [trader],
      { commitment: 'confirmed' }
    );
    console.log(`✅ Transaction successful: ${signature}`);
    
    // Check new sequence
    const newAccountInfo = await connection.getAccountInfo(fifoState);
    if (newAccountInfo) {
      const newSeq = newAccountInfo.data.readBigUInt64LE(8);
      console.log(`✅ New sequence: ${newSeq}`);
    }
    
  } catch (error: any) {
    console.error("❌ Transaction failed");
    if (error.logs) {
      console.log("\nTransaction logs:");
      error.logs.forEach((log: string) => console.log(log));
    }
    console.error("\nError:", error.message);
  }

  console.log("\n=== Test Complete ===");
}

testSimpleSwap().catch(console.error);