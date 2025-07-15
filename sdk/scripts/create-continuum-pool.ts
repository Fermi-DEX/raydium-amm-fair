#!/usr/bin/env ts-node
import { 
    Connection, 
    Keypair, 
    LAMPORTS_PER_SOL, 
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
    SystemProgram,
    TransactionInstruction
} from '@solana/web3.js';
import { 
    getOrCreateAssociatedTokenAccount, 
    TOKEN_PROGRAM_ID,
    createInitializeAccountInstruction,
    getAccount
} from '@solana/spl-token';
import { 
    Liquidity, 
    MARKET_STATE_LAYOUT_V3,
    LiquidityPoolKeys,
    jsonInfo2PoolKeys,
    LiquidityPoolJsonInfo,
    TokenAmount,
    Token,
    Percent
} from '@raydium-io/raydium-sdk';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');

// Raydium devnet program IDs
const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');
const SERUM_PROGRAM = new PublicKey('DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY');

async function main() {
    console.log('🚀 Creating Continuum-Controlled Raydium Pool...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Load token info
    const tokenPath = path.join(__dirname, '../continuum-tokens-devnet.json');
    const tokenInfo = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    
    const contMint = new PublicKey(tokenInfo.CONT.mint);
    const fifoMint = new PublicKey(tokenInfo.FIFO.mint);
    const userContAccount = new PublicKey(tokenInfo.CONT.account);
    const userFifoAccount = new PublicKey(tokenInfo.FIFO.account);
    
    console.log('🪙 Tokens:');
    console.log('  CONT:', contMint.toBase58());
    console.log('  FIFO:', fifoMint.toBase58());
    
    // Check balances
    const contBalance = await getAccount(connection, userContAccount);
    const fifoBalance = await getAccount(connection, userFifoAccount);
    
    console.log('\n💰 Balances:');
    console.log('  CONT:', Number(contBalance.amount) / 10**9);
    console.log('  FIFO:', Number(fifoBalance.amount) / 10**9);
    
    // Step 1: Create Serum/OpenBook market
    console.log('\n📊 Creating market...');
    
    // Market keypairs
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
    const createAccountsTx = new Transaction();
    
    // Market account
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: marketKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(MARKET_STATE_LAYOUT_V3.span),
            space: MARKET_STATE_LAYOUT_V3.span,
            programId: SERUM_PROGRAM,
        })
    );
    
    // Request queue
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: requestQueueKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(5120 + 12),
            space: 5120 + 12,
            programId: SERUM_PROGRAM,
        })
    );
    
    // Event queue
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: eventQueueKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(262144 + 12),
            space: 262144 + 12,
            programId: SERUM_PROGRAM,
        })
    );
    
    // Bids
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: bidsKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
            space: 65536 + 12,
            programId: SERUM_PROGRAM,
        })
    );
    
    // Asks
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: asksKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
            space: 65536 + 12,
            programId: SERUM_PROGRAM,
        })
    );
    
    // Base vault
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: baseVaultKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(165),
            space: 165,
            programId: TOKEN_PROGRAM_ID,
        })
    );
    
    // Quote vault
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: quoteVaultKeypair.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(165),
            space: 165,
            programId: TOKEN_PROGRAM_ID,
        })
    );
    
    console.log('Creating market accounts...');
    const createSig = await sendAndConfirmTransaction(
        connection,
        createAccountsTx,
        [wallet, marketKeypair, requestQueueKeypair, eventQueueKeypair, bidsKeypair, asksKeypair, baseVaultKeypair, quoteVaultKeypair],
        { commitment: 'confirmed' }
    );
    console.log('✅ Market accounts created:', createSig);
    
    // Initialize token accounts for vaults
    const initVaultsTx = new Transaction();
    
    initVaultsTx.add(
        createInitializeAccountInstruction(
            baseVaultKeypair.publicKey,
            contMint,
            vaultSigner
        )
    );
    
    initVaultsTx.add(
        createInitializeAccountInstruction(
            quoteVaultKeypair.publicKey,
            fifoMint,
            vaultSigner
        )
    );
    
    await sendAndConfirmTransaction(
        connection,
        initVaultsTx,
        [wallet],
        { commitment: 'confirmed' }
    );
    console.log('✅ Vault token accounts initialized');
    
    // Initialize market
    const initMarketIx = await Liquidity.makeInitMarketInstruction({
        connection,
        wallet: wallet.publicKey,
        marketInfo: {
            programId: SERUM_PROGRAM,
            id: marketKeypair.publicKey,
            baseMint: contMint,
            quoteMint: fifoMint,
            baseVault: baseVaultKeypair.publicKey,
            quoteVault: quoteVaultKeypair.publicKey,
            vaultSignerNonce,
            requestQueue: requestQueueKeypair.publicKey,
            eventQueue: eventQueueKeypair.publicKey,
            bids: bidsKeypair.publicKey,
            asks: asksKeypair.publicKey,
        },
        baseLotSize: 1,
        quoteLotSize: 1,
        tickSize: 0.01,
        dexProgramId: SERUM_PROGRAM
    });
    
    const initMarketTx = new Transaction().add(initMarketIx);
    const initMarketSig = await sendAndConfirmTransaction(
        connection,
        initMarketTx,
        [wallet],
        { commitment: 'confirmed' }
    );
    console.log('✅ Market initialized:', initMarketSig);
    console.log('📊 Market ID:', marketKeypair.publicKey.toBase58());
    
    // Step 2: Get pool keys
    console.log('\n🔑 Generating pool keys...');
    
    const poolKeys = Liquidity.getAssociatedPoolKeys({
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
    console.log('Default Authority:', poolKeys.authority.toBase58());
    
    // Step 3: Create pool with Continuum as authority
    console.log('\n🏊 Creating pool with Continuum authority...');
    
    // First, we need to initialize the pool authority state in Continuum
    const [poolAuthorityState] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority_state"), poolKeys.id.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    const [continuumPoolAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority"), poolKeys.id.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    console.log('Continuum Pool Authority:', continuumPoolAuthority.toBase58());
    
    // Initialize pool authority state in Continuum
    const initPoolAuthData = Buffer.concat([
        Buffer.from([245, 243, 142, 59, 138, 3, 209, 46]), // initialize_pool_authority discriminator
    ]);
    
    const initPoolAuthIx = new TransactionInstruction({
        programId: WRAPPER_PROGRAM_ID,
        keys: [
            { pubkey: poolAuthorityState, isSigner: false, isWritable: true },
            { pubkey: poolKeys.id, isSigner: false, isWritable: false },
            { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: initPoolAuthData,
    });
    
    const initAuthTx = new Transaction().add(initPoolAuthIx);
    const initAuthSig = await sendAndConfirmTransaction(
        connection,
        initAuthTx,
        [wallet],
        { commitment: 'confirmed' }
    );
    console.log('✅ Continuum pool authority initialized:', initAuthSig);
    
    // Create pool with initial liquidity
    const baseAmount = new BN(100_000).mul(new BN(10).pow(new BN(9))); // 100k CONT
    const quoteAmount = new BN(100_000).mul(new BN(10).pow(new BN(9))); // 100k FIFO
    
    console.log('\n💧 Adding liquidity:');
    console.log('  CONT:', baseAmount.div(new BN(10).pow(new BN(9))).toString());
    console.log('  FIFO:', quoteAmount.div(new BN(10).pow(new BN(9))).toString());
    
    // Create pool instruction
    const createPoolIx = Liquidity.makeCreatePoolV4Instruction({
        programId: RAYDIUM_AMM_V4,
        ammId: poolKeys.id,
        ammAuthority: poolKeys.authority,
        ammOpenOrders: poolKeys.openOrders,
        lpMintAddress: poolKeys.lpMint,
        coinMintAddress: contMint,
        pcMintAddress: fifoMint,
        coinVault: poolKeys.baseVault,
        pcVault: poolKeys.quoteVault,
        ammTargetOrders: poolKeys.targetOrders,
        ammConfig: poolKeys.configId || PublicKey.default,
        createPoolFee: poolKeys.lpDecimals,
        marketId: marketKeypair.publicKey,
        marketProgramId: SERUM_PROGRAM,
        userWallet: wallet.publicKey,
        userCoinTokenAccount: userContAccount,
        userPcTokenAccount: userFifoAccount,
        userLpTokenAccount: await getOrCreateAssociatedTokenAccount(
            connection,
            wallet,
            poolKeys.lpMint,
            wallet.publicKey
        ).then(acc => acc.address),
        nonce: poolKeys.nonce,
        openTime: new BN(0),
        coinAmount: baseAmount,
        pcAmount: quoteAmount,
    });
    
    const createPoolTx = new Transaction().add(createPoolIx);
    const poolSig = await sendAndConfirmTransaction(
        connection,
        createPoolTx,
        [wallet],
        { commitment: 'confirmed' }
    );
    console.log('✅ Pool created:', poolSig);
    
    // Save pool configuration
    const poolConfig = {
        // Pool identification
        poolId: poolKeys.id.toBase58(),
        ammAuthority: poolKeys.authority.toBase58(),
        continuumAuthority: continuumPoolAuthority.toBase58(),
        poolAuthorityState: poolAuthorityState.toBase58(),
        
        // Token info
        baseMint: contMint.toBase58(),
        quoteMint: fifoMint.toBase58(),
        baseDecimals: 9,
        quoteDecimals: 9,
        lpMint: poolKeys.lpMint.toBase58(),
        
        // Vault accounts
        baseVault: poolKeys.baseVault.toBase58(),
        quoteVault: poolKeys.quoteVault.toBase58(),
        
        // Pool accounts
        openOrders: poolKeys.openOrders.toBase58(),
        targetOrders: poolKeys.targetOrders.toBase58(),
        
        // Market info
        marketId: marketKeypair.publicKey.toBase58(),
        marketProgramId: SERUM_PROGRAM.toBase58(),
        marketAuthority: poolKeys.marketAuthority.toBase58(),
        
        // Serum/OpenBook accounts
        serumBids: bidsKeypair.publicKey.toBase58(),
        serumAsks: asksKeypair.publicKey.toBase58(),
        serumEventQueue: eventQueueKeypair.publicKey.toBase58(),
        serumCoinVaultAccount: baseVaultKeypair.publicKey.toBase58(),
        serumPcVaultAccount: quoteVaultKeypair.publicKey.toBase58(),
        serumVaultSigner: vaultSigner.toBase58(),
        serumRequestQueue: requestQueueKeypair.publicKey.toBase58(),
        
        // Program IDs
        ammProgramId: RAYDIUM_AMM_V4.toBase58(),
        continuumProgramId: WRAPPER_PROGRAM_ID.toBase58(),
        
        // Amounts
        initialBaseAmount: baseAmount.toString(),
        initialQuoteAmount: quoteAmount.toString(),
        
        // Wallet info
        wallet: wallet.publicKey.toBase58(),
        walletBaseAccount: userContAccount.toBase58(),
        walletQuoteAccount: userFifoAccount.toBase58(),
        
        // Timestamp
        createdAt: new Date().toISOString(),
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../continuum-pool-devnet.json'),
        JSON.stringify(poolConfig, null, 2)
    );
    
    console.log('\n💾 Pool configuration saved to continuum-pool-devnet.json');
    console.log('\n✅ Setup complete! Pool created with Continuum authority control.');
    console.log('\n📝 Next steps:');
    console.log('1. Update relayer with real pool accounts');
    console.log('2. Test swaps through Continuum wrapper');
}

main().catch(console.error);