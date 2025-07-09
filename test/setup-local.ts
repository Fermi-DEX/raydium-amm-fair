#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import { 
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { BN } from '@coral-xyz/anchor';

const LOCAL_RPC = 'http://localhost:8899';

async function setupLocalTest() {
  console.log("=== Local Test Setup ===\n");

  const connection = new Connection(LOCAL_RPC, 'confirmed');
  
  // Create test wallets
  const deployer = Keypair.generate();
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  
  console.log("Test Wallets:");
  console.log("Deployer:", deployer.publicKey.toBase58());
  console.log("User 1:", user1.publicKey.toBase58());
  console.log("User 2:", user2.publicKey.toBase58());
  
  // Save wallets
  const testDir = path.join(__dirname);
  fs.writeFileSync(path.join(testDir, 'deployer.json'), JSON.stringify(Array.from(deployer.secretKey)));
  fs.writeFileSync(path.join(testDir, 'user1.json'), JSON.stringify(Array.from(user1.secretKey)));
  fs.writeFileSync(path.join(testDir, 'user2.json'), JSON.stringify(Array.from(user2.secretKey)));
  
  // Airdrop SOL
  console.log("\n1. Airdropping SOL...");
  await connection.requestAirdrop(deployer.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.requestAirdrop(user1.publicKey, 5 * LAMPORTS_PER_SOL);
  await connection.requestAirdrop(user2.publicKey, 5 * LAMPORTS_PER_SOL);
  
  // Wait for airdrops to confirm
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check balances
  const deployerBalance = await connection.getBalance(deployer.publicKey);
  const user1Balance = await connection.getBalance(user1.publicKey);
  const user2Balance = await connection.getBalance(user2.publicKey);
  
  console.log("\nBalances:");
  console.log("Deployer:", deployerBalance / LAMPORTS_PER_SOL, "SOL");
  console.log("User 1:", user1Balance / LAMPORTS_PER_SOL, "SOL");
  console.log("User 2:", user2Balance / LAMPORTS_PER_SOL, "SOL");
  
  // Create test tokens
  console.log("\n2. Creating test tokens...");
  
  // Token A (RAY-like)
  const tokenA = Keypair.generate();
  const createTokenATx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: deployer.publicKey,
      newAccountPubkey: tokenA.publicKey,
      space: MINT_SIZE,
      lamports: await getMinimumBalanceForRentExemptMint(connection),
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      tokenA.publicKey,
      9, // decimals
      deployer.publicKey,
      deployer.publicKey
    )
  );
  
  await sendAndConfirmTransaction(connection, createTokenATx, [deployer, tokenA]);
  console.log("Token A:", tokenA.publicKey.toBase58());
  
  // Token B (USDC-like)
  const tokenB = Keypair.generate();
  const createTokenBTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: deployer.publicKey,
      newAccountPubkey: tokenB.publicKey,
      space: MINT_SIZE,
      lamports: await getMinimumBalanceForRentExemptMint(connection),
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      tokenB.publicKey,
      6, // decimals
      deployer.publicKey,
      deployer.publicKey
    )
  );
  
  await sendAndConfirmTransaction(connection, createTokenBTx, [deployer, tokenB]);
  console.log("Token B:", tokenB.publicKey.toBase58());
  
  // Create token accounts and mint tokens
  console.log("\n3. Creating token accounts and minting...");
  
  // For deployer (liquidity provider)
  const deployerTokenAAccount = await getAssociatedTokenAddress(tokenA.publicKey, deployer.publicKey);
  const deployerTokenBAccount = await getAssociatedTokenAddress(tokenB.publicKey, deployer.publicKey);
  
  // For users
  const user1TokenAAccount = await getAssociatedTokenAddress(tokenA.publicKey, user1.publicKey);
  const user1TokenBAccount = await getAssociatedTokenAddress(tokenB.publicKey, user1.publicKey);
  const user2TokenAAccount = await getAssociatedTokenAddress(tokenA.publicKey, user2.publicKey);
  const user2TokenBAccount = await getAssociatedTokenAddress(tokenB.publicKey, user2.publicKey);
  
  // Create all token accounts
  const createAccountsTx = new Transaction()
    .add(createAssociatedTokenAccountInstruction(deployer.publicKey, deployerTokenAAccount, deployer.publicKey, tokenA.publicKey))
    .add(createAssociatedTokenAccountInstruction(deployer.publicKey, deployerTokenBAccount, deployer.publicKey, tokenB.publicKey))
    .add(createAssociatedTokenAccountInstruction(deployer.publicKey, user1TokenAAccount, user1.publicKey, tokenA.publicKey))
    .add(createAssociatedTokenAccountInstruction(deployer.publicKey, user1TokenBAccount, user1.publicKey, tokenB.publicKey))
    .add(createAssociatedTokenAccountInstruction(deployer.publicKey, user2TokenAAccount, user2.publicKey, tokenA.publicKey))
    .add(createAssociatedTokenAccountInstruction(deployer.publicKey, user2TokenBAccount, user2.publicKey, tokenB.publicKey));
  
  await sendAndConfirmTransaction(connection, createAccountsTx, [deployer]);
  
  // Mint tokens
  await mintTo(
    connection,
    deployer,
    tokenA.publicKey,
    deployerTokenAAccount,
    deployer,
    1000000 * 10**9 // 1M Token A for liquidity
  );
  
  await mintTo(
    connection,
    deployer,
    tokenB.publicKey,
    deployerTokenBAccount,
    deployer,
    1000000 * 10**6 // 1M Token B for liquidity
  );
  
  await mintTo(
    connection,
    deployer,
    tokenA.publicKey,
    user1TokenAAccount,
    deployer,
    10000 * 10**9 // 10k Token A for user1
  );
  
  await mintTo(
    connection,
    deployer,
    tokenB.publicKey,
    user2TokenBAccount,
    deployer,
    10000 * 10**6 // 10k Token B for user2
  );
  
  console.log("✅ Tokens minted to all accounts");
  
  // Save configuration
  const config = {
    rpc: LOCAL_RPC,
    deployer: deployer.publicKey.toBase58(),
    user1: user1.publicKey.toBase58(),
    user2: user2.publicKey.toBase58(),
    tokenA: {
      mint: tokenA.publicKey.toBase58(),
      decimals: 9,
      deployerAccount: deployerTokenAAccount.toBase58(),
      user1Account: user1TokenAAccount.toBase58(),
      user2Account: user2TokenAAccount.toBase58()
    },
    tokenB: {
      mint: tokenB.publicKey.toBase58(),
      decimals: 6,
      deployerAccount: deployerTokenBAccount.toBase58(),
      user1Account: user1TokenBAccount.toBase58(),
      user2Account: user2TokenBAccount.toBase58()
    }
  };
  
  fs.writeFileSync(path.join(testDir, 'test-config.json'), JSON.stringify(config, null, 2));
  console.log("\n✅ Test configuration saved to test-config.json");
  
  console.log("\n=== Setup Complete ===");
  return config;
}

// Run setup
setupLocalTest().catch(console.error);