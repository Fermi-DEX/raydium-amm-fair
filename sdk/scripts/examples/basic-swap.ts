#!/usr/bin/env ts-node
import { 
    Connection, 
    Keypair, 
    PublicKey, 
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    ComputeBudgetProgram,
    AccountMeta,
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const CONTINUUM_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');
const FIFO_STATE = new PublicKey('E9S7ikGZJASpHTeFupagxJKvmqXyMsbCMp7KfErQbV3D');
const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');

interface SwapParams {
    connection: Connection;
    wallet: Keypair;
    poolId: PublicKey;
    tokenInMint: PublicKey;
    tokenOutMint: PublicKey;
    amountIn: BN;
    minAmountOut: BN;
}

async function performSwap(params: SwapParams) {
    const { connection, wallet, poolId, tokenInMint, tokenOutMint, amountIn, minAmountOut } = params;
    
    console.log('🚀 Starting Continuum FIFO Swap...\n');
    console.log('Pool:', poolId.toBase58());
    console.log('Token In:', tokenInMint.toBase58());
    console.log('Token Out:', tokenOutMint.toBase58());
    console.log('Amount In:', amountIn.toString());
    
    // Get user token accounts
    const userTokenIn = await getAssociatedTokenAddress(tokenInMint, wallet.publicKey);
    const userTokenOut = await getAssociatedTokenAddress(tokenOutMint, wallet.publicKey);
    
    console.log('\n📍 User Token Accounts:');
    console.log('Input:', userTokenIn.toBase58());
    console.log('Output:', userTokenOut.toBase58());
    
    // Check if output account exists, create if needed
    const outputAccountInfo = await connection.getAccountInfo(userTokenOut);
    const setupTx = new Transaction();
    
    if (!outputAccountInfo) {
        console.log('\nCreating output token account...');
        setupTx.add(
            createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                userTokenOut,
                wallet.publicKey,
                tokenOutMint
            )
        );
    }
    
    if (setupTx.instructions.length > 0) {
        const setupSig = await sendAndConfirmTransaction(connection, setupTx, [wallet]);
        console.log('✅ Token account created:', setupSig);
    }
    
    // Get current sequence
    const fifoAccount = await connection.getAccountInfo(FIFO_STATE);
    if (!fifoAccount) {
        throw new Error('FIFO state not found!');
    }
    
    const currentSeq = fifoAccount.data.readBigUInt64LE(8);
    const nextSeq = currentSeq + BigInt(1);
    console.log('\n📊 FIFO Sequence:', nextSeq.toString());
    
    // Get PDAs
    const [poolAuthorityState] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority_state"), poolId.toBuffer()],
        CONTINUUM_PROGRAM_ID
    );
    
    const [poolAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority"), poolId.toBuffer()],
        CONTINUUM_PROGRAM_ID
    );
    
    const [delegateAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegate"), userTokenIn.toBuffer()],
        CONTINUUM_PROGRAM_ID
    );
    
    // Build Raydium swap instruction data
    const raydiumSwapData = Buffer.concat([
        Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]), // Raydium swap discriminator
        amountIn.toArrayLike(Buffer, 'le', 8),
        minAmountOut.toArrayLike(Buffer, 'le', 8),
    ]);
    
    // Build wrapper instruction
    const wrapperDiscriminator = Buffer.from([237, 180, 80, 103, 107, 172, 187, 137]); // swap_with_pool_authority
    const seqBuffer = Buffer.alloc(8);
    seqBuffer.writeBigUInt64LE(nextSeq);
    
    const raydiumDataLen = Buffer.alloc(4);
    raydiumDataLen.writeUInt32LE(raydiumSwapData.length);
    
    const wrapperIxData = Buffer.concat([
        wrapperDiscriminator,
        seqBuffer,
        raydiumDataLen,
        raydiumSwapData,
    ]);
    
    // Load pool configuration (you would load this from your pool config)
    const poolConfigPath = path.join(__dirname, '../../existing-pool-config-devnet.json');
    const poolConfig = JSON.parse(fs.readFileSync(poolConfigPath, 'utf8'));
    
    // Build complete account list
    const accounts: AccountMeta[] = [
        // Wrapper-specific accounts
        { pubkey: FIFO_STATE, isSigner: false, isWritable: true },
        { pubkey: poolAuthorityState, isSigner: false, isWritable: false },
        { pubkey: poolAuthority, isSigner: false, isWritable: false },
        { pubkey: delegateAuthority, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: userTokenIn, isSigner: false, isWritable: true },
        { pubkey: userTokenOut, isSigner: false, isWritable: true },
        { pubkey: RAYDIUM_AMM_V4, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        
        // Raydium accounts (remaining_accounts)
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(poolConfig.poolId), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.ammAuthority), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(poolConfig.openOrders), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.targetOrders), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.poolCoinTokenAccount), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.poolPcTokenAccount), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.serumProgramId), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(poolConfig.serumMarket), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.serumBids), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.serumAsks), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.serumEventQueue), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.serumCoinVaultAccount), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.serumPcVaultAccount), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.serumVaultSigner), isSigner: false, isWritable: false },
        { pubkey: userTokenIn, isSigner: false, isWritable: true },
        { pubkey: userTokenOut, isSigner: false, isWritable: true },
        { pubkey: poolAuthority, isSigner: false, isWritable: false },
    ];
    
    const swapIx = new TransactionInstruction({
        programId: CONTINUUM_PROGRAM_ID,
        keys: accounts,
        data: wrapperIxData,
    });
    
    // Build transaction
    const swapTx = new Transaction();
    swapTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
    swapTx.add(swapIx);
    
    console.log('\n📤 Sending swap transaction...');
    
    try {
        const signature = await sendAndConfirmTransaction(
            connection,
            swapTx,
            [wallet],
            { commitment: 'confirmed' }
        );
        
        console.log('\n✅ Swap successful!');
        console.log('📝 Signature:', signature);
        console.log('🔍 View on Solscan:', `https://solscan.io/tx/${signature}?cluster=devnet`);
        
        return { success: true, signature };
    } catch (error: any) {
        console.error('\n❌ Swap failed:', error.message);
        if (error.logs) {
            console.error('\n📋 Transaction logs:');
            error.logs.forEach((log: string) => console.error(log));
        }
        return { success: false, error };
    }
}

// Example usage
async function main() {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Load wallet
    const walletPath = path.join(__dirname, '../../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    
    // Example: Swap 0.001 SOL for base token
    const poolConfig = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../../existing-pool-config-devnet.json'), 'utf8')
    );
    
    await performSwap({
        connection,
        wallet,
        poolId: new PublicKey(poolConfig.poolId),
        tokenInMint: new PublicKey(poolConfig.quoteMint), // SOL
        tokenOutMint: new PublicKey(poolConfig.baseMint),
        amountIn: new BN(0.001 * LAMPORTS_PER_SOL),
        minAmountOut: new BN(0), // Accept any amount for testing
    });
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}