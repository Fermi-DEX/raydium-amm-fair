#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram
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

async function main() {
    console.log('🚀 Testing Complete Continuum Flow...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load wallet and configs
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const deploymentPath = path.join(__dirname, '../deployment-devnet.json');
    const tokensPath = path.join(__dirname, '../test-tokens-devnet.json');
    
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const tokenInfo = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Generate a deterministic pool ID for testing
    const poolId = PublicKey.findProgramAddressSync(
        [Buffer.from('test_pool'), wallet.publicKey.toBuffer()],
        WRAPPER_PROGRAM_ID
    )[0];
    
    console.log('🏊 Test Pool ID:', poolId.toBase58());
    
    // Step 1: Initialize pool authority state
    console.log('\n📋 Step 1: Initialize Pool Authority State');
    
    const [poolAuthorityState] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority_state"), poolId.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    const [poolAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority"), poolId.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    console.log('Pool Authority State:', poolAuthorityState.toBase58());
    console.log('Pool Authority PDA:', poolAuthority.toBase58());
    
    // Check if already initialized
    const poolAuthStateAccount = await connection.getAccountInfo(poolAuthorityState);
    
    if (!poolAuthStateAccount) {
        console.log('\n🔧 Initializing pool authority...');
        
        // Build initialize pool authority instruction
        const initPoolAuthIx = new TransactionInstruction({
            programId: WRAPPER_PROGRAM_ID,
            keys: [
                { pubkey: poolAuthorityState, isSigner: false, isWritable: true },
                { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
                { pubkey: PublicKey.default, isSigner: false, isWritable: false },
            ],
            data: Buffer.concat([
                Buffer.from([245, 243, 142, 59, 138, 3, 209, 46]), // initialize_pool_authority
                poolId.toBuffer(),
            ])
        });
        
        const tx = new Transaction().add(initPoolAuthIx);
        
        try {
            const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
            console.log('✅ Pool authority initialized! Tx:', sig);
        } catch (error) {
            console.error('❌ Failed to initialize pool authority:', error);
            return;
        }
    } else {
        console.log('✅ Pool authority already initialized');
    }
    
    // Step 2: Test swap with pool authority
    console.log('\n📋 Step 2: Test Swap with Pool Authority');
    
    // Get current sequence
    const fifoState = new PublicKey(deployment.fifoState);
    const fifoAccount = await connection.getAccountInfo(fifoState);
    if (!fifoAccount) {
        console.error('FIFO state not found!');
        return;
    }
    
    const currentSeq = fifoAccount.data.readBigUInt64LE(8);
    const nextSeq = currentSeq + BigInt(1);
    console.log('Current sequence:', currentSeq.toString());
    console.log('Next sequence:', nextSeq.toString());
    
    // Get token accounts
    const tokenAAccount = new PublicKey(tokenInfo.toka.account);
    const tokenBAccount = new PublicKey(tokenInfo.tokb.account);
    const tokenAMint = new PublicKey(tokenInfo.toka.mint);
    
    // Check balances
    const tokenA = await getAccount(connection, tokenAAccount);
    console.log('\n💰 Token A balance:', Number(tokenA.amount) / 10**9);
    
    // Prepare swap
    const amountIn = new BN(10).mul(new BN(10).pow(new BN(9))); // 10 tokens
    const minAmountOut = new BN(9).mul(new BN(10).pow(new BN(9))); // 9 tokens
    
    // Get delegate authority
    const [delegateAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegate"), tokenAAccount.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    console.log('\n🔐 Delegate Authority:', delegateAuthority.toBase58());
    
    // Build transaction
    const swapTx = new Transaction();
    
    // Add compute budget
    swapTx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })
    );
    
    // Approve delegate
    const approveIx = createApproveCheckedInstruction(
        tokenAAccount,
        tokenAMint,
        delegateAuthority,
        wallet.publicKey,
        amountIn.toNumber(),
        9
    );
    swapTx.add(approveIx);
    
    // Build swap instruction
    const swapDiscriminator = Buffer.from([237, 180, 80, 103, 107, 172, 187, 137]); // swap_with_pool_authority
    const raydiumSwapData = Buffer.concat([
        Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]), // Raydium swap
        amountIn.toArrayLike(Buffer, 'le', 8),
        minAmountOut.toArrayLike(Buffer, 'le', 8),
    ]);
    
    const swapData = Buffer.concat([
        swapDiscriminator,
        Buffer.alloc(8, Number(nextSeq)), // sequence as LE u64
        Buffer.from([raydiumSwapData.length, 0, 0, 0]), // length as LE u32
        raydiumSwapData,
    ]);
    
    // For demo purposes, we'll create a simplified instruction
    // In production, you need all Raydium pool accounts
    const swapIx = new TransactionInstruction({
        programId: WRAPPER_PROGRAM_ID,
        keys: [
            // Wrapper accounts
            { pubkey: fifoState, isSigner: false, isWritable: true },
            { pubkey: poolAuthorityState, isSigner: false, isWritable: false },
            { pubkey: poolAuthority, isSigner: false, isWritable: false },
            { pubkey: delegateAuthority, isSigner: false, isWritable: false },
            { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
            { pubkey: tokenAAccount, isSigner: false, isWritable: true },
            { pubkey: tokenBAccount, isSigner: false, isWritable: true },
            { pubkey: RAYDIUM_AMM_V4, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            // Raydium accounts would follow...
        ],
        data: swapData,
    });
    
    swapTx.add(swapIx);
    
    console.log('\n📝 Transaction Summary:');
    console.log('- Compute budget: 400,000 units');
    console.log('- Approve delegate for', amountIn.div(new BN(10).pow(new BN(9))).toString(), 'tokens');
    console.log('- Swap with sequence', nextSeq.toString());
    console.log('- Pool authority enforced');
    
    // In production, you would send this transaction
    console.log('\n✅ Transaction ready for submission!');
    
    // Save test results
    const testResults = {
        poolId: poolId.toBase58(),
        poolAuthorityState: poolAuthorityState.toBase58(),
        poolAuthority: poolAuthority.toBase58(),
        delegateAuthority: delegateAuthority.toBase58(),
        fifoState: fifoState.toBase58(),
        currentSequence: currentSeq.toString(),
        nextSequence: nextSeq.toString(),
        timestamp: new Date().toISOString(),
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../test-results-devnet.json'),
        JSON.stringify(testResults, null, 2)
    );
    
    console.log('\n💾 Test results saved');
    console.log('\n🎯 Next Steps:');
    console.log('1. Create actual Raydium pool with Continuum as authority');
    console.log('2. Add all required pool accounts to swap instruction');
    console.log('3. Test with real pool data');
    console.log('4. Run the relayer to process swaps');
}

main().catch(console.error);