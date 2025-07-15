#!/usr/bin/env ts-node
import { 
    Connection, 
    Keypair,
    PublicKey,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SystemProgram
} from '@solana/web3.js';
import { 
    LIQUIDITY_STATE_LAYOUT_V4,
    MARKET_STATE_LAYOUT_V3,
    Liquidity,
    Market,
    TOKEN_PROGRAM_ID
} from '@raydium-io/raydium-sdk';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');
const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');

// Use the first pool from our search (status 6 means initialized but maybe not active for trading)
const EXISTING_POOL_ID = new PublicKey('FWP3JA31eauPJA6RJftReaus3T75rUZc4xVCgGpz7CQQ');

async function main() {
    console.log('🚀 Using Existing Raydium Pool for Testing...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    console.log('\n🏊 Using existing pool:', EXISTING_POOL_ID.toBase58());
    
    // Fetch pool account
    const poolAccount = await connection.getAccountInfo(EXISTING_POOL_ID);
    if (!poolAccount || !poolAccount.owner.equals(RAYDIUM_AMM_V4)) {
        console.error('❌ Invalid pool');
        return;
    }
    
    // Decode pool state
    const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);
    
    console.log('\n📋 Pool Details:');
    console.log('  Status:', poolState.status.toString());
    console.log('  Base Mint:', poolState.baseMint.toBase58());
    console.log('  Quote Mint:', poolState.quoteMint.toBase58());
    console.log('  LP Mint:', poolState.lpMint.toBase58());
    console.log('  Market ID:', poolState.marketId.toBase58());
    
    // Fetch market account
    const marketAccount = await connection.getAccountInfo(poolState.marketId);
    if (!marketAccount) {
        console.error('❌ Market not found');
        return;
    }
    
    const marketState = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);
    
    // Calculate vault signer
    const [vaultSigner] = await PublicKey.findProgramAddress(
        [poolState.marketId.toBuffer(), Buffer.from([marketState.vaultSignerNonce.toNumber()])],
        poolState.marketProgramId
    );
    
    // Initialize pool authority in Continuum
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
    if (!existing) {
        const initPoolAuthData = Buffer.concat([
            Buffer.from([245, 243, 142, 59, 138, 3, 209, 46]), // initialize_pool_authority discriminator
            EXISTING_POOL_ID.toBuffer(),
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
    } else {
        console.log('✅ Pool authority already initialized');
    }
    
    // Save pool configuration
    const poolConfig = {
        poolId: EXISTING_POOL_ID.toBase58(),
        poolType: 'AMM_V4',
        status: poolState.status.toString(),
        baseMint: poolState.baseMint.toBase58(),
        quoteMint: poolState.quoteMint.toBase58(),
        lpMint: poolState.lpMint.toBase58(),
        baseDecimals: poolState.baseDecimal.toNumber(),
        quoteDecimals: poolState.quoteDecimal.toNumber(),
        
        // Pool accounts
        ammAuthority: Liquidity.getAssociatedAuthority({ programId: RAYDIUM_AMM_V4 }).publicKey.toBase58(),
        openOrders: poolState.openOrders.toBase58(),
        targetOrders: poolState.targetOrders.toBase58(),
        baseVault: poolState.baseVault.toBase58(),
        quoteVault: poolState.quoteVault.toBase58(),
        poolCoinTokenAccount: poolState.baseVault.toBase58(),
        poolPcTokenAccount: poolState.quoteVault.toBase58(),
        
        // Market info
        marketId: poolState.marketId.toBase58(),
        marketProgramId: poolState.marketProgramId.toBase58(),
        marketAuthority: Market.getAssociatedAuthority({ 
            programId: poolState.marketProgramId, 
            marketId: poolState.marketId 
        }).publicKey.toBase58(),
        
        // Serum/OpenBook accounts
        serumMarket: poolState.marketId.toBase58(),
        serumBids: marketState.bids.toBase58(),
        serumAsks: marketState.asks.toBase58(),
        serumEventQueue: marketState.eventQueue.toBase58(),
        serumCoinVaultAccount: marketState.baseVault.toBase58(),
        serumPcVaultAccount: marketState.quoteVault.toBase58(),
        serumVaultSigner: vaultSigner.toBase58(),
        
        // Program IDs
        ammProgramId: RAYDIUM_AMM_V4.toBase58(),
        serumProgramId: poolState.marketProgramId.toBase58(),
        tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
        
        // Continuum
        continuumAuthority: continuumPoolAuthority.toBase58(),
        poolAuthorityState: poolAuthorityState.toBase58(),
        
        fetchedAt: new Date().toISOString(),
        note: 'Using existing pool for testing - we do not control pool authority'
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../existing-pool-config-devnet.json'),
        JSON.stringify(poolConfig, null, 2)
    );
    
    console.log('\n💾 Pool configuration saved to existing-pool-config-devnet.json');
    console.log('\n✅ Setup complete!');
    console.log('\n⚠️  Note: This pool\'s authority is controlled by Raydium, not Continuum.');
    console.log('Swaps will fail at the authority check, but we can test the wrapper logic.');
    
    // Update relayer configuration
    updateRelayerConfig(poolConfig);
}

function updateRelayerConfig(poolConfig: any) {
    console.log('\n🔄 Updating relayer configuration...');
    
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
    // Existing test pool
    let test_pool_id = Pubkey::from_str("${poolConfig.poolId}").ok()?;
    
    if pool_id == &test_pool_id {
        Some(RaydiumPoolAccounts {
            pool_id: test_pool_id,
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
        None
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
    console.log('✅ Relayer configuration updated');
}

main().catch(console.error);