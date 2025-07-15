#!/usr/bin/env ts-node
import { 
    Connection, 
    Keypair, 
    PublicKey, 
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    ComputeBudgetProgram,
    AccountMeta
} from '@solana/web3.js';
import { 
    getAccount,
    createApproveInstruction,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');
const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');

async function testContinuumSwap() {
    console.log(chalk.green('🚀 Testing Continuum Swap with New Pool...\n'));
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log(chalk.cyan('💳 Wallet:'), wallet.publicKey.toBase58());
    
    // Load configurations
    const deploymentPath = path.join(__dirname, '../deployment-devnet.json');
    const poolConfigPath = path.join(__dirname, '../continuum-pool-complete.json');
    
    if (!fs.existsSync(poolConfigPath)) {
        console.error(chalk.red('❌ Pool configuration not found. Run create-continuum-pool-complete.ts first'));
        return;
    }
    
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const poolConfig = JSON.parse(fs.readFileSync(poolConfigPath, 'utf8'));
    
    const fifoState = new PublicKey(deployment.fifoState);
    const poolId = new PublicKey(poolConfig.poolId);
    
    console.log(chalk.blue('📊 Pool Information:'));
    console.log(chalk.gray('Pool ID:'), poolId.toBase58());
    console.log(chalk.gray('Base (CFAIR):'), poolConfig.baseMint);
    console.log(chalk.gray('Quote (CFIFO):'), poolConfig.quoteMint);
    
    // Get user token accounts
    const baseMint = new PublicKey(poolConfig.baseMint);
    const quoteMint = new PublicKey(poolConfig.quoteMint);
    
    const userBaseAccount = new PublicKey(poolConfig.userBaseAccount);
    const userQuoteAccount = new PublicKey(poolConfig.userQuoteAccount);
    
    // Check balances
    console.log(chalk.blue('\n💰 Checking balances...'));
    const baseBalance = await getAccount(connection, userBaseAccount);
    const quoteBalance = await getAccount(connection, userQuoteAccount);
    
    console.log(chalk.gray('CFAIR Balance:'), Number(baseBalance.amount) / 1e9);
    console.log(chalk.gray('CFIFO Balance:'), Number(quoteBalance.amount) / 1e9);
    
    // Swap parameters - swap 10 CFAIR for CFIFO
    const amountIn = new BN(10).mul(new BN(10).pow(new BN(9))); // 10 CFAIR
    const minAmountOut = new BN(9).mul(new BN(10).pow(new BN(9))); // At least 9 CFIFO (allowing ~10% slippage)
    
    console.log(chalk.blue('\n💱 Swap Parameters:'));
    console.log(chalk.gray('Swapping:'), amountIn.div(new BN(1e9)).toString(), 'CFAIR → CFIFO');
    console.log(chalk.gray('Min output:'), minAmountOut.div(new BN(1e9)).toString(), 'CFIFO');
    
    // Get pool authority PDAs
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
        console.error(chalk.red('❌ FIFO state not found!'));
        return;
    }
    
    const currentSeq = fifoAccount.data.readBigUInt64LE(8);
    const nextSeq = currentSeq + BigInt(1);
    console.log(chalk.blue('\n📊 FIFO Sequence:'));
    console.log(chalk.gray('Current:'), currentSeq.toString());
    console.log(chalk.gray('Next:'), nextSeq.toString());
    
    // Get delegate authority
    const [delegateAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegate"), userBaseAccount.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    try {
        // Build transaction
        const swapTx = new Transaction();
        
        // Add compute budget
        swapTx.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 })
        );
        
        // Add approve instruction for delegate
        swapTx.add(
            createApproveInstruction(
                userBaseAccount,
                delegateAuthority,
                wallet.publicKey,
                BigInt(amountIn.toString())
            )
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
        
        // Build complete account list
        const accounts: AccountMeta[] = [
            // Wrapper-specific accounts
            { pubkey: fifoState, isSigner: false, isWritable: true },
            { pubkey: poolAuthorityState, isSigner: false, isWritable: false },
            { pubkey: poolAuthority, isSigner: false, isWritable: false },
            { pubkey: delegateAuthority, isSigner: false, isWritable: false },
            { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
            { pubkey: userBaseAccount, isSigner: false, isWritable: true }, // Source (CFAIR)
            { pubkey: userQuoteAccount, isSigner: false, isWritable: true }, // Destination (CFIFO)
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
            { pubkey: userBaseAccount, isSigner: false, isWritable: true },
            { pubkey: userQuoteAccount, isSigner: false, isWritable: true },
            { pubkey: poolAuthority, isSigner: false, isWritable: false },
        ];
        
        const wrapperIx = new TransactionInstruction({
            programId: WRAPPER_PROGRAM_ID,
            keys: accounts,
            data: wrapperIxData,
        });
        
        swapTx.add(wrapperIx);
        
        console.log(chalk.blue('\n📝 Transaction Details:'));
        console.log(chalk.gray('Total accounts:'), accounts.length);
        console.log(chalk.gray('Compute units:'), '600,000');
        
        console.log(chalk.yellow('\n📤 Sending transaction...'));
        const signature = await sendAndConfirmTransaction(
            connection,
            swapTx,
            [wallet],
            { commitment: 'confirmed' }
        );
        
        console.log(chalk.green('\n✅ Swap successful!'));
        console.log(chalk.cyan('📝 Signature:'), signature);
        console.log(chalk.cyan('🔍 View on Solscan:'), `https://solscan.io/tx/${signature}?cluster=devnet`);
        
        // Check new balances
        console.log(chalk.blue('\n💰 New balances:'));
        const newBaseBalance = await getAccount(connection, userBaseAccount);
        const newQuoteBalance = await getAccount(connection, userQuoteAccount);
        
        const baseChange = Number(newBaseBalance.amount) - Number(baseBalance.amount);
        const quoteChange = Number(newQuoteBalance.amount) - Number(quoteBalance.amount);
        
        console.log(chalk.gray('CFAIR:'), Number(newBaseBalance.amount) / 1e9, `(${baseChange / 1e9})`);
        console.log(chalk.gray('CFIFO:'), Number(newQuoteBalance.amount) / 1e9, `(+${quoteChange / 1e9})`);
        
        // Check new sequence
        const newFifoAccount = await connection.getAccountInfo(fifoState);
        const newSeq = newFifoAccount!.data.readBigUInt64LE(8);
        console.log(chalk.blue('\n📊 FIFO sequence updated:'), newSeq.toString());
        
    } catch (error: any) {
        console.error(chalk.red('\n❌ Transaction failed:'), error.message);
        if (error.logs) {
            console.error(chalk.red('\n📋 Transaction logs:'));
            error.logs.forEach((log: string) => console.error(chalk.gray(log)));
        }
        
        if (error.message.includes('custom program error: 0x30')) {
            console.log(chalk.yellow('\n⚠️  This error (0x30 = 48) typically means:'));
            console.log(chalk.yellow('- The pool authority has not been transferred to Continuum'));
            console.log(chalk.yellow('- The wrapper cannot sign for pool operations'));
            console.log(chalk.yellow('- This is expected with newly created pools'));
        }
    }
}

async function main() {
    await testContinuumSwap();
    
    console.log(chalk.blue('\n📝 Additional Notes:'));
    console.log(chalk.white('- If the swap fails with authority errors, the pool needs'));
    console.log(chalk.white('  its authority transferred to the Continuum wrapper'));
    console.log(chalk.white('- The FIFO ordering is still enforced regardless'));
    console.log(chalk.white('- Monitor the queue with: npx ts-node scripts/examples/monitor-fifo.ts'));
}

if (require.main === module) {
    main().catch(console.error);
}