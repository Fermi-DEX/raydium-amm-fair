#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { Wallet } from '@coral-xyz/anchor';
import { ContinuumSDK } from '../sdk/src';

const execAsync = promisify(exec);
const LOCAL_RPC = 'http://localhost:8899';

async function deployLocal() {
  console.log("=== Deploying Continuum Wrapper to Local ===\n");

  const testDir = path.join(__dirname);
  const deployerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(path.join(testDir, 'deployer.json'), 'utf-8')))
  );

  const connection = new Connection(LOCAL_RPC, 'confirmed');
  
  // Check balance
  const balance = await connection.getBalance(deployerKeypair.publicKey);
  console.log(`Deployer balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  // Deploy the program
  console.log("\n1. Deploying program...");
  
  const programPath = path.join(__dirname, '../target/deploy/continuum_wrapper.so');
  const deployerPath = path.join(testDir, 'deployer.json');
  
  try {
    const { stdout } = await execAsync(
      `solana program deploy --url ${LOCAL_RPC} --keypair ${deployerPath} ${programPath}`
    );
    
    // Extract program ID from output
    const programIdMatch = stdout.match(/Program Id: (\w+)/);
    if (!programIdMatch) {
      throw new Error("Could not extract program ID from deployment output");
    }
    
    const programId = new PublicKey(programIdMatch[1]);
    console.log(`✅ Program deployed: ${programId.toBase58()}`);
    
    // Initialize SDK
    console.log("\n2. Initializing FIFO state...");
    const wallet = new Wallet(deployerKeypair);
    const sdk = new ContinuumSDK(connection, wallet, {
      wrapperProgramId: programId
    });
    
    // Initialize FIFO state
    const initSig = await sdk.initializeFifoState(deployerKeypair);
    if (initSig) {
      await connection.confirmTransaction(initSig);
      console.log(`✅ FIFO state initialized: ${initSig}`);
    } else {
      console.log("ℹ️  FIFO state already initialized");
    }
    
    // Get current sequence
    const currentSeq = await sdk.getCurrentSequence();
    console.log(`✅ Current sequence: ${currentSeq.toString()}`);
    
    // Save deployment info
    const deploymentInfo = {
      programId: programId.toBase58(),
      fifoState: PublicKey.findProgramAddressSync(
        [Buffer.from("fifo_state")],
        programId
      )[0].toBase58(),
      deployedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(
      path.join(testDir, 'deployment.json'), 
      JSON.stringify(deploymentInfo, null, 2)
    );
    
    console.log("\n✅ Deployment info saved to deployment.json");
    
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    throw error;
  }

  console.log("\n=== Deployment Complete ===");
}

// Run deployment
deployLocal().catch(console.error);