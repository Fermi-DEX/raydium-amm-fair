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
    DEVNET_PROGRAM_ID,
    FEE_DESTINATION_ID
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');

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
        
        // Create pool using the createPoolV4 method (simpler than market+pool)
        console.log('\n🏊 Creating pool...');
        
        const createPoolTx = await raydium.liquidity.createPoolV4({
            programId: DEVNET_PROGRAM_ID.AMM_V4,
            marketInfo: {
                marketId: PublicKey.default, // Will create new market
                programId: DEVNET_PROGRAM_ID.OPEN_BOOK_PROGRAM,
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
        
        // Execute the transaction
        const { txId } = await createPoolTx.execute({ sendAndConfirm: true });
        
        console.log('\n🎉 Pool created successfully!');
        console.log('📝 Transaction:', txId);
        
        // Get pool info
        const poolId = createPoolTx.extInfo.address.ammId;
        console.log('🏊 Pool ID:', poolId.toBase58());
        
        // Initialize pool authority state in Continuum
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
        
        // Get pool keys from the created pool
        const poolKeys = createPoolTx.extInfo.address;
        
        // Save pool configuration (simplified)
        const poolConfig = {
            poolId: poolId.toBase58(),
            baseMint: contMint.toBase58(),
            quoteMint: fifoMint.toBase58(),
            lpMint: poolKeys.lpMint.toBase58(),
            baseVault: poolKeys.coinVault.toBase58(),
            quoteVault: poolKeys.pcVault.toBase58(),
            marketId: poolKeys.marketId.toBase58(),
            marketProgramId: DEVNET_PROGRAM_ID.OPEN_BOOK_PROGRAM.toBase58(),
            ammProgramId: DEVNET_PROGRAM_ID.AMM_V4.toBase58(),
            ammAuthority: poolKeys.ammAuthority.toBase58(),
            ammOpenOrders: poolKeys.ammOpenOrders.toBase58(),
            ammTargetOrders: poolKeys.ammTargetOrders.toBase58(),
            continuumAuthority: continuumPoolAuthority.toBase58(),
            poolAuthorityState: poolAuthorityState.toBase58(),
            initialBaseAmount: baseAmount.toString(),
            initialQuoteAmount: quoteAmount.toString(),
            createdAt: new Date().toISOString(),
            txId: txId,
            initAuthTxId: initAuthSig,
        };
        
        fs.writeFileSync(
            path.join(__dirname, '../continuum-pool-devnet.json'),
            JSON.stringify(poolConfig, null, 2)
        );
        
        console.log('\n💾 Pool configuration saved to continuum-pool-devnet.json');
        console.log('\n✅ Setup complete! Pool created with Continuum authority state.');
        console.log('\n📝 Next steps:');
        console.log('1. Fetch market account details for complete orderbook info');
        console.log('2. Update relayer with pool accounts from continuum-pool-devnet.json');
        console.log('3. Test swaps through Continuum wrapper');
        
    } catch (error: any) {
        console.error('\n❌ Error creating pool:', error);
        if (error.logs) {
            console.error('📋 Transaction logs:', error.logs);
        }
    }
}

main().catch(console.error);