#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

async function initialize() {
  console.log("=== Simple Continuum Wrapper Initialization ===\n");

  // Load config
  const configPath = path.join(__dirname, '../config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const PROGRAM_ID = new PublicKey(config.programId);
  const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
  
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);

  // Load wallet
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(new Uint8Array(walletData));
  console.log(`Payer: ${payer.publicKey.toBase58()}\n`);

  // Connect
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);
  
  if (balance < 0.01e9) {
    console.error("Insufficient balance! Need at least 0.01 SOL.");
    process.exit(1);
  }

  // Derive FIFO state PDA
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from("fifo_state")],
    PROGRAM_ID
  );
  console.log(`FIFO State PDA: ${fifoState.toBase58()}\n`);

  // Check if already initialized
  const accountInfo = await connection.getAccountInfo(fifoState);
  if (accountInfo) {
    console.log("✅ FIFO state already initialized!");
    const seq = accountInfo.data.readBigUInt64LE(8);
    console.log(`Current sequence: ${seq}`);
    return;
  }

  // Build initialize instruction manually
  console.log("Initializing FIFO state...");
  
  // Instruction discriminator for "initialize"
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  
  const initIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: discriminator
  });

  // Send transaction
  const tx = new Transaction().add(initIx);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = payer.publicKey;
  
  const signature = await connection.sendTransaction(tx, [payer]);
  console.log(`Transaction sent: ${signature}`);
  
  // Wait for confirmation
  await connection.confirmTransaction(signature);
  console.log("✅ Transaction confirmed!");

  // Verify
  const newAccountInfo = await connection.getAccountInfo(fifoState);
  if (newAccountInfo) {
    const seq = newAccountInfo.data.readBigUInt64LE(8);
    console.log(`✅ FIFO state initialized with sequence: ${seq}`);
  }
  
  console.log("\n=== Initialization Complete ===");
}

initialize().catch(console.error);