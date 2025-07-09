#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl
} from '@solana/web3.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

async function deploy() {
  console.log("=== Continuum Wrapper Deployment Script ===\n");

  // Configuration
  const NETWORK = process.env.NETWORK || 'devnet';
  const RPC_URL = process.env.RPC_URL || clusterApiUrl(NETWORK as any);
  const WALLET_PATH = process.env.WALLET_PATH || '~/.config/solana/id.json';
  const PROGRAM_PATH = path.join(__dirname, '../../program');

  console.log(`Network: ${NETWORK}`);
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Wallet: ${WALLET_PATH}`);
  console.log(`Program Path: ${PROGRAM_PATH}\n`);

  // Load deployer wallet
  const walletData = JSON.parse(
    fs.readFileSync(WALLET_PATH.replace('~', process.env.HOME!), 'utf-8')
  );
  const deployerKeypair = Keypair.fromSecretKey(new Uint8Array(walletData));
  console.log(`Deployer: ${deployerKeypair.publicKey.toBase58()}\n`);

  // Check balance
  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(deployerKeypair.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);
  
  if (balance < 1e9) {
    console.error("Insufficient balance! Need at least 1 SOL to deploy.");
    process.exit(1);
  }

  // Step 1: Build the program
  console.log("\n1. Building program...");
  try {
    await execAsync(`cd ${PROGRAM_PATH} && cargo build-sbf`, {
      env: { ...process.env, RUST_LOG: 'error' }
    });
    console.log("✅ Program built successfully");
  } catch (error) {
    console.error("❌ Build failed:", error);
    process.exit(1);
  }

  // Step 2: Deploy the program
  console.log("\n2. Deploying program...");
  try {
    const deployCommand = `solana program deploy --url ${RPC_URL} --keypair ${WALLET_PATH} ${PROGRAM_PATH}/target/deploy/continuum_wrapper.so`;
    const { stdout } = await execAsync(deployCommand);
    
    // Extract program ID from output
    const programIdMatch = stdout.match(/Program Id: (\w+)/);
    if (!programIdMatch) {
      throw new Error("Could not extract program ID from deployment output");
    }
    
    const programId = new PublicKey(programIdMatch[1]);
    console.log(`✅ Program deployed: ${programId.toBase58()}`);
    
    // Save program ID to config
    const configPath = path.join(__dirname, '../config.json');
    const config = {
      programId: programId.toBase58(),
      network: NETWORK,
      deployedAt: new Date().toISOString()
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`✅ Config saved to ${configPath}`);
    
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }

  console.log("\n=== Deployment Complete ===");
  console.log("\nNext steps:");
  console.log("1. Initialize the FIFO state: npm run init");
  console.log("2. Test with example swap: npm run example");
}

// Run deployment
deploy().catch(console.error);