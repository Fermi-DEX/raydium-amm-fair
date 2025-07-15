#!/usr/bin/env ts-node
import { 
    Connection, 
    Keypair, 
    LAMPORTS_PER_SOL, 
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
    SystemProgram,
    TransactionInstruction,
    ComputeBudgetProgram
} from '@solana/web3.js';
import { 
    createMint,
    mintTo,
    getAccount,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    getMint
} from '@solana/spl-token';
import { 
    Raydium, 
    TxVersion,
    FEE_DESTINATION_ID,
    DEVNET_PROGRAM_ID,
    MARKET_STATE_LAYOUT_V3
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');

async function createContinuumPool() {
    console.log(chalk.green('🚀 Creating Complete Raydium Pool for Continuum Testing\n'));
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    if (!fs.existsSync(walletPath)) {
        console.error(chalk.red('❌ Wallet not found. Please create test-wallet-devnet.json'));
        process.exit(1);
    }
    
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log(chalk.cyan('💳 Wallet:'), wallet.publicKey.toBase58());
    
    // Check balance
    let balance = await connection.getBalance(wallet.publicKey);
    console.log(chalk.yellow('💰 Balance:'), balance / LAMPORTS_PER_SOL, 'SOL');
    
    if (balance < 2 * LAMPORTS_PER_SOL) {
        console.log(chalk.yellow('💸 Requesting airdrop...'));
        try {
            const sig = await connection.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
            await connection.confirmTransaction(sig);
            balance = await connection.getBalance(wallet.publicKey);
            console.log(chalk.green('💰 New balance:'), balance / LAMPORTS_PER_SOL, 'SOL');
        } catch (e) {
            console.log(chalk.yellow('⚠️  Airdrop failed, continuing anyway...'));
        }
    }
    
    try {
        // Step 1: Create new tokens
        console.log(chalk.blue('\n📝 Step 1: Creating new tokens for the pool...'));
        
        // Create CFAIR token (Continuum Fair)
        console.log(chalk.gray('Creating CFAIR token...'));
        const cfairMint = await createMint(
            connection,
            wallet,
            wallet.publicKey,
            wallet.publicKey,
            9 // 9 decimals
        );
        console.log(chalk.green('✅ CFAIR mint:'), cfairMint.toBase58());
        
        // Create CFIFO token (Continuum FIFO)
        console.log(chalk.gray('Creating CFIFO token...'));
        const cfifoMint = await createMint(
            connection,
            wallet,
            wallet.publicKey,
            wallet.publicKey,
            9 // 9 decimals
        );
        console.log(chalk.green('✅ CFIFO mint:'), cfifoMint.toBase58());
        
        // Step 2: Create token accounts and mint initial supply
        console.log(chalk.blue('\n📝 Step 2: Creating token accounts and minting supply...'));
        
        const userCfairAccount = await getAssociatedTokenAddress(cfairMint, wallet.publicKey);
        const userCfifoAccount = await getAssociatedTokenAddress(cfifoMint, wallet.publicKey);
        
        // Create token accounts
        const createAccountsTx = new Transaction();
        createAccountsTx.add(
            createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                userCfairAccount,
                wallet.publicKey,
                cfairMint
            ),
            createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                userCfifoAccount,
                wallet.publicKey,
                cfifoMint
            )
        );
        
        await sendAndConfirmTransaction(connection, createAccountsTx, [wallet]);
        console.log(chalk.green('✅ Token accounts created'));
        
        // Mint tokens
        const mintAmount = new BN(1_000_000).mul(new BN(10).pow(new BN(9))); // 1 million tokens
        
        await mintTo(
            connection,
            wallet,
            cfairMint,
            userCfairAccount,
            wallet.publicKey,
            BigInt(mintAmount.toString())
        );
        console.log(chalk.green('✅ Minted 1,000,000 CFAIR'));
        
        await mintTo(
            connection,
            wallet,
            cfifoMint,
            userCfifoAccount,
            wallet.publicKey,
            BigInt(mintAmount.toString())
        );
        console.log(chalk.green('✅ Minted 1,000,000 CFIFO'));
        
        // Save token info
        const tokensInfo = {
            CFAIR: {
                mint: cfairMint.toBase58(),
                account: userCfairAccount.toBase58(),
                decimals: 9,
                symbol: 'CFAIR'
            },
            CFIFO: {
                mint: cfifoMint.toBase58(),
                account: userCfifoAccount.toBase58(),
                decimals: 9,
                symbol: 'CFIFO'
            }
        };
        
        fs.writeFileSync(
            path.join(__dirname, '../continuum-tokens-new.json'),
            JSON.stringify(tokensInfo, null, 2)
        );
        console.log(chalk.green('✅ Token info saved'));
        
        // Step 3: Initialize Raydium SDK
        console.log(chalk.blue('\n📝 Step 3: Initializing Raydium SDK V2...'));
        const raydium = await Raydium.load({
            connection,
            owner: wallet,
            cluster: 'devnet',
            disableLoadToken: false,
            blockhashCommitment: 'confirmed',
        });
        console.log(chalk.green('✅ Raydium SDK initialized'));
        
        // Step 4: Create market and pool
        console.log(chalk.blue('\n📝 Step 4: Creating market and pool...'));
        
        const baseAmount = new BN(100_000).mul(new BN(10).pow(new BN(9))); // 100k CFAIR
        const quoteAmount = new BN(100_000).mul(new BN(10).pow(new BN(9))); // 100k CFIFO
        
        console.log(chalk.gray('Creating pool with:'));
        console.log(chalk.gray(`  Base (CFAIR): ${baseAmount.div(new BN(10).pow(new BN(9))).toString()}`));
        console.log(chalk.gray(`  Quote (CFIFO): ${quoteAmount.div(new BN(10).pow(new BN(9))).toString()}`));
        
        // Create pool (which will also create market)
        const { execute, extInfo } = await raydium.liquidity.createPoolV4({
            programId: DEVNET_PROGRAM_ID.AMM_V4,
            marketInfo: {
                marketId: PublicKey.default, // Create new market
                programId: DEVNET_PROGRAM_ID.OPEN_BOOK_PROGRAM,
            },
            baseMintInfo: {
                mint: cfairMint,
                decimals: 9,
            },
            quoteMintInfo: {
                mint: cfifoMint,
                decimals: 9,
            },
            baseAmount,
            quoteAmount,
            startTime: new BN(0), // Start immediately
            ownerInfo: {
                useSOLBalance: false,
            },
            associatedOnly: false,
            txVersion: TxVersion.V0,
            feeDestinationId: FEE_DESTINATION_ID,
            computeBudgetConfig: {
                units: 600000,
                microLamports: 100000,
            },
        });
        
        console.log(chalk.yellow('📤 Sending pool creation transaction...'));
        
        // Execute the transaction
        const { txId } = await execute({ sendAndConfirm: true });
        
        console.log(chalk.green('✅ Pool creation transaction sent!'));
        console.log(chalk.cyan('📝 Transaction ID:'), txId);
        console.log(chalk.cyan('🔍 View on Solscan:'), `https://solscan.io/tx/${txId}?cluster=devnet`);
        
        // Extract pool info
        const poolInfo = extInfo.address;
        console.log(chalk.green('\n✅ Pool created successfully!'));
        console.log(chalk.cyan('🏊 Pool ID:'), poolInfo.poolId.toBase58());
        console.log(chalk.cyan('📈 Market ID:'), poolInfo.marketId.toBase58());
        console.log(chalk.cyan('🪙 LP Mint:'), poolInfo.lpMint.toBase58());
        
        // Step 5: Fetch market account details
        console.log(chalk.blue('\n📝 Step 5: Fetching market account details...'));
        
        // Wait a bit for the market to be fully initialized
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const marketAccount = await connection.getAccountInfo(poolInfo.marketId);
        if (!marketAccount) {
            throw new Error('Market account not found');
        }
        
        // Decode market state using the layout from SDK v2
        const marketState = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);
        
        // Calculate vault signer
        const [vaultSigner] = await PublicKey.findProgramAddress(
            [poolInfo.marketId.toBuffer(), Buffer.from([marketState.vaultSignerNonce.toNumber()])],
            DEVNET_PROGRAM_ID.OPEN_BOOK_PROGRAM
        );
        
        console.log(chalk.green('✅ Market details fetched'));
        
        // Step 6: Initialize Continuum pool authority
        console.log(chalk.blue('\n📝 Step 6: Initializing Continuum pool authority...'));
        
        const [poolAuthorityState] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_authority_state"), poolInfo.poolId.toBuffer()],
            WRAPPER_PROGRAM_ID
        );
        
        const [continuumPoolAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_authority"), poolInfo.poolId.toBuffer()],
            WRAPPER_PROGRAM_ID
        );
        
        console.log(chalk.gray('Pool Authority State:'), poolAuthorityState.toBase58());
        console.log(chalk.gray('Continuum Pool Authority:'), continuumPoolAuthority.toBase58());
        
        // Initialize pool authority in Continuum
        const initPoolAuthData = Buffer.concat([
            Buffer.from([245, 243, 142, 59, 138, 3, 209, 46]), // initialize_pool_authority discriminator
            poolInfo.poolId.toBuffer(),
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
        
        const initAuthTx = new Transaction()
            .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }))
            .add(initPoolAuthIx);
            
        const initAuthSig = await sendAndConfirmTransaction(
            connection,
            initAuthTx,
            [wallet],
            { commitment: 'confirmed' }
        );
        console.log(chalk.green('✅ Continuum pool authority initialized:'), initAuthSig);
        
        // Step 7: Save complete pool configuration
        console.log(chalk.blue('\n📝 Step 7: Saving complete pool configuration...'));
        
        const poolConfig = {
            createdAt: new Date().toISOString(),
            poolId: poolInfo.poolId.toBase58(),
            marketId: poolInfo.marketId.toBase58(),
            lpMint: poolInfo.lpMint.toBase58(),
            
            // Token info
            baseMint: cfairMint.toBase58(),
            quoteMint: cfifoMint.toBase58(),
            baseSymbol: 'CFAIR',
            quoteSymbol: 'CFIFO',
            baseDecimals: 9,
            quoteDecimals: 9,
            
            // Initial liquidity
            baseAmount: baseAmount.toString(),
            quoteAmount: quoteAmount.toString(),
            
            // User accounts
            userBaseAccount: userCfairAccount.toBase58(),
            userQuoteAccount: userCfifoAccount.toBase58(),
            
            // Pool accounts
            ammAuthority: poolInfo.ammAuthority.toBase58(),
            baseVault: poolInfo.baseVault.toBase58(),
            quoteVault: poolInfo.quoteVault.toBase58(),
            poolCoinTokenAccount: poolInfo.baseVault.toBase58(),
            poolPcTokenAccount: poolInfo.quoteVault.toBase58(),
            openOrders: poolInfo.ammOpenOrders.toBase58(),
            targetOrders: poolInfo.ammTargetOrders.toBase58(),
            
            // Market accounts from decoded market state
            serumMarket: poolInfo.marketId.toBase58(),
            serumBids: marketState.bids.toBase58(),
            serumAsks: marketState.asks.toBase58(),
            serumEventQueue: marketState.eventQueue.toBase58(),
            serumCoinVaultAccount: marketState.baseVault.toBase58(),
            serumPcVaultAccount: marketState.quoteVault.toBase58(),
            serumVaultSigner: vaultSigner.toBase58(),
            
            // Continuum
            continuumAuthority: continuumPoolAuthority.toBase58(),
            poolAuthorityState: poolAuthorityState.toBase58(),
            
            // Programs
            ammProgramId: DEVNET_PROGRAM_ID.AMM_V4.toBase58(),
            serumProgramId: DEVNET_PROGRAM_ID.OPEN_BOOK_PROGRAM.toBase58(),
            tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
            
            // Transaction info
            createTxId: txId,
            initAuthTxId: initAuthSig,
            
            note: 'Pool created with Continuum authority initialized. Ready for FIFO testing!'
        };
        
        const configPath = path.join(__dirname, '../continuum-pool-complete.json');
        fs.writeFileSync(configPath, JSON.stringify(poolConfig, null, 2));
        console.log(chalk.green('✅ Configuration saved to:'), configPath);
        
        // Update relayer configuration
        await updateRelayerConfig(poolConfig);
        
        // Final summary
        console.log(chalk.green('\n🎉 Pool Creation Complete!\n'));
        console.log(chalk.white('Summary:'));
        console.log(chalk.white('--------'));
        console.log(chalk.cyan('Pool ID:'), poolInfo.poolId.toBase58());
        console.log(chalk.cyan('CFAIR Token:'), cfairMint.toBase58());
        console.log(chalk.cyan('CFIFO Token:'), cfifoMint.toBase58());
        console.log(chalk.cyan('Initial Liquidity:'), '100,000 CFAIR / 100,000 CFIFO');
        console.log(chalk.cyan('Continuum Authority:'), 'Initialized ✅');
        console.log(chalk.cyan('All Market Accounts:'), 'Fetched ✅');
        
        return poolConfig;
        
    } catch (error: any) {
        console.error(chalk.red('\n❌ Error creating pool:'), error);
        if (error.logs) {
            console.error(chalk.red('\n📋 Transaction logs:'));
            error.logs.forEach((log: string) => console.error(chalk.gray(log)));
        }
        throw error;
    }
}

