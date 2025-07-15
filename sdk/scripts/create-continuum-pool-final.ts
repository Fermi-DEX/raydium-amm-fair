#!/usr/bin/env ts-node
import { 
    Connection, 
    Keypair, 
    LAMPORTS_PER_SOL, 
    PublicKey,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SystemProgram
} from '@solana/web3.js';
import { 
    getAccount,
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { 
    Raydium, 
    TxVersion,
    AMM_V4,
    OPEN_BOOK_PROGRAM,
    FEE_DESTINATION_ID
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');
const AMM_CONFIG_ID = new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2');

async function main() {
    console.log('🚀 Creating Continuum-Controlled Raydium Pool...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Check balance
    let balance = await connection.getBalance(wallet.publicKey);
    console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    if (balance < 0.5 * LAMPORTS_PER_SOL) {
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
    
    // Initialize Raydium SDK
    console.log('\n🔧 Initializing Raydium SDK...');
    const raydium = await Raydium.load({
        connection,
        owner: wallet,
        cluster: 'devnet',
        disableLoadToken: false,
        blockhashCommitment: 'confirmed',
    });
    
    console.log('✅ Raydium SDK initialized');
    
    try {
        // Define liquidity amounts
        const baseAmount = new BN(100_000).mul(new BN(10).pow(new BN(9))); // 100k CONT
        const quoteAmount = new BN(100_000).mul(new BN(10).pow(new BN(9))); // 100k FIFO
        
        console.log('\n📊 Pool Parameters:');
        console.log('Base amount (CONT):', baseAmount.div(new BN(10).pow(new BN(9))).toString());
        console.log('Quote amount (FIFO):', quoteAmount.div(new BN(10).pow(new BN(9))).toString());
        console.log('Initial price: 1:1');
        
        // Create market and pool
        console.log('\n🏊 Creating market and pool...');
        
        const { execute, extInfo } = await raydium.liquidity.createMarketAndPoolV4({
            programId: AMM_V4,
            marketProgram: OPEN_BOOK_PROGRAM,
            baseMintInfo: {
                mint: contMint,
                decimals: 9,
            },
            quoteMintInfo: {
                mint: fifoMint,
                decimals: 9,
            },
            baseAmount: baseAmount,
            quoteAmount: quoteAmount,
            startTime: new BN(0), // Start immediately
            ownerInfo: {
                feePayer: wallet.publicKey,
                useSOLBalance: true,
            },
            associatedOnly: false,
            checkCreateATAOwner: true,
            txVersion: TxVersion.V0,
            lotSize: 1,
            tickSize: 0.01,
            feeDestinationId: FEE_DESTINATION_ID,
            ammConfigId: AMM_CONFIG_ID,
        });
        
        console.log('\n📤 Executing pool creation transactions...');
        const { txIds } = await execute({ sequentially: true, sendAndConfirm: true });
        
        console.log('\n🎉 Pool created successfully!');
        console.log('📝 Transaction IDs:', txIds);
        console.log('🏊 Pool ID:', extInfo.address.ammId.toBase58());
        console.log('💎 LP Mint:', extInfo.address.lpMint.toBase58());
        console.log('📊 Market ID:', extInfo.address.marketId.toBase58());
        
        // Now initialize pool authority state in Continuum
        console.log('\n🔐 Initializing Continuum pool authority...');
        
        const poolId = extInfo.address.ammId;
        const [poolAuthorityState] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_authority_state"), poolId.toBuffer()],
            WRAPPER_PROGRAM_ID
        );
        
        const [continuumPoolAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_authority"), poolId.toBuffer()],
            WRAPPER_PROGRAM_ID
        );
        
        console.log('Pool Authority State:', poolAuthorityState.toBase58());
        console.log('Continuum Pool Authority:', continuumPoolAuthority.toBase58());
        
        // Initialize pool authority state
        const initPoolAuthData = Buffer.concat([
            Buffer.from([245, 243, 142, 59, 138, 3, 209, 46]), // initialize_pool_authority discriminator
        ]);
        
        const initPoolAuthIx = new TransactionInstruction({
            programId: WRAPPER_PROGRAM_ID,
            keys: [
                { pubkey: poolAuthorityState, isSigner: false, isWritable: true },
                { pubkey: poolId, isSigner: false, isWritable: false },
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
        
        // Save complete pool configuration
        const poolConfig = {
            // Pool identification
            poolId: poolId.toBase58(),
            ammAuthority: extInfo.address.ammAuthority.toBase58(),
            ammConfigId: AMM_CONFIG_ID.toBase58(),
            continuumAuthority: continuumPoolAuthority.toBase58(),
            poolAuthorityState: poolAuthorityState.toBase58(),
            
            // Token info
            baseMint: contMint.toBase58(),
            quoteMint: fifoMint.toBase58(),
            baseDecimals: 9,
            quoteDecimals: 9,
            lpMint: extInfo.address.lpMint.toBase58(),
            
            // Vault accounts
            baseVault: extInfo.address.baseVault.toBase58(),
            quoteVault: extInfo.address.quoteVault.toBase58(),
            poolCoinTokenAccount: extInfo.address.baseVault.toBase58(),
            poolPcTokenAccount: extInfo.address.quoteVault.toBase58(),
            
            // Pool accounts
            openOrders: extInfo.address.ammOpenOrders.toBase58(),
            targetOrders: extInfo.address.ammTargetOrders.toBase58(),
            
            // Market info
            marketId: extInfo.address.marketId.toBase58(),
            marketProgramId: OPEN_BOOK_PROGRAM.toBase58(),
            // Market authority will be derived from market account
            
            // Market accounts (we'll need to fetch these from market)
            serumMarket: extInfo.address.marketId.toBase58(),
            serumBids: 'FETCH_FROM_MARKET', // These need to be fetched from market account
            serumAsks: 'FETCH_FROM_MARKET',
            serumEventQueue: 'FETCH_FROM_MARKET',
            serumCoinVaultAccount: 'FETCH_FROM_MARKET',
            serumPcVaultAccount: 'FETCH_FROM_MARKET',
            serumVaultSigner: 'FETCH_FROM_MARKET',
            
            // Program IDs
            ammProgramId: AMM_V4.toBase58(),
            serumProgramId: OPEN_BOOK_PROGRAM.toBase58(),
            continuumProgramId: WRAPPER_PROGRAM_ID.toBase58(),
            tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
            
            // Amounts
            initialBaseAmount: baseAmount.toString(),
            initialQuoteAmount: quoteAmount.toString(),
            
            // Wallet info
            wallet: wallet.publicKey.toBase58(),
            walletBaseAccount: userContAccount.toBase58(),
            walletQuoteAccount: userFifoAccount.toBase58(),
            
            // Transaction info
            createTxIds: txIds,
            initAuthTxId: initAuthSig,
            createdAt: new Date().toISOString(),
        };
        
        fs.writeFileSync(
            path.join(__dirname, '../continuum-pool-devnet.json'),
            JSON.stringify(poolConfig, null, 2)
        );
        
        console.log('\n💾 Pool configuration saved to continuum-pool-devnet.json');
        console.log('\n✅ Setup complete!');
        console.log('\n📝 Next steps:');
        console.log('1. Run fetch-market-accounts.ts to get Serum orderbook addresses');
        console.log('2. Update relayer with real pool accounts');
        console.log('3. Test swaps through Continuum wrapper');
        console.log('\n⚠️  Note: The pool authority is currently set to Raydium default.');
        console.log('For full FIFO protection, pool authority should be transferred to Continuum.');
        
    } catch (error: any) {
        console.error('\n❌ Error creating pool:', error);
        if (error.logs) {
            console.error('📋 Transaction logs:', error.logs);
        }
    }
}

main().catch(console.error);