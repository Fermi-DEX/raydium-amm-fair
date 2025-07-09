#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction
} from '@solana/web3.js';
import { 
  createApproveInstruction,
  getAccount
} from '@solana/spl-token';
import { Wallet } from '@coral-xyz/anchor';
import { ContinuumSDK, SwapParams, BN } from '../sdk/src';
import * as fs from 'fs';
import * as path from 'path';

const LOCAL_RPC = 'http://localhost:8899';

async function testFifoSwaps() {
  console.log("=== Testing FIFO Swaps ===\n");

  const testDir = path.join(__dirname);
  
  // Load configurations
  const testConfig = JSON.parse(fs.readFileSync(path.join(testDir, 'test-config.json'), 'utf-8'));
  const poolConfig = JSON.parse(fs.readFileSync(path.join(testDir, 'pool-config.json'), 'utf-8'));
  const deploymentInfo = JSON.parse(fs.readFileSync(path.join(testDir, 'deployment.json'), 'utf-8'));
  
  // Load keypairs
  const user1Keypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(path.join(testDir, 'user1.json'), 'utf-8')))
  );
  const user2Keypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(path.join(testDir, 'user2.json'), 'utf-8')))
  );

  const connection = new Connection(LOCAL_RPC, 'confirmed');
  
  // Initialize SDKs for both users
  const sdk1 = new ContinuumSDK(connection, new Wallet(user1Keypair), {
    wrapperProgramId: new PublicKey(deploymentInfo.programId)
  });
  
  const sdk2 = new ContinuumSDK(connection, new Wallet(user2Keypair), {
    wrapperProgramId: new PublicKey(deploymentInfo.programId)
  });

  // Check initial sequence
  const initialSeq = await sdk1.getCurrentSequence();
  console.log(`Initial sequence: ${initialSeq.toString()}`);

  // Test 1: Single swap
  console.log("\n--- Test 1: Single Swap ---");
  
  const swapParams1: SwapParams = {
    user: user1Keypair,
    userSource: new PublicKey(testConfig.tokenA.user1Account),
    userDestination: new PublicKey(testConfig.tokenB.user1Account),
    amountIn: new BN(100 * 10**9), // 100 Token A
    minimumAmountOut: new BN(90 * 10**6), // Minimum 90 Token B
    poolId: new PublicKey(poolConfig.poolId),
    ammAuthority: new PublicKey(poolConfig.ammAuthority),
    openOrders: new PublicKey(poolConfig.openOrders),
    targetOrders: new PublicKey(poolConfig.targetOrders),
    poolCoinTokenAccount: new PublicKey(poolConfig.poolCoinTokenAccount),
    poolPcTokenAccount: new PublicKey(poolConfig.poolPcTokenAccount),
    serumProgram: new PublicKey(poolConfig.serumProgram),
    serumMarket: new PublicKey(poolConfig.serumMarket),
    serumBids: new PublicKey(poolConfig.serumBids),
    serumAsks: new PublicKey(poolConfig.serumAsks),
    serumEventQueue: new PublicKey(poolConfig.serumEventQueue),
    serumCoinVaultAccount: new PublicKey(poolConfig.serumCoinVaultAccount),
    serumPcVaultAccount: new PublicKey(poolConfig.serumPcVaultAccount),
    serumVaultSigner: new PublicKey(poolConfig.serumVaultSigner),
    coinMint: new PublicKey(poolConfig.coinMint),
    pcMint: new PublicKey(poolConfig.pcMint),
  };

  try {
    console.log("User 1 swapping 100 Token A for Token B...");
    const sig1 = await sdk1.swap(swapParams1);
    console.log(`✅ Swap 1 successful: ${sig1}`);
    
    const seq1 = await sdk1.getCurrentSequence();
    console.log(`Sequence after swap 1: ${seq1.toString()}`);
  } catch (error) {
    console.error("❌ Swap 1 failed:", error);
  }

  // Test 2: Concurrent swaps (should enforce FIFO)
  console.log("\n--- Test 2: Concurrent Swaps ---");
  
  const swapParams2: SwapParams = {
    ...swapParams1,
    user: user2Keypair,
    userSource: new PublicKey(testConfig.tokenB.user2Account),
    userDestination: new PublicKey(testConfig.tokenA.user2Account),
    amountIn: new BN(50 * 10**6), // 50 Token B
    minimumAmountOut: new BN(45 * 10**9), // Minimum 45 Token A
  };

  // Start both swaps simultaneously
  console.log("Starting concurrent swaps...");
  
  const swap1Promise = sdk1.swap({
    ...swapParams1,
    amountIn: new BN(50 * 10**9), // 50 Token A
    minimumAmountOut: new BN(45 * 10**6), // Minimum 45 Token B
  }).then(sig => ({ user: 'User 1', sig })).catch(err => ({ user: 'User 1', error: err }));
  
  const swap2Promise = sdk2.swap(swapParams2)
    .then(sig => ({ user: 'User 2', sig }))
    .catch(err => ({ user: 'User 2', error: err }));

  const results = await Promise.all([swap1Promise, swap2Promise]);
  
  for (const result of results) {
    if ('error' in result) {
      console.log(`❌ ${result.user} swap failed:`, result.error.message);
    } else {
      console.log(`✅ ${result.user} swap successful:`, result.sig);
    }
  }

  const finalSeq = await sdk1.getCurrentSequence();
  console.log(`\nFinal sequence: ${finalSeq.toString()}`);

  // Test 3: MEV Protection
  console.log("\n--- Test 3: MEV Protection ---");
  
  try {
    console.log("Testing swap with MEV protection...");
    const mevSig = await sdk1.swapWithMEVProtection(
      {
        ...swapParams1,
        amountIn: new BN(25 * 10**9), // 25 Token A
        minimumAmountOut: new BN(22 * 10**6), // Minimum 22 Token B
      },
      { priority: 'medium' }
    );
    console.log(`✅ MEV protected swap successful: ${mevSig}`);
  } catch (error) {
    console.error("❌ MEV protected swap failed:", error);
  }

  // Test 4: Sequence monitoring
  console.log("\n--- Test 4: Sequence Monitoring ---");
  
  let updateCount = 0;
  const subscriptionId = await sdk1.subscribeToSequenceUpdates((seq) => {
    console.log(`Sequence updated to: ${seq.toString()}`);
    updateCount++;
  });

  // Do a swap to trigger update
  try {
    await sdk2.swap({
      ...swapParams2,
      amountIn: new BN(10 * 10**6), // 10 Token B
      minimumAmountOut: new BN(9 * 10**9), // Minimum 9 Token A
    });
  } catch (error) {
    console.error("Monitor test swap failed:", error);
  }

  // Wait a bit for subscription to process
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  sdk1.unsubscribeFromSequenceUpdates(subscriptionId);
  console.log(`Received ${updateCount} sequence updates`);

  console.log("\n=== All Tests Complete ===");
}

// Run tests
testFifoSwaps().catch(console.error);