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
    SystemProgram
} from '@solana/web3.js';
import { 
    getAccount,
    createApproveCheckedInstruction,
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');
const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');

async function testSwap() {
    console.log('🚀 Testing Swap through Continuum Wrapper...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load configurations
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const deploymentPath = path.join(__dirname, '../deployment-devnet.json');
    const tokensPath = path.join(__dirname, '../continuum-tokens-devnet.json');
    const poolConfigPath = path.join(__dirname, '../test-pool-config-devnet.json');
    
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const tokenInfo = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    const poolConfig = JSON.parse(fs.readFileSync(poolConfigPath, 'utf8'));
    
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Get accounts
    const fifoState = new PublicKey(deployment.fifoState);
    const poolId = new PublicKey(poolConfig.poolId);
    
    // Token accounts
    const contMint = new PublicKey(tokenInfo.CONT.mint);
    const fifoMint = new PublicKey(tokenInfo.FIFO.mint);
    const userContAccount = new PublicKey(tokenInfo.CONT.account);
    const userFifoAccount = new PublicKey(tokenInfo.FIFO.account);
    
    // Check balances
    const contBalance = await getAccount(connection, userContAccount);
    const fifoBalance = await getAccount(connection, userFifoAccount);
    
    console.log('\n💰 Token Balances:');
    console.log('CONT:', Number(contBalance.amount) / 10**9);
    console.log('FIFO:', Number(fifoBalance.amount) / 10**9);
    
    // Initialize pool authority state if not already done
    const [poolAuthorityState] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority_state"), poolId.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    const [poolAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority"), poolId.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    // Check if pool authority state exists
    const poolAuthStateAccount = await connection.getAccountInfo(poolAuthorityState);
    if (!poolAuthStateAccount) {
        console.log('\n🔐 Initializing pool authority state...');
        
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
        
        const initTx = new Transaction().add(initPoolAuthIx);
        const initSig = await sendAndConfirmTransaction(connection, initTx, [wallet]);
        console.log('✅ Pool authority initialized:', initSig);
    }
    
    // Get current sequence
    const fifoAccount = await connection.getAccountInfo(fifoState);
    if (!fifoAccount) {
        console.error('FIFO state not found!');
        return;
    }
    
    const currentSeq = fifoAccount.data.readBigUInt64LE(8);
    const nextSeq = currentSeq + BigInt(1);
    console.log('\n📊 Current sequence:', currentSeq.toString());
    console.log('📊 Next sequence:', nextSeq.toString());
    
    // Prepare swap: CONT -> FIFO
    const amountIn = new BN(100).mul(new BN(10).pow(new BN(9))); // 100 CONT
    const minAmountOut = new BN(90).mul(new BN(10).pow(new BN(9))); // 90 FIFO (10% slippage)
    
    console.log('\n💱 Swap Parameters:');
    console.log('Swapping', amountIn.div(new BN(10).pow(new BN(9))).toString(), 'CONT for FIFO');
    console.log('Minimum out:', minAmountOut.div(new BN(10).pow(new BN(9))).toString(), 'FIFO');
    
    // Get delegate authority
    const [delegateAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegate"), userContAccount.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    // Build transaction
    const tx = new Transaction();
    
    // Add compute budget
    tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 })
    );
    
    // Approve delegate
    const approveIx = createApproveCheckedInstruction(
        userContAccount,
        contMint,
        delegateAuthority,
        wallet.publicKey,
        amountIn.toNumber(),
        9
    );
    tx.add(approveIx);
    
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
    
    // Build account list (simplified for mock testing)
    const accounts: AccountMeta[] = [
        // Wrapper-specific accounts
        { pubkey: fifoState, isSigner: false, isWritable: true },
        { pubkey: poolAuthorityState, isSigner: false, isWritable: false },
        { pubkey: poolAuthority, isSigner: false, isWritable: false },
        { pubkey: delegateAuthority, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: userContAccount, isSigner: false, isWritable: true },
        { pubkey: userFifoAccount, isSigner: false, isWritable: true },
        { pubkey: RAYDIUM_AMM_V4, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        
        // Mock Raydium accounts (all using default pubkey for testing)
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: poolId, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.ammAuthority), isSigner: false, isWritable: false },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.serumProgramId), isSigner: false, isWritable: false },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: false },
        { pubkey: userContAccount, isSigner: false, isWritable: true },
        { pubkey: userFifoAccount, isSigner: false, isWritable: true },
        { pubkey: poolAuthority, isSigner: false, isWritable: false },
    ];
    
    const wrapperIx = new TransactionInstruction({
        programId: WRAPPER_PROGRAM_ID,
        keys: accounts,
        data: wrapperIxData,
    });
    
    tx.add(wrapperIx);
    
    console.log('\n📝 Transaction built');
    console.log('- Compute budget: 600,000 units');
    console.log('- Approve instruction for delegate');
    console.log('- Wrapper swap instruction with sequence', nextSeq.toString());
    console.log('- Total accounts:', accounts.length);
    
    try {
        console.log('\n📤 Sending transaction...');
        const signature = await sendAndConfirmTransaction(
            connection,
            tx,
            [wallet],
            { commitment: 'confirmed' }
        );
        
        console.log('\n✅ Swap successful!');
        console.log('📝 Transaction:', signature);
        
        // Check new balances
        const newContBalance = await getAccount(connection, userContAccount);
        const newFifoBalance = await getAccount(connection, userFifoAccount);
        
        console.log('\n💰 New Balances:');
        console.log('CONT:', Number(newContBalance.amount) / 10**9);
        console.log('FIFO:', Number(newFifoBalance.amount) / 10**9);
        
        // Check new sequence
        const newFifoAccount = await connection.getAccountInfo(fifoState);
        if (newFifoAccount) {
            const newSeq = newFifoAccount.data.readBigUInt64LE(8);
            console.log('\n📊 New sequence:', newSeq.toString());
        }
        
    } catch (error: any) {
        console.error('\n❌ Swap failed:', error);
        if (error.logs) {
            console.error('📋 Transaction logs:');
            error.logs.forEach((log: string) => console.error(log));
        }
    }
}

testSwap().catch(console.error);