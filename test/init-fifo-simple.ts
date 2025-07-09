#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as borsh from 'borsh';

const LOCAL_RPC = 'http://localhost:8899';

// Simple initialize instruction
class InitializeInstruction {
  static schema = new Map([
    [InitializeInstruction, { kind: 'struct', fields: [] }]
  ]);
}

async function initializeFifo() {
  console.log("=== Initializing FIFO State (Simple) ===\n");

  const testDir = path.join(__dirname);
  const deploymentInfo = JSON.parse(fs.readFileSync(path.join(testDir, 'deployment.json'), 'utf-8'));
  const deployerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(path.join(testDir, 'deployer.json'), 'utf-8')))
  );

  const connection = new Connection(LOCAL_RPC, 'confirmed');
  const programId = new PublicKey(deploymentInfo.programId);
  
  console.log("Program ID:", programId.toBase58());
  console.log("Deployer:", deployerKeypair.publicKey.toBase58());

  // Derive FIFO state PDA
  const [fifoState, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("fifo_state")],
    programId
  );
  
  console.log("FIFO State PDA:", fifoState.toBase58());
  console.log("Bump:", bump);

  // Check if already initialized
  const accountInfo = await connection.getAccountInfo(fifoState);
  if (accountInfo) {
    console.log("FIFO state already initialized!");
    console.log("Data:", accountInfo.data);
    return;
  }

  // Create initialize instruction
  // Anchor uses a discriminator, let's calculate it
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]); // sha256("global:initialize")[0:8]
  
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: deployerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator
  });

  const tx = new Transaction().add(ix);
  
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [deployerKeypair]);
    console.log("✅ FIFO state initialized:", sig);
    
    // Verify initialization
    const newAccountInfo = await connection.getAccountInfo(fifoState);
    if (newAccountInfo) {
      console.log("Account created successfully");
      console.log("Data length:", newAccountInfo.data.length);
      console.log("Owner:", newAccountInfo.owner.toBase58());
    }
  } catch (error) {
    console.error("❌ Failed to initialize:", error);
  }
}

// Run initialization
initializeFifo().catch(console.error);