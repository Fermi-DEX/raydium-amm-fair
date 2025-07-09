#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction
} from '@solana/web3.js';
import { 
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const TEST_TRADER_PATH = `${process.env.HOME}/.config/solana/test-trader.json`;
const TOKEN_AUTHORITY_PATH = `${process.env.HOME}/.config/solana/token-authority.json`;

async function setupTestEnvironment() {
  console.log("=== Test Environment Setup ===\n");

  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Load main wallet
  const mainWalletPath = `${process.env.HOME}/.config/solana/id.json`;
  const mainWalletData = JSON.parse(fs.readFileSync(mainWalletPath, 'utf-8'));
  const mainWallet = Keypair.fromSecretKey(new Uint8Array(mainWalletData));
  console.log(`Main wallet: ${mainWallet.publicKey.toBase58()}`);

  // Step 1: Create test wallets
  console.log("\n1. Creating test wallets...");
  
  // Create test trader wallet
  const testTrader = Keypair.generate();
  fs.writeFileSync(TEST_TRADER_PATH, JSON.stringify(Array.from(testTrader.secretKey)));
  console.log(`Test trader wallet: ${testTrader.publicKey.toBase58()}`);
  
  // Create token authority wallet
  const tokenAuthority = Keypair.generate();
  fs.writeFileSync(TOKEN_AUTHORITY_PATH, JSON.stringify(Array.from(tokenAuthority.secretKey)));
  console.log(`Token authority wallet: ${tokenAuthority.publicKey.toBase58()}`);

  // Step 2: Airdrop SOL
  console.log("\n2. Airdropping SOL...");
  
  // Airdrop to test trader
  const airdropSig1 = await connection.requestAirdrop(
    testTrader.publicKey,
    100 * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(airdropSig1);
  console.log(`Airdropped 100 SOL to test trader`);
  
  // Airdrop to token authority
  const airdropSig2 = await connection.requestAirdrop(
    tokenAuthority.publicKey,
    10 * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(airdropSig2);
  console.log(`Airdropped 10 SOL to token authority`);

  // Wait a bit for airdrops to settle
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Step 3: Create test tokens
  console.log("\n3. Creating test tokens...");
  
  // Create Token A (TEST-A)
  const tokenA = await createMint(
    connection,
    tokenAuthority,
    tokenAuthority.publicKey,
    null,
    9,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log(`Token A created: ${tokenA.toBase58()}`);
  
  // Create Token B (TEST-B)
  const tokenB = await createMint(
    connection,
    tokenAuthority,
    tokenAuthority.publicKey,
    null,
    9,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log(`Token B created: ${tokenB.toBase58()}`);

  // Step 4: Create token accounts
  console.log("\n4. Creating token accounts...");
  
  // For main wallet
  const mainTokenAccountA = await getOrCreateAssociatedTokenAccount(
    connection,
    mainWallet,
    tokenA,
    mainWallet.publicKey
  );
  console.log(`Main wallet Token A account: ${mainTokenAccountA.address.toBase58()}`);
  
  const mainTokenAccountB = await getOrCreateAssociatedTokenAccount(
    connection,
    mainWallet,
    tokenB,
    mainWallet.publicKey
  );
  console.log(`Main wallet Token B account: ${mainTokenAccountB.address.toBase58()}`);
  
  // For test trader
  const traderTokenAccountA = await getOrCreateAssociatedTokenAccount(
    connection,
    testTrader,
    tokenA,
    testTrader.publicKey
  );
  console.log(`Test trader Token A account: ${traderTokenAccountA.address.toBase58()}`);
  
  const traderTokenAccountB = await getOrCreateAssociatedTokenAccount(
    connection,
    testTrader,
    tokenB,
    testTrader.publicKey
  );
  console.log(`Test trader Token B account: ${traderTokenAccountB.address.toBase58()}`);

  // Step 5: Mint tokens
  console.log("\n5. Minting tokens...");
  
  // Mint 1,000,000 Token A to main wallet
  await mintTo(
    connection,
    tokenAuthority,
    tokenA,
    mainTokenAccountA.address,
    tokenAuthority,
    1_000_000 * 10**9
  );
  console.log(`Minted 1,000,000 Token A to main wallet`);
  
  // Mint 1,000,000 Token B to main wallet
  await mintTo(
    connection,
    tokenAuthority,
    tokenB,
    mainTokenAccountB.address,
    tokenAuthority,
    1_000_000 * 10**9
  );
  console.log(`Minted 1,000,000 Token B to main wallet`);

  // Step 6: Transfer tokens to test trader
  console.log("\n6. Transferring tokens to test trader...");
  
  // Transfer 100,000 Token A
  await transfer(
    connection,
    mainWallet,
    mainTokenAccountA.address,
    traderTokenAccountA.address,
    mainWallet,
    100_000 * 10**9
  );
  console.log(`Transferred 100,000 Token A to test trader`);
  
  // Transfer 100,000 Token B
  await transfer(
    connection,
    mainWallet,
    mainTokenAccountB.address,
    traderTokenAccountB.address,
    mainWallet,
    100_000 * 10**9
  );
  console.log(`Transferred 100,000 Token B to test trader`);

  // Save configuration
  const testConfig = {
    mainWallet: mainWallet.publicKey.toBase58(),
    testTrader: testTrader.publicKey.toBase58(),
    tokenAuthority: tokenAuthority.publicKey.toBase58(),
    tokenA: tokenA.toBase58(),
    tokenB: tokenB.toBase58(),
    mainTokenAccountA: mainTokenAccountA.address.toBase58(),
    mainTokenAccountB: mainTokenAccountB.address.toBase58(),
    traderTokenAccountA: traderTokenAccountA.address.toBase58(),
    traderTokenAccountB: traderTokenAccountB.address.toBase58()
  };
  
  const configPath = path.join(__dirname, '../test-config.json');
  fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
  console.log(`\nTest configuration saved to: ${configPath}`);

  // Display final balances
  console.log("\n=== Final Balances ===");
  console.log("\nMain Wallet:");
  console.log(`- SOL: ${(await connection.getBalance(mainWallet.publicKey)) / LAMPORTS_PER_SOL}`);
  console.log(`- Token A: ${mainTokenAccountA.amount / BigInt(10**9)}`);
  console.log(`- Token B: ${mainTokenAccountB.amount / BigInt(10**9)}`);
  
  console.log("\nTest Trader:");
  console.log(`- SOL: ${(await connection.getBalance(testTrader.publicKey)) / LAMPORTS_PER_SOL}`);
  const traderA = await connection.getTokenAccountBalance(traderTokenAccountA.address);
  const traderB = await connection.getTokenAccountBalance(traderTokenAccountB.address);
  console.log(`- Token A: ${traderA.value.uiAmount}`);
  console.log(`- Token B: ${traderB.value.uiAmount}`);

  console.log("\n=== Setup Complete ===");
}

setupTestEnvironment().catch(console.error);