async function updateRelayerConfig(poolConfig: any) {
    console.log(chalk.blue('\n📝 Updating relayer configuration...'));
    
    const relayerAccountsPath = path.join(__dirname, '../../continuum-relayer/src/raydium_accounts.rs');
    
    const relayerAccountsContent = `use solana_sdk::pubkey::Pubkey;
use solana_sdk::instruction::AccountMeta;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RaydiumPoolAccounts {
    pub pool_id: Pubkey,
    pub amm_authority: Pubkey,
    pub amm_open_orders: Pubkey,
    pub amm_target_orders: Pubkey,
    pub pool_coin_token_account: Pubkey,
    pub pool_pc_token_account: Pubkey,
    pub serum_program_id: Pubkey,
    pub serum_market: Pubkey,
    pub serum_bids: Pubkey,
    pub serum_asks: Pubkey,
    pub serum_event_queue: Pubkey,
    pub serum_coin_vault_account: Pubkey,
    pub serum_pc_vault_account: Pubkey,
    pub serum_vault_signer: Pubkey,
}

impl RaydiumPoolAccounts {
    pub fn to_account_metas(&self, user_source: Pubkey, user_destination: Pubkey, pool_authority: Pubkey) -> Vec<AccountMeta> {
        vec![
            // Token program (required first)
            AccountMeta::new_readonly(spl_token::id(), false),
            // Pool accounts
            AccountMeta::new(self.pool_id, false),
            AccountMeta::new_readonly(self.amm_authority, false),
            AccountMeta::new(self.amm_open_orders, false),
            AccountMeta::new(self.amm_target_orders, false),
            AccountMeta::new(self.pool_coin_token_account, false),
            AccountMeta::new(self.pool_pc_token_account, false),
            // Serum/OpenBook accounts
            AccountMeta::new_readonly(self.serum_program_id, false),
            AccountMeta::new(self.serum_market, false),
            AccountMeta::new(self.serum_bids, false),
            AccountMeta::new(self.serum_asks, false),
            AccountMeta::new(self.serum_event_queue, false),
            AccountMeta::new(self.serum_coin_vault_account, false),
            AccountMeta::new(self.serum_pc_vault_account, false),
            AccountMeta::new_readonly(self.serum_vault_signer, false),
            // User accounts
            AccountMeta::new(user_source, false),
            AccountMeta::new(user_destination, false),
            // Pool authority (as signer for Continuum-controlled pools)
            AccountMeta::new_readonly(pool_authority, false),
        ]
    }
}

/// Load pool accounts from configuration
pub fn load_pool_accounts(pool_id: &Pubkey) -> Option<RaydiumPoolAccounts> {
    // New Continuum pool
    let continuum_pool_id = Pubkey::from_str("${poolConfig.poolId}").ok()?;
    
    if pool_id == &continuum_pool_id {
        Some(RaydiumPoolAccounts {
            pool_id: continuum_pool_id,
            amm_authority: Pubkey::from_str("${poolConfig.ammAuthority}").unwrap(),
            amm_open_orders: Pubkey::from_str("${poolConfig.openOrders}").unwrap(),
            amm_target_orders: Pubkey::from_str("${poolConfig.targetOrders}").unwrap(),
            pool_coin_token_account: Pubkey::from_str("${poolConfig.poolCoinTokenAccount}").unwrap(),
            pool_pc_token_account: Pubkey::from_str("${poolConfig.poolPcTokenAccount}").unwrap(),
            serum_program_id: Pubkey::from_str("${poolConfig.serumProgramId}").unwrap(),
            serum_market: Pubkey::from_str("${poolConfig.serumMarket}").unwrap(),
            serum_bids: Pubkey::from_str("${poolConfig.serumBids}").unwrap(),
            serum_asks: Pubkey::from_str("${poolConfig.serumAsks}").unwrap(),
            serum_event_queue: Pubkey::from_str("${poolConfig.serumEventQueue}").unwrap(),
            serum_coin_vault_account: Pubkey::from_str("${poolConfig.serumCoinVaultAccount}").unwrap(),
            serum_pc_vault_account: Pubkey::from_str("${poolConfig.serumPcVaultAccount}").unwrap(),
            serum_vault_signer: Pubkey::from_str("${poolConfig.serumVaultSigner}").unwrap(),
        })
    } else {
        // Keep existing test pool
        let test_pool_id = Pubkey::from_str("FWP3JA31eauPJA6RJftReaus3T75rUZc4xVCgGpz7CQQ").ok()?;
        
        if pool_id == &test_pool_id {
            Some(RaydiumPoolAccounts {
                pool_id: test_pool_id,
                amm_authority: Pubkey::from_str("DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC").unwrap(),
                amm_open_orders: Pubkey::from_str("F1FaUZU9789aQxxZqKLqizUoNyazQxgHKw2bonADEbFs").unwrap(),
                amm_target_orders: Pubkey::from_str("EuFFuq1RpVsBFbvnFS2Bgth9SNsxCN3AG4P1BUawR8yy").unwrap(),
                pool_coin_token_account: Pubkey::from_str("GsACB9Gm6QJyBYCvv1B5TJdpYPJP5PsnF7UKuLDNZLd6").unwrap(),
                pool_pc_token_account: Pubkey::from_str("BnCejGtupYD8kVpWF1E7xmFnHAK2kUmX4qvsJEiuVXjj").unwrap(),
                serum_program_id: Pubkey::from_str("EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj").unwrap(),
                serum_market: Pubkey::from_str("HeAap3XbNZHBaHsv6A9FXmMLKN2zWinsPxVwJVBiRGPQ").unwrap(),
                serum_bids: Pubkey::from_str("4soHYNjT3TXoibaLJQXNFQ1MJMoZRpFCx1pWLKJKC1Dh").unwrap(),
                serum_asks: Pubkey::from_str("2s2SgtShuDtwviHVv2KYMtPs99scGGUXS1SwN83meprv").unwrap(),
                serum_event_queue: Pubkey::from_str("HtGARZDjDyd9fR2AmvmVhr2xeoNVuxADj7DhsU1oREt").unwrap(),
                serum_coin_vault_account: Pubkey::from_str("EqYU43ZTap2beYX8uptDn3Kn8d6jFyH6mb6udLrkv6EF").unwrap(),
                serum_pc_vault_account: Pubkey::from_str("Dm6dhx94CyK5WWQ6YZxk8z3gp4WqKEwPrLEHEDBCcwyZ").unwrap(),
                serum_vault_signer: Pubkey::from_str("DuhnGJky7vEzgZTz2F4cV4fDEw2n9QstLyww576J5qSV").unwrap(),
            })
        } else {
            None
        }
    }
}

/// Get pool accounts for testing
pub fn get_mock_pool_accounts() -> RaydiumPoolAccounts {
    load_pool_accounts(
        &Pubkey::from_str("${poolConfig.poolId}").unwrap()
    ).unwrap()
}
`;

    fs.writeFileSync(relayerAccountsPath, relayerAccountsContent);
    console.log(chalk.green('✅ Relayer configuration updated'));
}

