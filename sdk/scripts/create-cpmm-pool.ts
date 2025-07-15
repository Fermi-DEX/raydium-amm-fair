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
    CREATE_CPMM_POOL_PROGRAM,
    DEVNET_PROGRAM_ID,
    FEE_DESTINATION_ID
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');

async function main() {
    console.log('🚀 Creating CPMM Pool for Continuum...\n');
    
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
        
        // Check if CPMM is available
        console.log('\n🏊 Checking CPMM availability...');
        
        if (!raydium.cpmm) {
            console.log('❌ CPMM module not available in SDK');
            console.log('Falling back to standard AMM V4...');
            
            // Create standard pool instead
            const createPoolTx = await raydium.liquidity.createPoolV4({
                programId: DEVNET_PROGRAM_ID.AMM_V4,
                marketInfo: {
                    marketId: PublicKey.default, // Will create new market
                    programId: DEVNET_PROGRAM_ID.SERUM_PROGRAM_ID_V3,
                },
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
                    useSOLBalance: true,
                },
                associatedOnly: false,
                txVersion: TxVersion.V0,
                feeDestinationId: FEE_DESTINATION_ID,
                computeBudgetConfig: {
                    units: 600000,
                    microLamports: 100000,
                },
            });
            
            console.log('\n📤 Executing pool creation transaction...');
            const { txId } = await createPoolTx.execute({ sendAndConfirm: true });
            console.log('✅ Pool created:', txId);
            
            const poolId = createPoolTx.extInfo.address.ammId;
            console.log('🏊 Pool ID:', poolId.toBase58());
            
            // Initialize pool authority in Continuum
            await initializePoolAuthority(connection, wallet, poolId);
            
            // Save pool configuration
            savePoolConfig(poolId, createPoolTx.extInfo.address, contMint, fifoMint, baseAmount, quoteAmount);
            
        } else {
            console.log('✅ CPMM available, creating concentrated pool...');
            
            // Create CPMM pool
            const createCpmmTx = await raydium.cpmm.createPool({
                mintA: contMint,
                mintB: fifoMint,
                config: {
                    // Use default CPMM config
                    tradeFeeBps: 25, // 0.25%
                    protocolFeeBps: 0,
                    fundFeeBps: 0,
                },
                initialPrice: 1, // 1:1 price
                startTime: new BN(0),
                txVersion: TxVersion.V0,
            });
            
            console.log('\n📤 Executing CPMM pool creation...');
            const { txId } = await createCpmmTx.execute({ sendAndConfirm: true });
            console.log('✅ CPMM Pool created:', txId);
            
            const poolId = createCpmmTx.extInfo.address.poolId;
            console.log('🏊 Pool ID:', poolId.toBase58());
            
            // Initialize pool authority in Continuum
            await initializePoolAuthority(connection, wallet, poolId);
            
            // Save CPMM pool configuration
            saveCpmmPoolConfig(poolId, createCpmmTx.extInfo.address, contMint, fifoMint);
        }
        
        console.log('\n✅ Setup complete!');
        console.log('\n📝 Next steps:');
        console.log('1. Update wrapper to support the pool type');
        console.log('2. Test swaps through Continuum wrapper');
        
    } catch (error: any) {
        console.error('\n❌ Error creating pool:', error);
        if (error.logs) {
            console.error('📋 Transaction logs:', error.logs);
        }
    }
}

async function initializePoolAuthority(
    connection: Connection,
    wallet: Keypair,
    poolId: PublicKey
): Promise<void> {
    console.log('\n🔐 Initializing Continuum pool authority...');
    
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
    
    // Check if already initialized
    const existing = await connection.getAccountInfo(poolAuthorityState);
    if (existing) {
        console.log('✅ Pool authority already initialized');
        return;
    }
    
    // Initialize pool authority state
    const initPoolAuthData = Buffer.concat([
        Buffer.from([245, 243, 142, 59, 138, 3, 209, 46]), // initialize_pool_authority discriminator
        poolId.toBuffer(), // pool_id parameter
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
}

function savePoolConfig(
    poolId: PublicKey,
    poolInfo: any,
    contMint: PublicKey,
    fifoMint: PublicKey,
    baseAmount: BN,
    quoteAmount: BN
): void {
    const poolConfig = {
        poolType: 'AMM_V4',
        poolId: poolId.toBase58(),
        ammAuthority: poolInfo.ammAuthority.toBase58(),
        baseVault: poolInfo.coinVault.toBase58(),
        quoteVault: poolInfo.pcVault.toBase58(),
        lpMint: poolInfo.lpMint.toBase58(),
        openOrders: poolInfo.ammOpenOrders.toBase58(),
        targetOrders: poolInfo.ammTargetOrders.toBase58(),
        baseMint: contMint.toBase58(),
        quoteMint: fifoMint.toBase58(),
        baseDecimals: 9,
        quoteDecimals: 9,
        initialBaseAmount: baseAmount.toString(),
        initialQuoteAmount: quoteAmount.toString(),
        createdAt: new Date().toISOString(),
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../continuum-pool-devnet.json'),
        JSON.stringify(poolConfig, null, 2)
    );
    
    console.log('\n💾 Pool configuration saved to continuum-pool-devnet.json');
}

function saveCpmmPoolConfig(
    poolId: PublicKey,
    poolInfo: any,
    contMint: PublicKey,
    fifoMint: PublicKey
): void {
    const poolConfig = {
        poolType: 'CPMM',
        poolId: poolId.toBase58(),
        vault0: poolInfo.vault0.toBase58(),
        vault1: poolInfo.vault1.toBase58(),
        lpMint: poolInfo.lpMint.toBase58(),
        mint0: contMint.toBase58(),
        mint1: fifoMint.toBase58(),
        decimals0: 9,
        decimals1: 9,
        createdAt: new Date().toISOString(),
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../continuum-cpmm-pool-devnet.json'),
        JSON.stringify(poolConfig, null, 2)
    );
    
    console.log('\n💾 CPMM Pool configuration saved to continuum-cpmm-pool-devnet.json');
}

main().catch(console.error);