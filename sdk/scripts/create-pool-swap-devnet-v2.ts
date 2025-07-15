import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Raydium, TxVersion, AMM_V4, OPEN_BOOK_PROGRAM, FEE_DESTINATION_ID } from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import * as fs from 'fs';

const DEVNET_URL = 'https://api.devnet.solana.com';
// Default AMM Config ID for devnet - this is a standard config for most pools
const AMM_CONFIG_ID = new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2');

async function main() {
    console.log('🚀 Starting Raydium pool creation and swap on devnet...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Create or load test wallet
    let testWallet: Keypair;
    const walletPath = 'raydium-test-wallet-v2.json';
    
    if (fs.existsSync(walletPath)) {
        console.log('📂 Loading existing test wallet...');
        const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        testWallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    } else {
        console.log('🔑 Creating new test wallet...');
        testWallet = Keypair.generate();
        fs.writeFileSync(walletPath, JSON.stringify(Array.from(testWallet.secretKey)));
    }
    
    console.log('💳 Test wallet pubkey:', testWallet.publicKey.toBase58());
    
    // Check balance and request airdrop if needed
    let balance = await connection.getBalance(testWallet.publicKey);
    console.log('💰 Current balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    if (balance < 2 * LAMPORTS_PER_SOL) {
        console.log('💸 Requesting airdrop...');
        try {
            const airdropSig = await connection.requestAirdrop(testWallet.publicKey, 2 * LAMPORTS_PER_SOL);
            await connection.confirmTransaction(airdropSig);
            balance = await connection.getBalance(testWallet.publicKey);
            console.log('💰 New balance:', balance / LAMPORTS_PER_SOL, 'SOL');
        } catch (error) {
            console.error('❌ Airdrop failed:', error);
            console.log('Please fund your wallet manually at https://faucet.solana.com/');
            return;
        }
    }
    
    // Create test tokens
    console.log('\n🪙 Creating test tokens...');
    
    // Create Token A
    console.log('Creating Token A (TESTA)...');
    const tokenAMint = await createMint(
        connection,
        testWallet,
        testWallet.publicKey,
        testWallet.publicKey,
        9 // decimals
    );
    console.log('✅ TESTA mint:', tokenAMint.toBase58());
    
    // Create Token B
    console.log('Creating Token B (TESTB)...');
    const tokenBMint = await createMint(
        connection,
        testWallet,
        testWallet.publicKey,
        testWallet.publicKey,
        9 // decimals
    );
    console.log('✅ TESTB mint:', tokenBMint.toBase58());
    
    // Create token accounts and mint tokens
    console.log('\n💳 Creating token accounts...');
    const tokenAAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        testWallet,
        tokenAMint,
        testWallet.publicKey
    );
    
    const tokenBAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        testWallet,
        tokenBMint,
        testWallet.publicKey
    );
    
    // Mint 1M tokens of each
    console.log('\n🏭 Minting tokens...');
    await mintTo(
        connection,
        testWallet,
        tokenAMint,
        tokenAAccount.address,
        testWallet,
        1000000 * 10 ** 9
    );
    
    await mintTo(
        connection,
        testWallet,
        tokenBMint,
        tokenBAccount.address,
        testWallet,
        1000000 * 10 ** 9
    );
    
    console.log('✅ Minted 1M TESTA and 1M TESTB');
    
    // Save token info
    const tokenInfo = {
        tokenA: {
            mint: tokenAMint.toBase58(),
            decimals: 9,
            account: tokenAAccount.address.toBase58(),
            name: "Test Token A",
            symbol: "TESTA"
        },
        tokenB: {
            mint: tokenBMint.toBase58(),
            decimals: 9,
            account: tokenBAccount.address.toBase58(),
            name: "Test Token B",
            symbol: "TESTB"
        },
        wallet: testWallet.publicKey.toBase58(),
        createdAt: new Date().toISOString()
    };
    
    fs.writeFileSync('raydium-test-tokens-v2.json', JSON.stringify(tokenInfo, null, 2));
    console.log('💾 Token info saved to raydium-test-tokens-v2.json');
    
    // Initialize Raydium SDK V2
    console.log('\n🔧 Initializing Raydium SDK V2...');
    const raydium = await Raydium.load({
        connection,
        owner: testWallet,
        cluster: 'devnet',
        disableLoadToken: false,
        blockhashCommitment: 'confirmed',
    });
    
    console.log('✅ Raydium SDK initialized');
    
    try {
        // Create market and pool
        console.log('\n🏊 Creating market and pool...');
        
        const baseAmount = new BN(100000).mul(new BN(10).pow(new BN(9))); // 100k TESTA
        const quoteAmount = new BN(100000).mul(new BN(10).pow(new BN(9))); // 100k TESTB
        
        console.log('Base amount (TESTA):', baseAmount.toString() + ' (100,000 tokens)');
        console.log('Quote amount (TESTB):', quoteAmount.toString() + ' (100,000 tokens)');
        console.log('Initial price: 1 TESTA = 1 TESTB');
        
        const { execute, extInfo } = await raydium.liquidity.createMarketAndPoolV4({
            programId: AMM_V4,
            marketProgram: OPEN_BOOK_PROGRAM,
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
                feePayer: testWallet.publicKey,
                useSOLBalance: true,
            },
            associatedOnly: false,
            checkCreateATAOwner: true,
            txVersion: TxVersion.V0,
            lookupTableCache: {},
            lotSize: 1,
            tickSize: 0.01,
            dexCreateFee: 0.1,
            feeDestinationId: FEE_DESTINATION_ID,
            ammConfigId: AMM_CONFIG_ID,
        });
        
        console.log('\n📤 Executing pool creation transaction...');
        const { txIds } = await execute({ sequentially: true, sendAndConfirm: true });
        
        console.log('\n🎉 Pool created successfully!');
        console.log('📝 Transaction IDs:', txIds);
        console.log('🏊 Pool ID:', extInfo.ammId.toBase58());
        console.log('💎 LP Mint:', extInfo.lpMint.toBase58());
        console.log('📊 Market ID:', extInfo.marketId.toBase58());
        
        // Save pool info
        const poolInfo = {
            poolId: extInfo.ammId.toBase58(),
            lpMint: extInfo.lpMint.toBase58(),
            marketId: extInfo.marketId.toBase58(),
            baseVault: extInfo.baseVault.toBase58(),
            quoteVault: extInfo.quoteVault.toBase58(),
            baseMint: tokenAMint.toBase58(),
            quoteMint: tokenBMint.toBase58(),
            baseDecimals: 9,
            quoteDecimals: 9,
            programId: AMM_V4.toBase58(),
            marketProgramId: OPEN_BOOK_PROGRAM.toBase58(),
            createdAt: new Date().toISOString(),
            txIds: txIds,
        };
        
        fs.writeFileSync('raydium-test-pool-v2.json', JSON.stringify(poolInfo, null, 2));
        console.log('💾 Pool info saved to raydium-test-pool-v2.json');
        
        // Wait a bit for pool to settle
        console.log('\n⏳ Waiting for pool to settle...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Perform a swap
        console.log('\n💱 Performing test swap...');
        console.log('Swapping 1000 TESTA for TESTB');
        
        const swapAmount = new BN(1000).mul(new BN(10).pow(new BN(9))); // 1000 TESTA
        
        // Fetch the pool info to get current state
        const poolKeys = await raydium.liquidity.getPoolInfoFromRpc({ poolId: extInfo.ammId });
        
        if (!poolKeys) {
            throw new Error('Failed to fetch pool info');
        }
        
        const { execute: swapExecute, extInfo: swapExtInfo } = await raydium.liquidity.swap({
            poolInfo: poolKeys,
            amountIn: swapAmount,
            amountOut: new BN(0), // Calculate automatically
            fixedSide: 'in',
            inputMint: tokenAMint.toBase58(),
            txVersion: TxVersion.V0,
        });
        
        console.log('\n📤 Executing swap transaction...');
        const { txIds: swapTxIds } = await swapExecute({ sequentially: true, sendAndConfirm: true });
        
        console.log('\n🎉 Swap completed successfully!');
        console.log('📝 Swap transaction IDs:', swapTxIds);
        console.log('📊 Swap details:');
        console.log('  - Amount in:', (Number(swapExtInfo.amountIn.toString()) / 10**9).toFixed(4), 'TESTA');
        console.log('  - Amount out:', (Number(swapExtInfo.amountOut.toString()) / 10**9).toFixed(4), 'TESTB');
        console.log('  - Price impact:', swapExtInfo.priceImpact.toString() + '%');
        
        // Save swap info
        const swapInfo = {
            swapTxIds,
            poolId: poolInfo.poolId,
            amountIn: swapExtInfo.amountIn.toString(),
            amountOut: swapExtInfo.amountOut.toString(),
            priceImpact: swapExtInfo.priceImpact.toString(),
            inputToken: 'TESTA',
            outputToken: 'TESTB',
            executedAt: new Date().toISOString()
        };
        
        fs.writeFileSync('raydium-test-swap-v2.json', JSON.stringify(swapInfo, null, 2));
        console.log('💾 Swap info saved to raydium-test-swap-v2.json');
        
        console.log('\n✅ All operations completed successfully!');
        console.log('\n📚 Summary:');
        console.log('  1. Created two new SPL tokens (TESTA and TESTB)');
        console.log('  2. Created a Raydium pool with 100k:100k liquidity');
        console.log('  3. Performed a swap of 1000 TESTA for TESTB');
        console.log('\n🔍 You can view transactions on Solana Explorer:');
        console.log('  - Pool creation: https://explorer.solana.com/tx/' + txIds[0] + '?cluster=devnet');
        console.log('  - Swap: https://explorer.solana.com/tx/' + swapTxIds[0] + '?cluster=devnet');
        
    } catch (error: any) {
        console.error('\n❌ Error:', error);
        if (error.logs) {
            console.error('📋 Transaction logs:', error.logs);
        }
    }
}

main().catch(console.error);