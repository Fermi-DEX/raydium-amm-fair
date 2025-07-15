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
    TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress
} from '@solana/spl-token';
import { 
    Liquidity,
    MAINNET_PROGRAM_ID,
    jsonInfo2PoolKeys,
    LiquidityPoolKeys,
    TokenAmount,
    Token,
    Percent,
    CurrencyAmount
} from '@raydium-io/raydium-sdk';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');

// Use an existing Raydium pool on devnet for testing
// This is the SOL-USDC pool on devnet
const EXISTING_POOL_ID = new PublicKey('2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv');

async function main() {
    console.log('🚀 Testing with Existing Raydium Pool...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Check balance
    let balance = await connection.getBalance(wallet.publicKey);
    console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    // Load token info
    const tokenPath = path.join(__dirname, '../continuum-tokens-devnet.json');
    const tokenInfo = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    
    console.log('\n🏊 Using existing pool for testing:', EXISTING_POOL_ID.toBase58());
    
    // Fetch pool info
    const poolAccount = await connection.getAccountInfo(EXISTING_POOL_ID);
    if (!poolAccount) {
        console.log('❌ Pool not found');
        return;
    }
    
    console.log('✅ Pool found, owner:', poolAccount.owner.toBase58());
    
    // Initialize pool authority in Continuum for this pool
    console.log('\n🔐 Initializing Continuum pool authority...');
    
    const [poolAuthorityState] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority_state"), EXISTING_POOL_ID.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    const [continuumPoolAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority"), EXISTING_POOL_ID.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    console.log('Pool Authority State:', poolAuthorityState.toBase58());
    console.log('Continuum Pool Authority:', continuumPoolAuthority.toBase58());
    
    // Check if already initialized
    const existing = await connection.getAccountInfo(poolAuthorityState);
    if (existing) {
        console.log('✅ Pool authority already initialized');
    } else {
        // Initialize pool authority state
        const initPoolAuthData = Buffer.concat([
            Buffer.from([245, 243, 142, 59, 138, 3, 209, 46]), // initialize_pool_authority discriminator
            EXISTING_POOL_ID.toBuffer(), // pool_id parameter
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
    
    // Create a mock pool configuration for testing
    const mockPoolConfig = {
        poolType: 'AMM_V4',
        poolId: EXISTING_POOL_ID.toBase58(),
        ammAuthority: PublicKey.findProgramAddressSync(
            [EXISTING_POOL_ID.toBuffer(), Buffer.from([97, 109, 109, 32, 97, 117, 116, 104, 111, 114, 105, 116, 121])],
            new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8')
        )[0].toBase58(),
        baseVault: PublicKey.default.toBase58(),
        quoteVault: PublicKey.default.toBase58(),
        lpMint: PublicKey.default.toBase58(),
        openOrders: PublicKey.default.toBase58(),
        targetOrders: PublicKey.default.toBase58(),
        baseMint: tokenInfo.CONT.mint,
        quoteMint: tokenInfo.FIFO.mint,
        baseDecimals: 9,
        quoteDecimals: 9,
        marketId: PublicKey.default.toBase58(),
        marketProgramId: 'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
        continuumAuthority: continuumPoolAuthority.toBase58(),
        poolAuthorityState: poolAuthorityState.toBase58(),
        createdAt: new Date().toISOString(),
        note: 'Mock configuration using existing pool ID for testing wrapper'
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../continuum-real-pool-devnet.json'),
        JSON.stringify(mockPoolConfig, null, 2)
    );
    
    console.log('\n💾 Mock pool configuration saved');
    console.log('\n✅ Setup complete!');
    console.log('\n📝 Next steps:');
    console.log('1. Update relayer to use this pool configuration');
    console.log('2. Test swaps through Continuum wrapper');
    console.log('\n⚠️  Note: This uses an existing pool ID for testing.');
    console.log('The actual swap will fail because we don\'t control the pool authority.');
    console.log('But it allows us to test the wrapper logic with real account structures.');
}

main().catch(console.error);