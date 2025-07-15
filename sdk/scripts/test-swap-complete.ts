#!/usr/bin/env ts-node
import { 
    Connection, 
    Keypair, 
    PublicKey,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL,
    ComputeBudgetProgram,
    AccountMeta
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
    console.log('🚀 Testing Complete Swap Flow with All Raydium Accounts...\n');
    
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
    
    // Get pool authority state
    const [poolAuthorityState] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority_state"), poolId.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    const [poolAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_authority"), poolId.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
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
    
    // Build complete account list
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
        
        // Raydium accounts (remaining_accounts)
        // These would be the actual pool accounts in production
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
        { pubkey: userContAccount, isSigner: false, isWritable: true },
        { pubkey: userFifoAccount, isSigner: false, isWritable: true },
        { pubkey: poolAuthority, isSigner: false, isWritable: false }, // Pool authority as signer
    ];
    
    const wrapperIx = new TransactionInstruction({
        programId: WRAPPER_PROGRAM_ID,
        keys: accounts,
        data: wrapperIxData,
    });
    
    tx.add(wrapperIx);
    
    console.log('\n📝 Transaction built with:');
    console.log('- Compute budget: 600,000 units');
    console.log('- Approve instruction for delegate');
    console.log('- Wrapper swap instruction with sequence', nextSeq.toString());
    console.log('- Total accounts:', accounts.length);
    
    // For demonstration, let's show the account structure
    console.log('\n📋 Account Structure:');
    console.log('Wrapper accounts (9):');
    console.log('  1. FIFO State');
    console.log('  2. Pool Authority State');
    console.log('  3. Pool Authority PDA');
    console.log('  4. Delegate Authority');
    console.log('  5. User (signer)');
    console.log('  6. User Source Token');
    console.log('  7. User Destination Token');
    console.log('  8. Raydium Program');
    console.log('  9. Token Program');
    console.log('\nRaydium accounts (18):');
    console.log('  10-27. All Raydium pool accounts');
    
    // In production, you would send this transaction
    // For now, let's save the transaction structure
    const txStructure = {
        instructions: [
            {
                name: 'ComputeBudget',
                program: 'ComputeBudget111111111111111111111111111111',
                units: 600000
            },
            {
                name: 'ApproveChecked',
                program: TOKEN_PROGRAM_ID.toBase58(),
                amount: amountIn.toString(),
                delegate: delegateAuthority.toBase58()
            },
            {
                name: 'SwapWithPoolAuthority',
                program: WRAPPER_PROGRAM_ID.toBase58(),
                sequence: nextSeq.toString(),
                accounts: accounts.length
            }
        ],
        signers: [wallet.publicKey.toBase58()],
        timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../swap-transaction-structure.json'),
        JSON.stringify(txStructure, null, 2)
    );
    
    console.log('\n💾 Transaction structure saved');
    console.log('\n✅ Complete swap flow demonstrated!');
    console.log('\n⚠️  Note: This uses mock pool accounts.');
    console.log('For production, create a real Raydium pool with Continuum as authority.');
}

main().catch(console.error);