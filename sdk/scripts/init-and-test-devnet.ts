#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
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
import { Program, AnchorProvider, BN, setProvider } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import IDL from '../src/idl/continuum_wrapper.json';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');

// Known Raydium V4 pools on devnet - RAY-USDC pool
const RAYDIUM_V4_PROGRAM = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');
const RAY_USDC_POOL = new PublicKey('EVzLJhqMtdC1nPmz8rNd6xGfVjDPxpLZgq7XJuNfMZ6');

async function main() {
    console.log('🚀 Initializing Continuum Wrapper on Devnet...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load test wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    if (!fs.existsSync(walletPath)) {
        console.error('Test wallet not found! Run create-pool-swap-devnet-v2.ts first');
        return;
    }
    
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Check balance
    const balance = await connection.getBalance(wallet.publicKey);
    console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    if (balance < 0.1 * LAMPORTS_PER_SOL) {
        console.log('❌ Insufficient balance. Need at least 0.1 SOL');
        return;
    }
    
    // Set up Anchor provider
    const provider = new AnchorProvider(connection, { publicKey: wallet.publicKey, signTransaction: async (tx) => tx, signAllTransactions: async (txs) => txs }, { commitment: 'confirmed' });
    setProvider(provider);
    
    const program = new Program(IDL as any, provider);
    
    // Get FIFO state PDA
    const [fifoState] = PublicKey.findProgramAddressSync(
        [Buffer.from("fifo_state")],
        WRAPPER_PROGRAM_ID
    );
    
    console.log('\n📝 FIFO State PDA:', fifoState.toBase58());
    
    // Check if already initialized
    const fifoAccount = await connection.getAccountInfo(fifoState);
    
    if (!fifoAccount) {
        console.log('\n🔧 Initializing FIFO state...');
        
        try {
            const tx = await program.methods
                .initialize()
                .accountsStrict({
                    fifoState,
                    payer: wallet.publicKey,
                    systemProgram: PublicKey.default,
                })
                .signers([wallet])
                .rpc();
                
            console.log('✅ FIFO state initialized! Tx:', tx);
            
            // Wait for confirmation
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            console.error('❌ Failed to initialize:', error);
            return;
        }
    } else {
        console.log('✅ FIFO state already initialized');
        
        // Read current sequence
        const seq = new BN(fifoAccount.data.slice(8, 16), 'le');
        console.log('📊 Current sequence:', seq.toString());
    }
    
    // Create test tokens if needed
    console.log('\n🪙 Setting up test tokens...');
    
    const tokensPath = path.join(__dirname, '../test-tokens-devnet.json');
    let tokenInfo;
    
    if (fs.existsSync(tokensPath)) {
        console.log('✅ Loading existing tokens...');
        tokenInfo = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    } else {
        console.log('Creating new test tokens...');
        
        // Create Token A
        const tokenAMint = await createMint(
            connection,
            wallet,
            wallet.publicKey,
            wallet.publicKey,
            9
        );
        
        // Create Token B  
        const tokenBMint = await createMint(
            connection,
            wallet,
            wallet.publicKey,
            wallet.publicKey,
            9
        );
        
        // Create token accounts
        const tokenAAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            wallet,
            tokenAMint,
            wallet.publicKey
        );
        
        const tokenBAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            wallet,
            tokenBMint,
            wallet.publicKey
        );
        
        // Mint tokens
        await mintTo(
            connection,
            wallet,
            tokenAMint,
            tokenAAccount.address,
            wallet,
            1000000 * 10 ** 9
        );
        
        await mintTo(
            connection,
            wallet,
            tokenBMint,
            tokenBAccount.address,
            wallet,
            1000000 * 10 ** 9
        );
        
        tokenInfo = {
            tokenA: {
                mint: tokenAMint.toBase58(),
                decimals: 9,
                account: tokenAAccount.address.toBase58()
            },
            tokenB: {
                mint: tokenBMint.toBase58(),
                decimals: 9,
                account: tokenBAccount.address.toBase58()
            },
            wallet: wallet.publicKey.toBase58()
        };
        
        fs.writeFileSync(tokensPath, JSON.stringify(tokenInfo, null, 2));
    }
    
    console.log('✅ Token A:', tokenInfo.tokenA.mint);
    console.log('✅ Token B:', tokenInfo.tokenB.mint);
    
    // For now, we'll skip the pool creation as it requires complex Raydium setup
    // In production, you would use an existing Raydium pool
    console.log('\n📋 Summary:');
    console.log('- Continuum Wrapper deployed at:', WRAPPER_PROGRAM_ID.toBase58());
    console.log('- FIFO State initialized at:', fifoState.toBase58());
    console.log('- Test tokens created');
    console.log('\n✨ Ready for testing swaps through the wrapper!');
    console.log('\nNext steps:');
    console.log('1. Create a Raydium pool using the official Raydium SDK');
    console.log('2. Use the ContinuumSDK to perform MEV-protected swaps');
    
    // Save deployment info
    const deploymentInfo = {
        wrapperProgramId: WRAPPER_PROGRAM_ID.toBase58(),
        fifoState: fifoState.toBase58(),
        deployedAt: new Date().toISOString(),
        network: 'devnet',
        wallet: wallet.publicKey.toBase58(),
        tokens: tokenInfo
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../deployment-devnet.json'),
        JSON.stringify(deploymentInfo, null, 2)
    );
}

main().catch(console.error);