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

async function testContinuumSwap() {
  console.log("=== Continuum Wrapper Swap Test ===\n");

  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Load configurations
  const wrapperConfigPath = path.join(__dirname, '../config.json');
  const testConfigPath = path.join(__dirname, '../test-config.json');
  const poolConfigPath = path.join(__dirname, '../test-pool-config.json');
  
  if (!fs.existsSync(poolConfigPath)) {
    console.error("Pool config not found. Run setup-raydium-pool.ts first!");
    process.exit(1);
  }
  
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

  // Get current balances
  console.log("\nInitial Balances:");
  const traderTokenA = await getAccount(connection, new PublicKey(testConfig.traderTokenAccountA));
  const traderTokenB = await getAccount(connection, new PublicKey(testConfig.traderTokenAccountB));
  console.log(`Token A: ${Number(traderTokenA.amount) / 10**9}`);
  console.log(`Token B: ${Number(traderTokenB.amount) / 10**9}`);

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
  const nextSeq = currentSeq + BigInt(1);
  console.log(`\nCurrent sequence: ${currentSeq}`);
  console.log(`Next sequence: ${nextSeq}`);

  // Prepare swap: Token A -> Token B
  const amountIn = new BN(1000 * 10**9); // 1000 Token A
  const minAmountOut = new BN(950 * 10**9); // 950 Token B (5% slippage)
  
  console.log(`\nSwapping ${amountIn.toNumber() / 10**9} Token A for Token B`);
  console.log(`Minimum output: ${minAmountOut.toNumber() / 10**9} Token B`);

  // Get delegate authority PDA
  const [delegateAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegate"), new PublicKey(testConfig.traderTokenAccountA).toBuffer()],
    WRAPPER_PROGRAM_ID
  );
  console.log(`Delegate Authority: ${delegateAuthority.toBase58()}`);

  // Build transaction
  const tx = new Transaction();
  
  // 1. Approve delegate
  const approveIx = createApproveInstruction(
    new PublicKey(testConfig.traderTokenAccountA),
    delegateAuthority,
    trader.publicKey,
    amountIn.toNumber()
  );
  tx.add(approveIx);

  // 2. Build Raydium swap instruction data
  const raydiumIxData = Buffer.alloc(1 + 8 + 8);
  raydiumIxData.writeUInt8(9, 0); // swap instruction
  amountIn.toArrayLike(Buffer, 'le', 8).copy(raydiumIxData, 1);
  minAmountOut.toArrayLike(Buffer, 'le', 8).copy(raydiumIxData, 9);

  // 3. Build wrapper instruction
  const discriminator = Buffer.from([59, 244, 195, 210, 250, 208, 38, 108]); // swapWithSeq
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

  // Build wrapper instruction with all required accounts
  const wrapperIx = new TransactionInstruction({
    programId: WRAPPER_PROGRAM_ID,
    keys: [
      // Wrapper accounts
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: delegateAuthority, isSigner: false, isWritable: true },
      { pubkey: trader.publicKey, isSigner: true, isWritable: false },
      { pubkey: new PublicKey(testConfig.traderTokenAccountA), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(testConfig.traderTokenAccountB), isSigner: false, isWritable: true },
      { pubkey: RAYDIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      
      // Raydium accounts (remaining_accounts)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(poolConfig.poolId), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.ammAuthority), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(poolConfig.openOrders), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.targetOrders), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.poolCoinTokenAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.poolPcTokenAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.serumProgram), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(poolConfig.serumMarket), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.serumBids), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.serumAsks), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.serumEventQueue), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.serumCoinVaultAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.serumPcVaultAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(poolConfig.serumVaultSigner), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(testConfig.traderTokenAccountA), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(testConfig.traderTokenAccountB), isSigner: false, isWritable: true },
      { pubkey: delegateAuthority, isSigner: false, isWritable: false } // Delegate as authority
    ],
    data: wrapperIxData
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
    
    // Check final balances
    console.log("\nFinal Balances:");
    const finalTokenA = await getAccount(connection, new PublicKey(testConfig.traderTokenAccountA));
    const finalTokenB = await getAccount(connection, new PublicKey(testConfig.traderTokenAccountB));
    console.log(`Token A: ${Number(finalTokenA.amount) / 10**9}`);
    console.log(`Token B: ${Number(finalTokenB.amount) / 10**9}`);
    
    // Check if delegate authority was revoked
    const delegateAccount = await getAccount(connection, new PublicKey(testConfig.traderTokenAccountA));
    console.log(`\n✅ Delegate authority revoked: ${delegateAccount.delegate === null}`);
    
  } catch (error: any) {
    console.error("❌ Transaction failed:", error);
    
    // Parse error logs
    if (error.logs) {
      console.log("\nTransaction logs:");
      error.logs.forEach((log: string) => console.log(log));
    }
  }

  console.log("\n=== Test Complete ===");
}

testContinuumSwap().catch(console.error);