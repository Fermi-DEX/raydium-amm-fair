#!/usr/bin/env ts-node
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { 
    Raydium, 
    TxVersion, 
    parseTokenAccountResp,
    AMM_V4,
    OPEN_BOOK_PROGRAM,
    FEE_DESTINATION_ID,
    DEVNET_PROGRAM_ID
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
// Devnet AMM config - this is required for pool creation
const AMM_CONFIG_ID = new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2');

async function main() {
    console.log('🚀 Creating Raydium Pool on Devnet...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load test wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Check balance
    const balance = await connection.getBalance(wallet.publicKey);
    console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    if (balance < 0.5 * LAMPORTS_PER_SOL) {
        console.log('❌ Insufficient balance. Need at least 0.5 SOL');
        return;
    }
    
    // Load test tokens
    const tokensPath = path.join(__dirname, '../test-tokens-devnet.json');
    const tokenInfo = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    
    const tokenAMint = new PublicKey(tokenInfo.toka.mint);
    const tokenBMint = new PublicKey(tokenInfo.tokb.mint);
    
    console.log('Token A:', tokenAMint.toBase58());
    console.log('Token B:', tokenBMint.toBase58());
    
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
        const baseAmount = new BN(10000).mul(new BN(10).pow(new BN(9))); // 10,000 Token A
        const quoteAmount = new BN(10000).mul(new BN(10).pow(new BN(9))); // 10,000 Token B
        
        console.log('\n📊 Pool Parameters:');
        console.log('Base amount (Token A):', baseAmount.div(new BN(10).pow(new BN(9))).toString());
        console.log('Quote amount (Token B):', quoteAmount.div(new BN(10).pow(new BN(9))).toString());
        console.log('Initial price: 1:1');
        
        // Create pool with proper parameters
        console.log('\n🏊 Creating pool...');
        
        const createPoolTx = await raydium.liquidity.createPoolV4({
            programId: DEVNET_PROGRAM_ID.AMM_V4,
            marketInfo: {
                marketId: PublicKey.default, // Will create new market
                programId: DEVNET_PROGRAM_ID.OPEN_BOOK_MARKET,
            },
            baseMintInfo: {
                mint: tokenAMint,
                decimals: 9,
            },
            quoteMintInfo: {
                mint: tokenBMint,
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
        
        console.log('\n📤 Submitting pool creation transaction...');
        
        // Execute the transaction
        const { txId } = await createPoolTx.execute({ sendAndConfirm: true });
        
        console.log('\n🎉 Pool created successfully!');
        console.log('📝 Transaction:', txId);
        
        // Get pool info
        const poolId = createPoolTx.extInfo.address.poolId;
        console.log('🏊 Pool ID:', poolId.toBase58());
        
        // Save pool configuration
        const poolConfig = {
            poolId: poolId.toBase58(),
            baseMint: tokenAMint.toBase58(),
            quoteMint: tokenBMint.toBase58(),
            lpMint: createPoolTx.extInfo.address.lpMint.toBase58(),
            baseVault: createPoolTx.extInfo.address.baseVault.toBase58(),
            quoteVault: createPoolTx.extInfo.address.quoteVault.toBase58(),
            marketId: createPoolTx.extInfo.address.marketId.toBase58(),
            marketProgramId: DEVNET_PROGRAM_ID.OPEN_BOOK_MARKET.toBase58(),
            ammProgramId: DEVNET_PROGRAM_ID.AMM_V4.toBase58(),
            ammAuthority: createPoolTx.extInfo.address.ammAuthority.toBase58(),
            ammOpenOrders: createPoolTx.extInfo.address.ammOpenOrders.toBase58(),
            ammTargetOrders: createPoolTx.extInfo.address.ammTargetOrders.toBase58(),
            initialBaseAmount: baseAmount.toString(),
            initialQuoteAmount: quoteAmount.toString(),
            createdAt: new Date().toISOString(),
            txId: txId,
        };
        
        fs.writeFileSync(
            path.join(__dirname, '../pool-config-devnet.json'),
            JSON.stringify(poolConfig, null, 2)
        );
        
        console.log('\n💾 Pool configuration saved to pool-config-devnet.json');
        console.log('\n✅ Pool is ready for swapping through the Continuum wrapper!');
        
    } catch (error: any) {
        console.error('\n❌ Error creating pool:', error);
        if (error.logs) {
            console.error('📋 Transaction logs:', error.logs);
        }
    }
}

main().catch(console.error);