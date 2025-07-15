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
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress
} from '@solana/spl-token';
import { Raydium, TxVersion, DEVNET_PROGRAM_ID } from '@raydium-io/raydium-sdk-v2';
import { Liquidity, MARKET_STATE_LAYOUT_V3 } from '@raydium-io/raydium-sdk';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';

// Raydium devnet program IDs
const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');
const SERUM_PROGRAM = new PublicKey('DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY');
const AMM_CONFIG_ID = new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2');

async function main() {
    console.log('🚀 Creating Complete Raydium Pool on Devnet...\n');
    
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
        const sig = await connection.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
        balance = await connection.getBalance(wallet.publicKey);
        console.log('💰 New balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    }
    
    // Step 1: Create new tokens
    console.log('\n🪙 Creating new tokens...');
    
    // Create CONT token (Continuum)
    const contMint = await createMint(
        connection,
        wallet,
        wallet.publicKey,
        wallet.publicKey,
        9, // decimals
        undefined,
        { commitment: 'confirmed' },
        TOKEN_PROGRAM_ID
    );
    console.log('✅ CONT token created:', contMint.toBase58());
    
    // Create FIFO token
    const fifoMint = await createMint(
        connection,
        wallet,
        wallet.publicKey,
        wallet.publicKey,
        9, // decimals
        undefined,
        { commitment: 'confirmed' },
        TOKEN_PROGRAM_ID
    );
    console.log('✅ FIFO token created:', fifoMint.toBase58());
    
    // Step 2: Create token accounts and mint tokens
    console.log('\n💳 Creating token accounts...');
    
    const contAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet,
        contMint,
        wallet.publicKey
    );
    
    const fifoAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet,
        fifoMint,
        wallet.publicKey
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
    
    // Step 3: Create Serum/OpenBook market
    console.log('\n📊 Creating market...');
    
    // Market keypair
    const marketKeypair = Keypair.generate();
    const requestQueueKeypair = Keypair.generate();
    const eventQueueKeypair = Keypair.generate();
    const bidsKeypair = Keypair.generate();
    const asksKeypair = Keypair.generate();
    const baseVaultKeypair = Keypair.generate();
    const quoteVaultKeypair = Keypair.generate();
    
    // Calculate vault signer
    const [vaultSigner, vaultSignerNonce] = await PublicKey.findProgramAddress(
        [marketKeypair.publicKey.toBuffer()],
        SERUM_PROGRAM
    );
    
    // Create market accounts
    const createMarketAccounts = [
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: marketKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(MARKET_STATE_LAYOUT_V3.span),
            space: MARKET_STATE_LAYOUT_V3.span,
            programId: SERUM_PROGRAM,
        }),
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: requestQueueKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(5120 + 12),
            space: 5120 + 12,
            programId: SERUM_PROGRAM,
        }),
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: eventQueueKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(262144 + 12),
            space: 262144 + 12,
            programId: SERUM_PROGRAM,
        }),
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: bidsKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
            space: 65536 + 12,
            programId: SERUM_PROGRAM,
        }),
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: asksKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
            space: 65536 + 12,
            programId: SERUM_PROGRAM,
        }),
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: baseVaultKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(165),
            space: 165,
            programId: TOKEN_PROGRAM_ID,
        }),
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: quoteVaultKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(165),
            space: 165,
            programId: TOKEN_PROGRAM_ID,
        }),
    ];
    
    // Send create accounts transaction
    const createMarketTx = new Transaction().add(...createMarketAccounts);
    const createMarketSig = await sendAndConfirmTransaction(
        connection,
        createMarketTx,
        [wallet, marketKeypair, requestQueueKeypair, eventQueueKeypair, bidsKeypair, asksKeypair, baseVaultKeypair, quoteVaultKeypair],
        { commitment: 'confirmed' }
    );
    console.log('✅ Market accounts created:', createMarketSig);
    
    // Initialize market
    const initMarketInstruction = await Liquidity.makeInitMarketInstructionSimple({
        connection,
        wallet: wallet.publicKey,
        baseInfo: {
            mint: contMint,
            decimals: 9,
        },
        quoteInfo: {
            mint: fifoMint,
            decimals: 9,
        },
        lotSize: 1,
        tickSize: 0.01,
        dexProgramId: SERUM_PROGRAM,
        makeTxVersion: TxVersion.LEGACY,
        marketInfo: {
            marketAccount: marketKeypair.publicKey,
            requestQueue: requestQueueKeypair.publicKey,
            eventQueue: eventQueueKeypair.publicKey,
            bids: bidsKeypair.publicKey,
            asks: asksKeypair.publicKey,
            baseVault: baseVaultKeypair.publicKey,
            quoteVault: quoteVaultKeypair.publicKey,
            baseMint: contMint,
            quoteMint: fifoMint,
            vaultSignerNonce,
        }
    });
    
    const initMarketTx = new Transaction().add(...initMarketInstruction.innerTransactions[0].instructions);
    const initMarketSig = await sendAndConfirmTransaction(
        connection,
        initMarketTx,
        [wallet],
        { commitment: 'confirmed' }
    );
    console.log('✅ Market initialized:', initMarketSig);
    console.log('📊 Market ID:', marketKeypair.publicKey.toBase58());
    
    // Step 4: Create Raydium pool
    console.log('\n🏊 Creating Raydium pool...');
    
    // Initialize Raydium SDK
    const raydium = await Raydium.load({
        connection,
        owner: wallet,
        cluster: 'devnet',
        disableLoadToken: false,
        blockhashCommitment: 'confirmed',
    });
    
    // Generate pool keys
    const poolKeys = await Liquidity.getAssociatedPoolKeys({
        version: 4,
        marketVersion: 3,
        marketId: marketKeypair.publicKey,
        baseMint: contMint,
        quoteMint: fifoMint,
        baseDecimals: 9,
        quoteDecimals: 9,
        programId: RAYDIUM_AMM_V4,
        marketProgramId: SERUM_PROGRAM,
    });
    
    console.log('Pool ID:', poolKeys.id.toBase58());
    console.log('LP Mint:', poolKeys.lpMint.toBase58());
    
    // Create pool initialization instruction
    const baseAmount = new BN(100_000).mul(new BN(10).pow(new BN(9))); // 100k CONT
    const quoteAmount = new BN(100_000).mul(new BN(10).pow(new BN(9))); // 100k FIFO
    
    const poolInitInstruction = await Liquidity.makeCreatePoolV4InstructionV2Simple({
        connection,
        programId: RAYDIUM_AMM_V4,
        marketInfo: {
            marketId: marketKeypair.publicKey,
            programId: SERUM_PROGRAM,
        },
        baseMintInfo: {
            mint: contMint,
            decimals: 9,
        },
        quoteMintInfo: {
            mint: fifoMint,
            decimals: 9,
        },
        baseAmount,
        quoteAmount,
        startTime: new BN(0),
        ownerInfo: {
            feePayer: wallet.publicKey,
            wallet: wallet.publicKey,
            tokenAccounts: [contAccount.address, fifoAccount.address],
            useSOLBalance: false,
        },
        associatedOnly: true,
        makeTxVersion: TxVersion.LEGACY,
        feeDestinationId: PublicKey.default, // Update with proper fee destination
    });
    
    // Execute pool creation
    for (const itemIx of poolInitInstruction.innerTransactions) {
        const tx = new Transaction().add(...itemIx.instructions);
        const sig = await sendAndConfirmTransaction(
            connection,
            tx,
            [wallet, ...(itemIx.signers || [])],
            { commitment: 'confirmed' }
        );
        console.log('Pool creation step completed:', sig);
    }
    
    console.log('\n🎉 Pool created successfully!');
    console.log('Pool ID:', poolKeys.id.toBase58());
    
    // Save pool configuration
    const poolConfig = {
        // Pool info
        poolId: poolKeys.id.toBase58(),
        poolAuthority: poolKeys.authority.toBase58(),
        lpMint: poolKeys.lpMint.toBase58(),
        
        // Token info
        baseMint: contMint.toBase58(),
        quoteMint: fifoMint.toBase58(),
        baseDecimals: 9,
        quoteDecimals: 9,
        
        // Vault accounts
        baseVault: poolKeys.baseVault.toBase58(),
        quoteVault: poolKeys.quoteVault.toBase58(),
        
        // Market info
        marketId: marketKeypair.publicKey.toBase58(),
        marketProgramId: SERUM_PROGRAM.toBase58(),
        marketAuthority: poolKeys.marketAuthority.toBase58(),
        
        // OpenBook accounts
        openOrders: poolKeys.openOrders.toBase58(),
        targetOrders: poolKeys.targetOrders.toBase58(),
        bids: bidsKeypair.publicKey.toBase58(),
        asks: asksKeypair.publicKey.toBase58(),
        eventQueue: eventQueueKeypair.publicKey.toBase58(),
        requestQueue: requestQueueKeypair.publicKey.toBase58(),
        baseVaultMarket: baseVaultKeypair.publicKey.toBase58(),
        quoteVaultMarket: quoteVaultKeypair.publicKey.toBase58(),
        vaultSigner: vaultSigner.toBase58(),
        
        // Program IDs
        ammProgramId: RAYDIUM_AMM_V4.toBase58(),
        
        // Amounts
        initialBaseAmount: baseAmount.toString(),
        initialQuoteAmount: quoteAmount.toString(),
        
        // Wallet info
        wallet: wallet.publicKey.toBase58(),
        walletBaseAccount: contAccount.address.toBase58(),
        walletQuoteAccount: fifoAccount.address.toBase58(),
        
        // Timestamp
        createdAt: new Date().toISOString(),
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../raydium-pool-devnet.json'),
        JSON.stringify(poolConfig, null, 2)
    );
    
    console.log('\n💾 Pool configuration saved to raydium-pool-devnet.json');
    
    // Save token info
    const tokenConfig = {
        CONT: {
            mint: contMint.toBase58(),
            decimals: 9,
            account: contAccount.address.toBase58(),
            symbol: 'CONT',
            name: 'Continuum Token',
        },
        FIFO: {
            mint: fifoMint.toBase58(),
            decimals: 9,
            account: fifoAccount.address.toBase58(),
            symbol: 'FIFO',
            name: 'FIFO Token',
        },
        wallet: wallet.publicKey.toBase58(),
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../continuum-tokens-devnet.json'),
        JSON.stringify(tokenConfig, null, 2)
    );
    
    console.log('💾 Token configuration saved to continuum-tokens-devnet.json');
    
    console.log('\n✅ Setup complete! Ready for testing swaps through Continuum wrapper.');
}

main().catch(console.error);