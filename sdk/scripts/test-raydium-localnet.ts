import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createInitializeMintInstruction, getMintLen, createInitializeAccountInstruction, getAccountLen, createMintToInstruction, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, MINT_SIZE } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const LOCALNET_URL = 'http://127.0.0.1:8899';

async function main() {
    console.log('Starting Raydium localnet testing...');
    
    const connection = new Connection(LOCALNET_URL, 'confirmed');
    
    // Create test wallet
    const testWallet = Keypair.generate();
    console.log('Test wallet pubkey:', testWallet.publicKey.toBase58());
    
    // Save wallet for later use
    fs.writeFileSync('test-wallet.json', JSON.stringify(Array.from(testWallet.secretKey)));
    
    // Fund test wallet
    console.log('Requesting airdrop...');
    const airdropSig = await connection.requestAirdrop(testWallet.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropSig);
    
    const balance = await connection.getBalance(testWallet.publicKey);
    console.log('Test wallet balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    // Create TOKA token
    console.log('\nCreating TOKA token...');
    const tokaKeypair = Keypair.generate();
    const tokaDecimals = 9;
    
    const createTokaAccountIx = SystemProgram.createAccount({
        fromPubkey: testWallet.publicKey,
        newAccountPubkey: tokaKeypair.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE),
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
    });
    
    const initTokaIx = createInitializeMintInstruction(
        tokaKeypair.publicKey,
        tokaDecimals,
        testWallet.publicKey,
        testWallet.publicKey,
    );
    
    // Create TOKB token
    console.log('Creating TOKB token...');
    const tokbKeypair = Keypair.generate();
    const tokbDecimals = 9;
    
    const createTokbAccountIx = SystemProgram.createAccount({
        fromPubkey: testWallet.publicKey,
        newAccountPubkey: tokbKeypair.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE),
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
    });
    
    const initTokbIx = createInitializeMintInstruction(
        tokbKeypair.publicKey,
        tokbDecimals,
        testWallet.publicKey,
        testWallet.publicKey,
    );
    
    // Create token accounts
    const tokaAta = await getAssociatedTokenAddress(tokaKeypair.publicKey, testWallet.publicKey);
    const tokbAta = await getAssociatedTokenAddress(tokbKeypair.publicKey, testWallet.publicKey);
    
    const createTokaAtaIx = createAssociatedTokenAccountInstruction(
        testWallet.publicKey,
        tokaAta,
        testWallet.publicKey,
        tokaKeypair.publicKey,
    );
    
    const createTokbAtaIx = createAssociatedTokenAccountInstruction(
        testWallet.publicKey,
        tokbAta,
        testWallet.publicKey,
        tokbKeypair.publicKey,
    );
    
    // Mint tokens
    const mintTokaIx = createMintToInstruction(
        tokaKeypair.publicKey,
        tokaAta,
        testWallet.publicKey,
        1000000 * 10 ** tokaDecimals, // 1M TOKA
    );
    
    const mintTokbIx = createMintToInstruction(
        tokbKeypair.publicKey,
        tokbAta,
        testWallet.publicKey,
        1000000 * 10 ** tokbDecimals, // 1M TOKB
    );
    
    // Execute transactions
    const tx = new Transaction().add(
        createTokaAccountIx,
        initTokaIx,
        createTokbAccountIx,
        initTokbIx,
        createTokaAtaIx,
        createTokbAtaIx,
        mintTokaIx,
        mintTokbIx,
    );
    
    const sig = await connection.sendTransaction(tx, [testWallet, tokaKeypair, tokbKeypair]);
    await connection.confirmTransaction(sig);
    
    console.log('Tokens created successfully!');
    console.log('TOKA mint:', tokaKeypair.publicKey.toBase58());
    console.log('TOKB mint:', tokbKeypair.publicKey.toBase58());
    
    // Save token info
    const tokenInfo = {
        toka: {
            mint: tokaKeypair.publicKey.toBase58(),
            decimals: tokaDecimals,
            ata: tokaAta.toBase58(),
        },
        tokb: {
            mint: tokbKeypair.publicKey.toBase58(),
            decimals: tokbDecimals,
            ata: tokbAta.toBase58(),
        },
        wallet: testWallet.publicKey.toBase58(),
    };
    
    fs.writeFileSync('test-tokens.json', JSON.stringify(tokenInfo, null, 2));
    console.log('\nToken info saved to test-tokens.json');
}

main().catch(console.error);