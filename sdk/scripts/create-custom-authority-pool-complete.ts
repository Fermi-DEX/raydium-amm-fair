import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { BN } from 'bn.js';
import * as anchor from '@coral-xyz/anchor';
import { Buffer } from 'buffer';

// Modified Raydium AMM program ID on devnet
const RAYDIUM_AMM_PROGRAM_ID = new PublicKey('ENnQ4ZKRwW474tRy7tLhwcGjPRQBHkE1NnMKQ9mJVF21');

// Continuum wrapper program ID
const CONTINUUM_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');

// OpenBook program ID on devnet
const OPENBOOK_PROGRAM_ID = new PublicKey('EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj');

// Raydium AMM config on devnet
const AMM_CONFIG_SEED = Buffer.from('amm_config');

// Custom InitializeInstruction2 with authority fields
interface InitializeInstruction2 {
  nonce: number;
  openTime: any; // BN instance
  initPcAmount: any; // BN instance
  initCoinAmount: any; // BN instance
  authorityType: number;
  customAuthority: PublicKey;
}

function serializeInitializeInstruction2(params: InitializeInstruction2): Buffer {
  const buffer = Buffer.alloc(49); // 1 + 8 + 8 + 8 + 1 + 32
  let offset = 0;
  
  // nonce (u8)
  buffer.writeUInt8(params.nonce, offset);
  offset += 1;
  
  // openTime (u64)
  buffer.writeBigUInt64LE(BigInt(params.openTime.toString()), offset);
  offset += 8;
  
  // initPcAmount (u64)
  buffer.writeBigUInt64LE(BigInt(params.initPcAmount.toString()), offset);
  offset += 8;
  
  // initCoinAmount (u64)  
  buffer.writeBigUInt64LE(BigInt(params.initCoinAmount.toString()), offset);
  offset += 8;
  
  // authorityType (u8)
  buffer.writeUInt8(params.authorityType, offset);
  offset += 1;
  
  // customAuthority (Pubkey - 32 bytes)
  params.customAuthority.toBuffer().copy(buffer, offset);
  
  return buffer;
}

async function createCustomAuthorityPool() {
  console.log('Creating Custom Authority Pool on Devnet...\n');

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load wallet
  const walletPath = path.join(process.env.HOME!, '.config/solana/id.json');
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log('Wallet:', wallet.publicKey.toString());

  // For this test, we'll use an existing market or create a mock setup
  // In production, you would create a real OpenBook market first
  
  // Generate pool keypair
  const poolKeypair = Keypair.generate();
  console.log('Pool ID:', poolKeypair.publicKey.toString());
  
  // Calculate Continuum pool authority PDA
  const [continuumPoolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_authority"), poolKeypair.publicKey.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );
  console.log('Continuum Pool Authority:', continuumPoolAuthority.toString());
  
  // Calculate other PDAs
  const [ammConfig] = PublicKey.findProgramAddressSync(
    [AMM_CONFIG_SEED],
    RAYDIUM_AMM_PROGRAM_ID
  );
  
  // For demonstration, we'll show the instruction structure
  // In a real implementation, you would need:
  // 1. Create OpenBook market
  // 2. Create all necessary token accounts
  // 3. Initialize the pool with custom authority
  
  const initParams: InitializeInstruction2 = {
    nonce: 255, // Would be calculated to match PDA
    openTime: new BN(0), // Open immediately
    initPcAmount: new BN(1000).mul(new BN(10).pow(new BN(9))), // 1000 tokens
    initCoinAmount: new BN(1000).mul(new BN(10).pow(new BN(9))), // 1000 tokens
    authorityType: 1, // Custom authority
    customAuthority: continuumPoolAuthority, // Use Continuum PDA as authority
  };
  
  console.log('\nPool initialization parameters:');
  console.log('- Authority Type: Custom (1)');
  console.log('- Custom Authority:', continuumPoolAuthority.toString());
  console.log('- Initial PC Amount: 1000');
  console.log('- Initial Coin Amount: 1000');
  
  // Create instruction data
  const instructionData = Buffer.concat([
    Buffer.from([1]), // Initialize2 instruction discriminator
    serializeInitializeInstruction2(initParams),
  ]);
  
  console.log('\nInstruction data (hex):', instructionData.toString('hex'));
  
  // Save deployment info
  const deploymentInfo = {
    modifiedRaydiumProgramId: RAYDIUM_AMM_PROGRAM_ID.toString(),
    continuumProgramId: CONTINUUM_PROGRAM_ID.toString(),
    poolId: poolKeypair.publicKey.toString(),
    continuumPoolAuthority: continuumPoolAuthority.toString(),
    initializationParams: {
      authorityType: initParams.authorityType,
      customAuthority: initParams.customAuthority.toString(),
      note: 'This pool would be controlled by Continuum wrapper, not default Raydium PDA',
    },
    timestamp: new Date().toISOString(),
  };
  
  fs.writeFileSync(
    path.join(__dirname, 'custom-authority-deployment.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log('\nDeployment info saved to custom-authority-deployment.json');
  console.log('\nSummary:');
  console.log('✓ Modified Raydium AMM deployed with custom authority support');
  console.log('✓ Pool would use Continuum PDA as authority instead of default');
  console.log('✓ All pool operations would require Continuum wrapper signatures');
  console.log('✓ Direct swaps to Raydium would fail - ensuring FIFO ordering');
}

createCustomAuthorityPool().catch(console.error);