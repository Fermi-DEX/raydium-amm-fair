#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { Wallet } from '@coral-xyz/anchor';
import { ContinuumSDK, SwapParams, BN } from '../src';
import * as fs from 'fs';
import * as path from 'path';

// Raydium Devnet Test Pool (RAY-SOL)
const RAYDIUM_TEST_POOLS = {
  'RAY-SOL': {
    poolId: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    ammAuthority: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
    openOrders: 'J8u8nTHYtvudyqwLrXZboziN95LpaHFHpd97Jm5vtbkW',
    targetOrders: '3K2uLkKwVVPvZuMhcQAPLF8hw95somMeNwJS7vgWYrsJ',
    poolCoinTokenAccount: 'DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz',
    poolPcTokenAccount: 'HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz',
    serumProgram: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
    serumMarket: 'C6tp2RVZnxBPFbnAsfTjis8BN9tycESAT4SgDQgbbrsA',
    serumBids: '8RN6jLJSJyqvJ3ixkrHWHq99RZRiJJQq4FZuEApUJ2Ss',
    serumAsks: '14ivtgssEBoBjuZJtSAPKYgpUK7DmnSwuPMqJoVTSgKJ',
    serumEventQueue: '5KKsLVU6TcbVDK4BS6K1DGDxnh4Q9xjYJ8XaDCG5t8ht',
    serumCoinVaultAccount: '36c6YqAwyGKQG66XEp2dJc5JqjaBNv7sVghEtJv4c7u6',
    serumPcVaultAccount: '8CFo8bL8mZQK8abbFyypFMwEDd8tVJjHTTojMLgQTUSZ',
    serumVaultSigner: 'F8Vyqk3unwxkXukZFQeYyGmFfTG3CAX4v24iyrjEYBJV',
    coinMint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
    pcMint: 'So11111111111111111111111111111111111111112' // SOL
  }
};

async function testSwap() {
  console.log("=== Continuum Wrapper Test Swap ===\n");

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
  console.log(`User: ${wallet.publicKey.toBase58()}\n`);

  // Initialize connection and SDK
  const connection = new Connection(RPC_URL, 'confirmed');
  const sdk = new ContinuumSDK(connection, wallet, {
    wrapperProgramId: new PublicKey(PROGRAM_ID),
    raydiumProgramId: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8')
  });

  // Use test pool
  const testPool = RAYDIUM_TEST_POOLS['RAY-SOL'];
  
  // Get user token accounts
  const userSolAccount = await getAssociatedTokenAddress(
    new PublicKey(testPool.pcMint),
    wallet.publicKey
  );
  const userRayAccount = await getAssociatedTokenAddress(
    new PublicKey(testPool.coinMint),
    wallet.publicKey
  );

  console.log("Token Accounts:");
  console.log(`SOL: ${userSolAccount.toBase58()}`);
  console.log(`RAY: ${userRayAccount.toBase58()}\n`);

  // Check balances
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`Native SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);

  // For testing, we'll swap a small amount of SOL for RAY
  const swapAmountSol = 0.001; // 0.001 SOL
  const swapAmountLamports = new BN(swapAmountSol * LAMPORTS_PER_SOL);
  const minOutputAmount = new BN(0); // Accept any amount for testing

  // Build swap parameters
  const swapParams: SwapParams = {
    user: keypair,
    userSource: userSolAccount,
    userDestination: userRayAccount,
    amountIn: swapAmountLamports,
    minimumAmountOut: minOutputAmount,
    poolId: new PublicKey(testPool.poolId),
    ammAuthority: new PublicKey(testPool.ammAuthority),
    openOrders: new PublicKey(testPool.openOrders),
    targetOrders: new PublicKey(testPool.targetOrders),
    poolCoinTokenAccount: new PublicKey(testPool.poolCoinTokenAccount),
    poolPcTokenAccount: new PublicKey(testPool.poolPcTokenAccount),
    serumProgram: new PublicKey(testPool.serumProgram),
    serumMarket: new PublicKey(testPool.serumMarket),
    serumBids: new PublicKey(testPool.serumBids),
    serumAsks: new PublicKey(testPool.serumAsks),
    serumEventQueue: new PublicKey(testPool.serumEventQueue),
    serumCoinVaultAccount: new PublicKey(testPool.serumCoinVaultAccount),
    serumPcVaultAccount: new PublicKey(testPool.serumPcVaultAccount),
    serumVaultSigner: new PublicKey(testPool.serumVaultSigner),
    coinMint: new PublicKey(testPool.coinMint),
    pcMint: new PublicKey(testPool.pcMint),
  };

  // Get current sequence
  const currentSeq = await sdk.getCurrentSequence();
  console.log(`Current sequence: ${currentSeq.toString()}\n`);

  // Perform test swap
  console.log(`Swapping ${swapAmountSol} SOL for RAY...`);
  
  try {
    // First, ensure token accounts exist
    // (In production, you'd check and create if needed)
    
    const swapSig = await sdk.swap(swapParams);
    console.log(`✅ Swap transaction: ${swapSig}`);
    
    // Wait for confirmation
    await connection.confirmTransaction(swapSig);
    console.log("✅ Swap confirmed!");
    
    // Check new sequence
    const newSeq = await sdk.getCurrentSequence();
    console.log(`New sequence: ${newSeq.toString()}`);
    
  } catch (error) {
    console.error("❌ Swap failed:", error);
    
    if (error.message?.includes("BadSeq")) {
      console.log("\nSequence conflict detected. This can happen when multiple users are swapping.");
      console.log("The SDK will automatically retry with the correct sequence.");
    }
  }

  console.log("\n=== Test Complete ===");
}

// Run test
testSwap().catch(console.error);