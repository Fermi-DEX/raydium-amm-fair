#!/usr/bin/env ts-node
import { 
    Connection, 
    Keypair, 
    LAMPORTS_PER_SOL, 
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
    SystemProgram
} from '@solana/web3.js';
import { 
    createMint, 
    getOrCreateAssociatedTokenAccount, 
    mintTo, 
    TOKEN_PROGRAM_ID,
    transfer
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';

async function main() {
    console.log('🚀 Creating Tokens and Preparing for Raydium Pool...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Check balance
    let balance = await connection.getBalance(wallet.publicKey);
    console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    if (balance < 1 * LAMPORTS_PER_SOL) {
        console.log('💸 Requesting airdrop...');
        try {
            const sig = await connection.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
            await connection.confirmTransaction(sig);
            balance = await connection.getBalance(wallet.publicKey);
            console.log('💰 New balance:', balance / LAMPORTS_PER_SOL, 'SOL');
        } catch (e) {
            console.log('Airdrop failed, continuing anyway...');
        }
    }
    
    // Step 1: Create new tokens
    console.log('\n🪙 Creating new tokens...');
    
    // Create CONT token (Continuum)
    const contMint = await createMint(
        connection,
        wallet,
        wallet.publicKey,
        wallet.publicKey,
        9 // decimals
    );
    console.log('✅ CONT token created:', contMint.toBase58());
    
    // Create FIFO token
    const fifoMint = await createMint(
        connection,
        wallet,
        wallet.publicKey,
        wallet.publicKey,
        9 // decimals
    );
    console.log('✅ FIFO token created:', fifoMint.toBase58());
    
    // Step 2: Create token accounts and mint tokens
    console.log('\n💳 Creating token accounts...');
    
    const contAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet,
        contMint,
        wallet.publicKey,
        false,
        'confirmed'
    );
    
    const fifoAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet,
        fifoMint,
        wallet.publicKey,
        false,
        'confirmed'
    );
    
    // Mint tokens
    console.log('\n🏭 Minting tokens...');
    const mintAmount = 1_000_000 * 10 ** 9; // 1M tokens
    
    await mintTo(
        connection,
        wallet,
        contMint,
        contAccount.address,
        wallet,
        mintAmount
    );
    
    await mintTo(
        connection,
        wallet,
        fifoMint,
        fifoAccount.address,
        wallet,
        mintAmount
    );
    
    console.log('✅ Minted 1M CONT and 1M FIFO tokens');
    
    // Save token configuration
    const tokenConfig = {
        CONT: {
            mint: contMint.toBase58(),
            decimals: 9,
            account: contAccount.address.toBase58(),
            symbol: 'CONT',
            name: 'Continuum Token',
            supply: mintAmount.toString()
        },
        FIFO: {
            mint: fifoMint.toBase58(),
            decimals: 9,
            account: fifoAccount.address.toBase58(),
            symbol: 'FIFO',
            name: 'FIFO Token',
            supply: mintAmount.toString()
        },
        wallet: wallet.publicKey.toBase58(),
        createdAt: new Date().toISOString()
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../continuum-tokens-devnet.json'),
        JSON.stringify(tokenConfig, null, 2)
    );
    
    console.log('\n💾 Token configuration saved to continuum-tokens-devnet.json');
    
    // Step 3: For Raydium pool creation, we'll need to use an existing pool or create one manually
    // Since Raydium SDK V2 pool creation is complex, let's find an existing USDC pool
    console.log('\n📊 Pool Creation Notes:');
    console.log('To create a Raydium pool, you need:');
    console.log('1. Create OpenBook/Serum market first');
    console.log('2. Initialize Raydium AMM pool');
    console.log('3. Add initial liquidity');
    console.log('\nFor testing, we can:');
    console.log('- Use these tokens with manual pool creation');
    console.log('- Or swap existing tokens through known pools');
    
    // Let's create a mock pool configuration for testing
    const mockPoolConfig = {
        // This is a placeholder - in production, use actual pool creation
        poolId: PublicKey.findProgramAddressSync(
            [Buffer.from('mock_pool'), contMint.toBuffer(), fifoMint.toBuffer()],
            new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8')
        )[0].toBase58(),
        baseMint: contMint.toBase58(),
        quoteMint: fifoMint.toBase58(),
        lpMint: 'TBD - Create with pool',
        baseVault: 'TBD - Create with pool',
        quoteVault: 'TBD - Create with pool',
        note: 'This is a mock configuration. Create actual pool using Raydium tools or SDK.'
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../mock-pool-config.json'),
        JSON.stringify(mockPoolConfig, null, 2)
    );
    
    console.log('\n💾 Mock pool configuration saved');
    console.log('\n✅ Tokens created and ready for pool creation!');
}

main().catch(console.error);