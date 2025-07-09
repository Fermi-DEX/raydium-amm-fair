import { 
  Connection, 
  Keypair, 
  PublicKey,
  clusterApiUrl
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import { Wallet } from '@coral-xyz/anchor';
import { ContinuumSDK, SwapParams, BN } from '../src';
import * as fs from 'fs';

async function main() {
  // Configuration
  const RPC_URL = process.env.RPC_URL || clusterApiUrl('devnet');
  const WALLET_PATH = process.env.WALLET_PATH || '~/.config/solana/id.json';
  
  // Load wallet
  const walletData = JSON.parse(fs.readFileSync(WALLET_PATH.replace('~', process.env.HOME!), 'utf-8'));
  const keypair = Keypair.fromSecretKey(new Uint8Array(walletData));
  const wallet = new Wallet(keypair);
  
  // Initialize connection and SDK
  const connection = new Connection(RPC_URL, 'confirmed');
  const sdk = new ContinuumSDK(connection, wallet);
  
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('RPC:', RPC_URL);
  
  // Initialize FIFO state if needed
  console.log('\n1. Initializing FIFO state...');
  try {
    const initSig = await sdk.initializeFifoState(keypair);
    if (initSig) {
      console.log('FIFO state initialized:', initSig);
      await connection.confirmTransaction(initSig);
    }
  } catch (error) {
    console.log('FIFO state initialization error (may already exist):', error.message);
  }
  
  // Get current sequence
  const currentSeq = await sdk.getCurrentSequence();
  console.log('\n2. Current sequence:', currentSeq.toString());
  
  // Example swap parameters (you need to fill these with real values)
  // This is a hypothetical example - you need real pool and token addresses
  const EXAMPLE_POOL_ID = new PublicKey('POOL_ID_HERE');
  const EXAMPLE_COIN_MINT = new PublicKey('COIN_MINT_HERE');
  const EXAMPLE_PC_MINT = new PublicKey('PC_MINT_HERE');
  
  // Get user token accounts
  const userCoinAccount = await getAssociatedTokenAddress(
    EXAMPLE_COIN_MINT,
    wallet.publicKey
  );
  const userPcAccount = await getAssociatedTokenAddress(
    EXAMPLE_PC_MINT,
    wallet.publicKey
  );
  
  // Swap parameters
  const swapParams: SwapParams = {
    user: keypair,
    userSource: userCoinAccount,
    userDestination: userPcAccount,
    amountIn: new BN(1000000), // 1 token (assuming 6 decimals)
    minimumAmountOut: new BN(950000), // 0.95 tokens (5% slippage)
    poolId: EXAMPLE_POOL_ID,
    
    // These need to be fetched from the pool data
    ammAuthority: new PublicKey('AMM_AUTHORITY_HERE'),
    openOrders: new PublicKey('OPEN_ORDERS_HERE'),
    targetOrders: new PublicKey('TARGET_ORDERS_HERE'),
    poolCoinTokenAccount: new PublicKey('POOL_COIN_VAULT_HERE'),
    poolPcTokenAccount: new PublicKey('POOL_PC_VAULT_HERE'),
    serumProgram: new PublicKey('SERUM_PROGRAM_HERE'),
    serumMarket: new PublicKey('SERUM_MARKET_HERE'),
    serumBids: new PublicKey('SERUM_BIDS_HERE'),
    serumAsks: new PublicKey('SERUM_ASKS_HERE'),
    serumEventQueue: new PublicKey('SERUM_EVENT_QUEUE_HERE'),
    serumCoinVaultAccount: new PublicKey('SERUM_COIN_VAULT_HERE'),
    serumPcVaultAccount: new PublicKey('SERUM_PC_VAULT_HERE'),
    serumVaultSigner: new PublicKey('SERUM_VAULT_SIGNER_HERE'),
    coinMint: EXAMPLE_COIN_MINT,
    pcMint: EXAMPLE_PC_MINT,
  };
  
  // Subscribe to sequence updates
  console.log('\n3. Subscribing to sequence updates...');
  const subscriptionId = await sdk.subscribeToSequenceUpdates((seq) => {
    console.log('Sequence updated:', seq.toString());
  });
  
  // Perform swap
  console.log('\n4. Performing protected swap...');
  try {
    const swapSig = await sdk.swap(swapParams);
    console.log('Swap transaction:', swapSig);
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(swapSig);
    console.log('Swap confirmed:', confirmation);
  } catch (error) {
    console.error('Swap error:', error);
  }
  
  // Perform swap with MEV protection
  console.log('\n5. Performing swap with MEV protection...');
  try {
    const mevSwapSig = await sdk.swapWithMEVProtection(swapParams, {
      priority: 'medium',
      useJito: false // Set to true if using Jito RPC
    });
    console.log('MEV protected swap:', mevSwapSig);
  } catch (error) {
    console.error('MEV swap error:', error);
  }
  
  // Cleanup
  sdk.unsubscribeFromSequenceUpdates(subscriptionId);
  console.log('\nDone!');
}

// Run the example
main().catch(console.error);