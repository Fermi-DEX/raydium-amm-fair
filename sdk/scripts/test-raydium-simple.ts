import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import * as fs from 'fs';

const DEVNET_URL = 'https://api.devnet.solana.com';

async function setupTokensAndWallet() {
    console.log('Setting up test environment on devnet...');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Create or load test wallet
    let testWallet: Keypair;
    const walletPath = 'test-wallet-devnet.json';
    
    if (fs.existsSync(walletPath)) {
        console.log('Loading existing test wallet...');
        const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        testWallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    } else {
        console.log('Creating new test wallet...');
        testWallet = Keypair.generate();
        fs.writeFileSync(walletPath, JSON.stringify(Array.from(testWallet.secretKey)));
    }
    
    console.log('Test wallet pubkey:', testWallet.publicKey.toBase58());
    
    // Check balance and request airdrop if needed
    let balance = await connection.getBalance(testWallet.publicKey);
    console.log('Current balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    if (balance < 2 * LAMPORTS_PER_SOL) {
        console.log('Requesting airdrop...');
        try {
            const airdropSig = await connection.requestAirdrop(testWallet.publicKey, 2 * LAMPORTS_PER_SOL);
            await connection.confirmTransaction(airdropSig);
            balance = await connection.getBalance(testWallet.publicKey);
            console.log('New balance:', balance / LAMPORTS_PER_SOL, 'SOL');
        } catch (error) {
            console.log('Airdrop failed, continuing with current balance');
        }
    }
    
    // Check if tokens already exist
    const tokenInfoPath = 'test-tokens-devnet.json';
    if (fs.existsSync(tokenInfoPath)) {
        console.log('\nTokens already exist, loading info...');
        const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf8'));
        console.log('TOKA mint:', tokenInfo.toka.mint);
        console.log('TOKB mint:', tokenInfo.tokb.mint);
        return { testWallet, tokenInfo, connection };
    }
    
    // Create test tokens
    console.log('\nCreating test tokens...');
    
    // Create TOKA token
    console.log('Creating TOKA token...');
    const tokaMint = await createMint(
        connection,
        testWallet,
        testWallet.publicKey,
        testWallet.publicKey,
        9 // decimals
    );
    console.log('TOKA mint:', tokaMint.toBase58());
    
    // Create TOKB token
    console.log('Creating TOKB token...');
    const tokbMint = await createMint(
        connection,
        testWallet,
        testWallet.publicKey,
        testWallet.publicKey,
        9 // decimals
    );
    console.log('TOKB mint:', tokbMint.toBase58());
    
    // Create token accounts and mint tokens
    const tokaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        testWallet,
        tokaMint,
        testWallet.publicKey
    );
    
    const tokbAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        testWallet,
        tokbMint,
        testWallet.publicKey
    );
    
    // Mint 1M tokens of each
    await mintTo(
        connection,
        testWallet,
        tokaMint,
        tokaAccount.address,
        testWallet,
        1000000 * 10 ** 9
    );
    
    await mintTo(
        connection,
        testWallet,
        tokbMint,
        tokbAccount.address,
        testWallet,
        1000000 * 10 ** 9
    );
    
    console.log('Minted 1M TOKA and 1M TOKB');
    
    // Save token info
    const tokenInfo = {
        toka: {
            mint: tokaMint.toBase58(),
            decimals: 9,
            account: tokaAccount.address.toBase58(),
        },
        tokb: {
            mint: tokbMint.toBase58(),
            decimals: 9,
            account: tokbAccount.address.toBase58(),
        },
        wallet: testWallet.publicKey.toBase58(),
    };
    
    fs.writeFileSync(tokenInfoPath, JSON.stringify(tokenInfo, null, 2));
    console.log('Token info saved to', tokenInfoPath);
    
    return { testWallet, tokenInfo, connection };
}

async function main() {
    try {
        const { testWallet, tokenInfo, connection } = await setupTokensAndWallet();
        
        console.log('\n=== Test Environment Ready ===');
        console.log('Wallet:', testWallet.publicKey.toBase58());
        console.log('TOKA:', tokenInfo.toka.mint);
        console.log('TOKB:', tokenInfo.tokb.mint);
        console.log('\nNext steps:');
        console.log('1. Use an existing Raydium pool on devnet');
        console.log('2. Or create a new pool using Raydium UI');
        console.log('3. Then test swaps with these tokens');
        
    } catch (error) {
        console.error('Error:', error);
    }
}

main();