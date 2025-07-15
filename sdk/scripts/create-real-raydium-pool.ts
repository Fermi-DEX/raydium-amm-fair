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
    createMint, 
    getOrCreateAssociatedTokenAccount, 
    mintTo, 
    TOKEN_PROGRAM_ID,
    getAccount
} from '@solana/spl-token';
import { 
    Liquidity,
    MARKET_STATE_LAYOUT_V3,
    SPL_MINT_LAYOUT,
    TokenAmount,
    Token,
    Percent,
    LIQUIDITY_STATE_LAYOUT_V4
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
    console.log('🚀 Creating Real Raydium Pool on Devnet...\n');
    
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
    
    // Load token info
    const tokenPath = path.join(__dirname, '../continuum-tokens-devnet.json');
    const tokenInfo = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    
    const contMint = new PublicKey(tokenInfo.CONT.mint);
    const fifoMint = new PublicKey(tokenInfo.FIFO.mint);
    const userContAccount = new PublicKey(tokenInfo.CONT.account);
    const userFifoAccount = new PublicKey(tokenInfo.FIFO.account);
    
    console.log('\n🪙 Tokens:');
    console.log('  CONT:', contMint.toBase58());
    console.log('  FIFO:', fifoMint.toBase58());
    
    // Check balances
    const contBalance = await getAccount(connection, userContAccount);
    const fifoBalance = await getAccount(connection, userFifoAccount);
    
    console.log('\n💰 Token Balances:');
    console.log('  CONT:', Number(contBalance.amount) / 10**9);
    console.log('  FIFO:', Number(fifoBalance.amount) / 10**9);
    
    try {
        // Step 1: Create Serum/OpenBook market
        console.log('\n📊 Creating Serum/OpenBook market...');
        
        // Generate keypairs for market accounts
        const marketKeypair = Keypair.generate();
        const requestQueueKeypair = Keypair.generate();
        const eventQueueKeypair = Keypair.generate();
        const bidsKeypair = Keypair.generate();
        const asksKeypair = Keypair.generate();
        const baseVaultKeypair = Keypair.generate();
        const quoteVaultKeypair = Keypair.generate();
        
        console.log('Market ID:', marketKeypair.publicKey.toBase58());
        
        // Calculate vault signer
        const [vaultSigner, vaultSignerNonce] = await PublicKey.findProgramAddress(
            [marketKeypair.publicKey.toBuffer()],
            SERUM_PROGRAM
        );
        
        // Create all market accounts
        const createAccountsIxs = [
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
        const createTx = new Transaction();
        createTx.add(...createAccountsIxs);
        
        console.log('Creating market accounts...');
        const createSig = await sendAndConfirmTransaction(
            connection,
            createTx,
            [wallet, marketKeypair, requestQueueKeypair, eventQueueKeypair, bidsKeypair, asksKeypair, baseVaultKeypair, quoteVaultKeypair],
            { commitment: 'confirmed' }
        );
        console.log('✅ Market accounts created:', createSig);
        
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
        
        // Step 2: Create Raydium AMM pool
        console.log('\n🏊 Creating Raydium AMM pool...');
        
        // Get pool keys
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
        console.log('LP Mint:', poolKeys.lpMint.toBase58());
        
        // Create pool initialization instruction
        const baseAmount = new BN(100_000).mul(new BN(10).pow(new BN(9))); // 100k CONT
        const quoteAmount = new BN(100_000).mul(new BN(10).pow(new BN(9))); // 100k FIFO
        
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
        const createPoolSig = await sendAndConfirmTransaction(
            connection,
            createPoolTx,
            [wallet],
            { commitment: 'confirmed' }
        );
        console.log('✅ Pool created:', createPoolSig);
        
        // Initialize pool authority in Continuum
        console.log('\n🔐 Initializing Continuum pool authority...');
        
        const [poolAuthorityState] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_authority_state"), poolKeys.id.toBuffer()],
            WRAPPER_PROGRAM_ID
        );
        
        const [continuumPoolAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_authority"), poolKeys.id.toBuffer()],
            WRAPPER_PROGRAM_ID
        );
        
        const initPoolAuthData = Buffer.concat([
            Buffer.from([245, 243, 142, 59, 138, 3, 209, 46]), // initialize_pool_authority discriminator
            poolKeys.id.toBuffer(),
        ]);
        
        const initPoolAuthIx = new TransactionInstruction({
            programId: WRAPPER_PROGRAM_ID,
            keys: [
                { pubkey: poolAuthorityState, isSigner: false, isWritable: true },
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
        
        // Save pool configuration
        const poolConfig = {
            poolId: poolKeys.id.toBase58(),
            poolType: 'AMM_V4',
            baseMint: contMint.toBase58(),
            quoteMint: fifoMint.toBase58(),
            lpMint: poolKeys.lpMint.toBase58(),
            baseDecimals: 9,
            quoteDecimals: 9,
            lpDecimals: 9,
            
            // Pool accounts
            ammAuthority: poolKeys.authority.toBase58(),
            openOrders: poolKeys.openOrders.toBase58(),
            targetOrders: poolKeys.targetOrders.toBase58(),
            baseVault: poolKeys.baseVault.toBase58(),
            quoteVault: poolKeys.quoteVault.toBase58(),
            poolCoinTokenAccount: poolKeys.baseVault.toBase58(),
            poolPcTokenAccount: poolKeys.quoteVault.toBase58(),
            
            // Market info
            marketId: marketKeypair.publicKey.toBase58(),
            marketProgramId: SERUM_PROGRAM.toBase58(),
            marketAuthority: poolKeys.marketAuthority.toBase58(),
            
            // Serum/OpenBook accounts
            serumMarket: marketKeypair.publicKey.toBase58(),
            serumBids: bidsKeypair.publicKey.toBase58(),
            serumAsks: asksKeypair.publicKey.toBase58(),
            serumEventQueue: eventQueueKeypair.publicKey.toBase58(),
            serumCoinVaultAccount: baseVaultKeypair.publicKey.toBase58(),
            serumPcVaultAccount: quoteVaultKeypair.publicKey.toBase58(),
            serumVaultSigner: vaultSigner.toBase58(),
            
            // Program IDs
            ammProgramId: RAYDIUM_AMM_V4.toBase58(),
            serumProgramId: SERUM_PROGRAM.toBase58(),
            tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
            
            // Continuum
            continuumAuthority: continuumPoolAuthority.toBase58(),
            poolAuthorityState: poolAuthorityState.toBase58(),
            
            // Amounts
            initialBaseAmount: baseAmount.toString(),
            initialQuoteAmount: quoteAmount.toString(),
            
            // Wallet info
            wallet: wallet.publicKey.toBase58(),
            
            createdAt: new Date().toISOString(),
        };
        
        fs.writeFileSync(
            path.join(__dirname, '../real-raydium-pool-devnet.json'),
            JSON.stringify(poolConfig, null, 2)
        );
        
        console.log('\n💾 Pool configuration saved to real-raydium-pool-devnet.json');
        console.log('\n✅ Setup complete! Real Raydium pool created with Continuum authority.');
        
    } catch (error: any) {
        console.error('\n❌ Error creating pool:', error);
        if (error.logs) {
            console.error('📋 Transaction logs:', error.logs);
        }
    }
}

main().catch(console.error);