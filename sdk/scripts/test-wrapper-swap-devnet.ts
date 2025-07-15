#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  createApproveInstruction,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');
const RAYDIUM_V4_PROGRAM = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');

async function main() {
    console.log('🚀 Testing Continuum Wrapper Swap on Devnet...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load deployment info
    const deploymentPath = path.join(__dirname, '../deployment-devnet.json');
    if (!fs.existsSync(deploymentPath)) {
        console.error('Deployment info not found! Run init-fifo-simple.ts first');
        return;
    }
    
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const fifoState = new PublicKey(deployment.fifoState);
    
    // Load test wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Check balance
    const balance = await connection.getBalance(wallet.publicKey);
    console.log('💰 SOL Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    // Load test tokens
    const tokensPath = path.join(__dirname, '../test-tokens-devnet.json');
    const tokenInfo = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    
    const tokenAMint = new PublicKey(tokenInfo.toka.mint);
    const tokenBMint = new PublicKey(tokenInfo.tokb.mint);
    const tokenAAccount = new PublicKey(tokenInfo.toka.account);
    const tokenBAccount = new PublicKey(tokenInfo.tokb.account);
    
    // Check token balances
    const tokenABalance = await getAccount(connection, tokenAAccount);
    const tokenBBalance = await getAccount(connection, tokenBAccount);
    
    console.log('\n💰 Token Balances:');
    console.log('Token A:', Number(tokenABalance.amount) / 10**9);
    console.log('Token B:', Number(tokenBBalance.amount) / 10**9);
    
    // Initialize Raydium SDK to find/create pool
    console.log('\n🔧 Initializing Raydium SDK...');
    const raydium = await Raydium.load({
        connection,
        owner: wallet,
        cluster: 'devnet',
        disableLoadToken: false,
        blockhashCommitment: 'confirmed',
    });
    
    // For demo purposes, we'll create a simple swap transaction
    // In production, you would use an existing pool
    console.log('\n📋 Demo: Building swap transaction structure');
    
    // Get current sequence
    const fifoAccount = await connection.getAccountInfo(fifoState);
    if (!fifoAccount) {
        console.error('FIFO state not found!');
        return;
    }
    
    const currentSeq = fifoAccount.data.readBigUInt64LE(8);
    const nextSeq = currentSeq + BigInt(1);
    console.log('📊 Current sequence:', currentSeq.toString());
    console.log('📊 Next sequence:', nextSeq.toString());
    
    // Prepare swap parameters
    const amountIn = new BN(100).mul(new BN(10).pow(new BN(9))); // 100 Token A
    
    // Get delegate authority PDA
    const [delegateAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegate"), tokenAAccount.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    console.log('\n🔐 Delegate Authority:', delegateAuthority.toBase58());
    
    // Build transaction
    const tx = new Transaction();
    
    // 1. Approve delegate
    const approveIx = createApproveInstruction(
        tokenAAccount,
        delegateAuthority,
        wallet.publicKey,
        amountIn.toNumber()
    );
    tx.add(approveIx);
    
    console.log('✅ Added approve instruction');
    
    // 2. For demo, we'll show the structure of the swap instruction
    // In production, you would get pool keys and build proper Raydium swap data
    console.log('\n📋 Wrapper swap instruction structure:');
    console.log('- FIFO State:', fifoState.toBase58());
    console.log('- Delegate Authority:', delegateAuthority.toBase58());
    console.log('- User:', wallet.publicKey.toBase58());
    console.log('- User Source:', tokenAAccount.toBase58());
    console.log('- User Destination:', tokenBAccount.toBase58());
    console.log('- Sequence:', nextSeq.toString());
    
    // Demonstrate successful setup
    console.log('\n✅ Continuum Wrapper Setup Complete!');
    console.log('\n📝 Summary:');
    console.log('- Wrapper Program:', WRAPPER_PROGRAM_ID.toBase58());
    console.log('- FIFO State:', fifoState.toBase58());
    console.log('- Current Sequence:', currentSeq.toString());
    console.log('- Test Tokens Created');
    console.log('- Delegate Authority Derived');
    
    console.log('\n🎯 Next Steps:');
    console.log('1. Create or find an existing Raydium pool for your token pair');
    console.log('2. Use the ContinuumSDK to perform MEV-protected swaps');
    console.log('3. Monitor sequence numbers to ensure FIFO ordering');
    
    // Save test configuration
    const testConfig = {
        wrapperProgramId: WRAPPER_PROGRAM_ID.toBase58(),
        fifoState: fifoState.toBase58(),
        wallet: wallet.publicKey.toBase58(),
        tokenA: {
            mint: tokenAMint.toBase58(),
            account: tokenAAccount.toBase58(),
            decimals: 9
        },
        tokenB: {
            mint: tokenBMint.toBase58(),
            account: tokenBAccount.toBase58(),
            decimals: 9
        },
        delegateAuthority: delegateAuthority.toBase58(),
        currentSequence: currentSeq.toString(),
        timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../test-config-devnet.json'),
        JSON.stringify(testConfig, null, 2)
    );
    
    console.log('\n💾 Test configuration saved to test-config-devnet.json');
}

main().catch(console.error);