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
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');

async function main() {
    console.log('🚀 Initializing FIFO State on Devnet...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load test wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    if (!fs.existsSync(walletPath)) {
        // Create new wallet
        const wallet = Keypair.generate();
        fs.writeFileSync(walletPath, JSON.stringify(Array.from(wallet.secretKey)));
        console.log('Created new wallet:', wallet.publicKey.toBase58());
        
        // Request airdrop
        console.log('Requesting airdrop...');
        const sig = await connection.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
    }
    
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Check balance
    const balance = await connection.getBalance(wallet.publicKey);
    console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    // Get FIFO state PDA
    const [fifoState, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("fifo_state")],
        WRAPPER_PROGRAM_ID
    );
    
    console.log('📝 FIFO State PDA:', fifoState.toBase58());
    console.log('📝 Bump:', bump);
    
    // Check if already initialized
    const fifoAccount = await connection.getAccountInfo(fifoState);
    
    if (!fifoAccount) {
        console.log('\n🔧 Initializing FIFO state...');
        
        // Build initialize instruction manually
        const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]); // initialize
        
        const initIx = new TransactionInstruction({
            programId: WRAPPER_PROGRAM_ID,
            keys: [
                { pubkey: fifoState, isSigner: false, isWritable: true },
                { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
                { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // System program
            ],
            data: discriminator
        });
        
        const tx = new Transaction().add(initIx);
        
        try {
            const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
            console.log('✅ FIFO state initialized! Tx:', sig);
            
            // Wait for confirmation
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            console.error('❌ Failed to initialize:', error);
            return;
        }
    } else {
        console.log('✅ FIFO state already initialized');
        
        // Read current sequence
        const seq = fifoAccount.data.readBigUInt64LE(8);
        console.log('📊 Current sequence:', seq.toString());
    }
    
    console.log('\n✨ FIFO state ready!');
    
    // Save deployment info
    const deploymentInfo = {
        wrapperProgramId: WRAPPER_PROGRAM_ID.toBase58(),
        fifoState: fifoState.toBase58(),
        fifoStateBump: bump,
        deployedAt: new Date().toISOString(),
        network: 'devnet',
        wallet: wallet.publicKey.toBase58()
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../deployment-devnet.json'),
        JSON.stringify(deploymentInfo, null, 2)
    );
    
    console.log('💾 Deployment info saved to deployment-devnet.json');
}

main().catch(console.error);