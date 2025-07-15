#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { ContinuumSDK } from '../src/ContinuumSDK';
import { SwapParams } from '../src/types';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';

async function main() {
    console.log('🚀 Complete Swap Example with ContinuumSDK...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load configurations
    const deploymentPath = path.join(__dirname, '../deployment-devnet.json');
    const tokensPath = path.join(__dirname, '../test-tokens-devnet.json');
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const tokenInfo = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    
    // Load wallet
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const keypair = Keypair.fromSecretKey(new Uint8Array(walletData));
    
    // Create Anchor wallet wrapper
    const wallet: Wallet = {
        publicKey: keypair.publicKey,
        signTransaction: async (tx) => {
            tx.sign(keypair);
            return tx;
        },
        signAllTransactions: async (txs) => {
            txs.forEach(tx => tx.sign(keypair));
            return txs;
        }
    };
    
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Initialize SDK
    console.log('\n🔧 Initializing ContinuumSDK...');
    const sdk = new ContinuumSDK(connection, wallet, {
        wrapperProgramId: deployment.wrapperProgramId
    });
    
    // Get token accounts
    const userTokenA = new PublicKey(tokenInfo.toka.account);
    const userTokenB = new PublicKey(tokenInfo.tokb.account);
    const tokenAMint = new PublicKey(tokenInfo.toka.mint);
    const tokenBMint = new PublicKey(tokenInfo.tokb.mint);
    
    // Check balances
    const tokenAAccount = await getAccount(connection, userTokenA);
    const tokenBAccount = await getAccount(connection, userTokenB);
    
    console.log('\n💰 Initial Balances:');
    console.log('Token A:', Number(tokenAAccount.amount) / 10**9);
    console.log('Token B:', Number(tokenBAccount.amount) / 10**9);
    
    // Get current sequence
    const currentSeq = await sdk.getCurrentSequence();
    console.log('\n📊 Current sequence:', currentSeq.toString());
    
    // Subscribe to sequence updates
    const subId = await sdk.subscribeToSequenceUpdates((seq) => {
        console.log('📡 Sequence updated:', seq.toString());
    });
    
    // Define swap parameters
    const swapParams: SwapParams = {
        user: keypair,
        userSource: userTokenA,
        userDestination: userTokenB,
        amountIn: new BN(100).mul(new BN(10).pow(new BN(9))), // 100 Token A
        minAmountOut: new BN(90).mul(new BN(10).pow(new BN(9))), // 90 Token B
        sourceMint: tokenAMint,
        destinationMint: tokenBMint,
        // Pool and market info would be added here in production
    };
    
    console.log('\n💱 Swap Parameters:');
    console.log('Amount In:', swapParams.amountIn.div(new BN(10).pow(new BN(9))).toString(), 'Token A');
    console.log('Min Amount Out:', swapParams.minAmountOut.div(new BN(10).pow(new BN(9))).toString(), 'Token B');
    
    try {
        console.log('\n🔄 Simulating swap through wrapper...');
        
        // In production, you would call:
        // const signature = await sdk.swap(swapParams);
        
        // For demo, we'll show what the SDK would do:
        console.log('\n📋 SDK Swap Process:');
        console.log('1. Get next sequence number');
        console.log('2. Wait for our turn in the FIFO queue');
        console.log('3. Build transaction with approve + wrapper swap');
        console.log('4. Submit with automatic retry on sequence conflicts');
        console.log('5. Return transaction signature');
        
        // Example with MEV protection
        console.log('\n🛡️ With MEV Protection:');
        // const signature = await sdk.swapWithMEVProtection(swapParams, {
        //     priority: 'high',
        //     useJito: true
        // });
        
        console.log('- Schedules transaction for optimal slot');
        console.log('- Uses Jito bundles if enabled');
        console.log('- Applies additional timing strategies');
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        // Unsubscribe
        sdk.unsubscribeFromSequenceUpdates(subId);
    }
    
    console.log('\n✅ SDK integration example complete!');
    console.log('\n📚 Key Features Demonstrated:');
    console.log('- SDK initialization with custom config');
    console.log('- Sequence tracking and subscriptions');
    console.log('- Swap parameter structure');
    console.log('- MEV protection options');
}

main().catch(console.error);