// External actions info
function printExternalActions() {
    console.log(chalk.blue('\n📋 Important Notes:\n'));
    
    console.log(chalk.yellow('1. Pool Authority'));
    console.log(chalk.white('   The pool currently has Raydium\'s default authority.'));
    console.log(chalk.white('   For production use with full FIFO enforcement, the'));
    console.log(chalk.white('   authority should be transferred to Continuum.\n'));
    
    console.log(chalk.yellow('2. Testing'));
    console.log(chalk.white('   You can now test swaps through the wrapper using:'));
    console.log(chalk.cyan('   npx ts-node scripts/test-continuum-swap-complete.ts\n'));
    
    console.log(chalk.yellow('3. Monitoring'));
    console.log(chalk.white('   Monitor the FIFO queue with:'));
    console.log(chalk.cyan('   npx ts-node scripts/examples/monitor-fifo.ts\n'));
    
    console.log(chalk.yellow('4. Relayer'));
    console.log(chalk.white('   The relayer has been updated with the new pool.'));
    console.log(chalk.white('   Rebuild and run the relayer to test HTTP API:'));
    console.log(chalk.cyan('   cd ../continuum-relayer && cargo run'));
}

async function main() {
    try {
        const poolConfig = await createContinuumPool();
        printExternalActions();
        
        console.log(chalk.green('\n✅ Setup Complete!'));
        console.log(chalk.white('\nPool Details:'));
        console.log(chalk.cyan(`Pool: https://solscan.io/account/${poolConfig.poolId}?cluster=devnet`));
        console.log(chalk.cyan(`TX: https://solscan.io/tx/${poolConfig.createTxId}?cluster=devnet`));
        
    } catch (error) {
        console.error(chalk.red('Failed to create pool'), error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}