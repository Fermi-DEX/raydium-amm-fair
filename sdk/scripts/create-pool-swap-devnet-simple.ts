import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Raydium, TxVersion, AMM_V4, OPEN_BOOK_PROGRAM, FEE_DESTINATION_ID, AMM_CONFIG_ID } from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const RAYDIUM_AMM_DEVNET = 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8';

async function main() {
    console.log('Starting Raydium devnet testing...');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Create or load test wallet
    let testWallet: Keypair;
    const walletPath = 'test-wallet-devnet.json';
    
    if (fs.existsSync(walletPath)) {
        console.log('Loading existing test wallet...');
        const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        testWallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    } else {
        console.log('Creating new test wallet...');
        testWallet = Keypair.generate();
        fs.writeFileSync(walletPath, JSON.stringify(Array.from(testWallet.secretKey)));
    }
    
    console.log('Test wallet pubkey:', testWallet.publicKey.toBase58());
    
    // Check balance and request airdrop if needed
    let balance = await connection.getBalance(testWallet.publicKey);
    console.log('Current balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    if (balance < 2 * LAMPORTS_PER_SOL) {
        console.log('Requesting airdrop...');
        const airdropSig = await connection.requestAirdrop(testWallet.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(airdropSig);
        balance = await connection.getBalance(testWallet.publicKey);
        console.log('New balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    }
    
    // Create test tokens
    console.log('\nCreating test tokens...');
    
    // Create TOKA token
    console.log('Creating TOKA token...');
    const tokaMint = await createMint(
        connection,
        testWallet,
        testWallet.publicKey,
        testWallet.publicKey,
        9 // decimals
    );
    console.log('TOKA mint:', tokaMint.toBase58());
    
    // Create TOKB token
    console.log('Creating TOKB token...');
    const tokbMint = await createMint(
        connection,
        testWallet,
        testWallet.publicKey,
        testWallet.publicKey,
        9 // decimals
    );
    console.log('TOKB mint:', tokbMint.toBase58());
    
    // Create token accounts and mint tokens
    const tokaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        testWallet,
        tokaMint,
        testWallet.publicKey
    );
    
    const tokbAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        testWallet,
        tokbMint,
        testWallet.publicKey
    );
    
    // Mint 1M tokens of each
    await mintTo(
        connection,
        testWallet,
        tokaMint,
        tokaAccount.address,
        testWallet,
        1000000 * 10 ** 9
    );
    
    await mintTo(
        connection,
        testWallet,
        tokbMint,
        tokbAccount.address,
        testWallet,
        1000000 * 10 ** 9
    );
    
    console.log('Minted 1M TOKA and 1M TOKB');
    
    // Save token info
    const tokenInfo = {
        toka: {
            mint: tokaMint.toBase58(),
            decimals: 9,
            account: tokaAccount.address.toBase58(),
        },
        tokb: {
            mint: tokbMint.toBase58(),
            decimals: 9,
            account: tokbAccount.address.toBase58(),
        },
        wallet: testWallet.publicKey.toBase58(),
    };
    
    fs.writeFileSync('test-tokens-devnet.json', JSON.stringify(tokenInfo, null, 2));
    console.log('Token info saved to test-tokens-devnet.json');
    
    // Initialize Raydium SDK V2
    console.log('\nInitializing Raydium SDK V2...');
    const raydium = await Raydium.load({
        connection,
        owner: testWallet,
        cluster: 'devnet',
        disableLoadToken: false,
        blockhashCommitment: 'confirmed',
    });
    
    console.log('Raydium SDK initialized');
    
    try {
        // Create market and pool
        console.log('\nCreating market and pool...');
        
        const baseAmount = new BN(100000).mul(new BN(10).pow(new BN(9))); // 100k TOKA
        const quoteAmount = new BN(100000).mul(new BN(10).pow(new BN(9))); // 100k TOKB
        
        console.log('Base amount (TOKA):', baseAmount.toString());
        console.log('Quote amount (TOKB):', quoteAmount.toString());
        
        const { execute, extInfo } = await raydium.liquidity.createMarketAndPoolV4({
            programId: new PublicKey(RAYDIUM_AMM_DEVNET),
            marketProgram: OPEN_BOOK_PROGRAM,
            baseMintInfo: {
                mint: tokaMint,
                decimals: 9,
            },
            quoteMintInfo: {
                mint: tokbMint,
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
            makeTxVersion: TxVersion.V0,
            lookupTableCache: {},
            lotSize: 1,
            tickSize: 0.01,
            dexCreateFee: 0.1,
            feeDestinationId: FEE_DESTINATION_ID,
            programId: AMM_V4,
            ammConfigId: AMM_CONFIG_ID,
        });
        
        console.log('\nExecuting transaction...');
        const { txId } = await execute({ sendAndConfirm: true });
        
        console.log('\nPool created successfully!');
        console.log('Transaction ID:', txId);
        console.log('Pool ID:', extInfo.address.ammId.toBase58());
        console.log('LP Mint:', extInfo.address.lpMint.toBase58());
        console.log('Market ID:', extInfo.address.marketId.toBase58());
        
        // Save pool info
        const poolInfo = {
            poolId: extInfo.address.ammId.toBase58(),
            lpMint: extInfo.address.lpMint.toBase58(),
            marketId: extInfo.address.marketId.toBase58(),
            baseVault: extInfo.address.baseVault.toBase58(),
            quoteVault: extInfo.address.quoteVault.toBase58(),
            baseMint: tokaMint.toBase58(),
            quoteMint: tokbMint.toBase58(),
            baseDecimals: 9,
            quoteDecimals: 9,
            programId: RAYDIUM_AMM_DEVNET,
            marketProgramId: OPEN_BOOK_PROGRAM.toBase58(),
            createdAt: new Date().toISOString(),
            txId: txId,
        };
        
        fs.writeFileSync('test-pool-devnet.json', JSON.stringify(poolInfo, null, 2));
        console.log('\nPool info saved to test-pool-devnet.json');
        
        // Perform a swap
        console.log('\n\nPerforming test swap...');
        console.log('Swapping 1000 TOKA for TOKB');
        
        const swapAmount = new BN(1000).mul(new BN(10).pow(new BN(9))); // 1000 TOKA
        
        const { execute: swapExecute, extInfo: swapExtInfo } = await raydium.liquidity.swap({
            poolInfo: {
                poolId: extInfo.address.ammId,
                poolAuthority: extInfo.address.poolAuthority,
                baseVault: extInfo.address.baseVault,
                quoteVault: extInfo.address.quoteVault,
                baseToken: {
                    mint: tokaMint,
                    decimals: 9,
                },
                quoteToken: {
                    mint: tokbMint,
                    decimals: 9,
                },
                lpMint: extInfo.address.lpMint,
                openOrders: extInfo.address.openOrders,
                marketId: extInfo.address.marketId,
                marketProgramId: OPEN_BOOK_PROGRAM,
                ammConfigId: AMM_CONFIG_ID,
                feeDestinationId: FEE_DESTINATION_ID,
            },
            amountIn: swapAmount,
            amountOut: new BN(0), // Calculate automatically
            fixedSide: 'in',
            inputMint: tokaMint,
            txVersion: TxVersion.V0,
        });
        
        console.log('\nExecuting swap transaction...');
        const { txId: swapTxId } = await swapExecute({ sendAndConfirm: true });
        
        console.log('\nSwap completed successfully!');
        console.log('Swap transaction ID:', swapTxId);
        console.log('Amount in:', swapExtInfo.amountIn.toString());
        console.log('Amount out:', swapExtInfo.amountOut.toString());
        console.log('Price impact:', swapExtInfo.priceImpact.toString(), '%');
        
    } catch (error) {
        console.error('\nError:', error);
        if (error.logs) {
            console.error('Transaction logs:', error.logs);
        }
    }
}

main().catch(console.error);