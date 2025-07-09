#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  clusterApiUrl
} from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import { ContinuumSDK } from '../src';
import * as fs from 'fs';
import * as path from 'path';

async function initialize() {
  console.log("=== Continuum Wrapper Initialization ===\n");

  // Load config
  const configPath = path.join(__dirname, '../config.json');
  if (!fs.existsSync(configPath)) {
    console.error("Config file not found. Please deploy first: npm run deploy");
    process.exit(1);
  }
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const NETWORK = config.network || 'devnet';
  const PROGRAM_ID = config.programId;
  const RPC_URL = process.env.RPC_URL || clusterApiUrl(NETWORK as any);
  const WALLET_PATH = process.env.WALLET_PATH || '~/.config/solana/id.json';

  console.log(`Network: ${NETWORK}`);
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Program ID: ${PROGRAM_ID}`);
  console.log(`Wallet: ${WALLET_PATH}\n`);

  // Load wallet
  const walletData = JSON.parse(
    fs.readFileSync(WALLET_PATH.replace('~', process.env.HOME!), 'utf-8')
  );
  const keypair = Keypair.fromSecretKey(new Uint8Array(walletData));
  const wallet = new Wallet(keypair);
  console.log(`Initializer: ${wallet.publicKey.toBase58()}\n`);

  // Initialize connection and SDK
  const connection = new Connection(RPC_URL, 'confirmed');
  const sdk = new ContinuumSDK(connection, wallet, {
    wrapperProgramId: new PublicKey(PROGRAM_ID)
  });

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);
  
  if (balance < 0.01e9) {
    console.error("Insufficient balance! Need at least 0.01 SOL.");
    process.exit(1);
  }

  // Initialize FIFO state
  console.log("\nInitializing FIFO state...");
  try {
    const signature = await sdk.initializeFifoState(keypair);
    
    if (signature) {
      console.log(`✅ FIFO state initialized: ${signature}`);
      
      // Wait for confirmation
      await connection.confirmTransaction(signature);
      console.log("✅ Transaction confirmed");
      
      // Verify initialization
      const currentSeq = await sdk.getCurrentSequence();
      console.log(`✅ Current sequence: ${currentSeq.toString()}`);
    } else {
      console.log("ℹ️  FIFO state already initialized");
      
      // Show current sequence
      const currentSeq = await sdk.getCurrentSequence();
      console.log(`Current sequence: ${currentSeq.toString()}`);
    }
    
  } catch (error) {
    console.error("❌ Initialization failed:", error);
    process.exit(1);
  }

  // Show FIFO state address
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from("fifo_state")],
    new PublicKey(PROGRAM_ID)
  );
  console.log(`\nFIFO State Address: ${fifoState.toBase58()}`);

  console.log("\n=== Initialization Complete ===");
}

// Run initialization
initialize().catch(console.error);