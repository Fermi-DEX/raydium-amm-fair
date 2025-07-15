#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';

async function main() {
    console.log('🔄 Updating Relayer with Pool Accounts...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load token info for testing
    const tokenPath = path.join(__dirname, '../continuum-tokens-devnet.json');
    const tokenInfo = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    
    // Create a test pool configuration using mock accounts
    const testPoolConfig = {
        poolId: PublicKey.findProgramAddressSync(
            [Buffer.from('test_pool_cont_fifo')],
            new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8')
        )[0].toBase58(),
        
        // Token info
        baseMint: tokenInfo.CONT.mint,
        quoteMint: tokenInfo.FIFO.mint,
        baseDecimals: 9,
        quoteDecimals: 9,
        
        // Generate mock accounts for testing
        ammAuthority: PublicKey.findProgramAddressSync(
            [Buffer.from('amm_authority')],
            new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8')
        )[0].toBase58(),
        
        // Mock vault accounts
        poolCoinTokenAccount: PublicKey.default.toBase58(),
        poolPcTokenAccount: PublicKey.default.toBase58(),
        
        // Mock pool accounts
        openOrders: PublicKey.default.toBase58(),
        targetOrders: PublicKey.default.toBase58(),
        
        // Mock market accounts
        serumProgramId: 'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
        serumMarket: PublicKey.default.toBase58(),
        serumBids: PublicKey.default.toBase58(),
        serumAsks: PublicKey.default.toBase58(),
        serumEventQueue: PublicKey.default.toBase58(),
        serumCoinVaultAccount: PublicKey.default.toBase58(),
        serumPcVaultAccount: PublicKey.default.toBase58(),
        serumVaultSigner: PublicKey.default.toBase58(),
        
        ammProgramId: 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8',
        tokenProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        
        note: 'Mock pool configuration for testing FIFO wrapper functionality',
        createdAt: new Date().toISOString()
    };
    
    // Save test pool configuration
    fs.writeFileSync(
        path.join(__dirname, '../test-pool-config-devnet.json'),
        JSON.stringify(testPoolConfig, null, 2)
    );
    
    console.log('💾 Test pool configuration saved');
    
    // Update relayer swap executor
    const swapExecutorPath = path.join(__dirname, '../../continuum-relayer/src/swap_executor.rs');
    const swapExecutorContent = fs.readFileSync(swapExecutorPath, 'utf8');
    
    // Create updated raydium_accounts.rs with the test pool
    const raydiumAccountsContent = `use solana_sdk::pubkey::Pubkey;
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
    /// Get all Raydium accounts in the correct order for CPI
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
    // Test pool for CONT/FIFO
    let test_pool_id = Pubkey::from_str("${testPoolConfig.poolId}").ok()?;
    
    if pool_id == &test_pool_id {
        Some(RaydiumPoolAccounts {
            pool_id: test_pool_id,
            amm_authority: Pubkey::from_str("${testPoolConfig.ammAuthority}").unwrap(),
            amm_open_orders: Pubkey::from_str("${testPoolConfig.openOrders}").unwrap(),
            amm_target_orders: Pubkey::from_str("${testPoolConfig.targetOrders}").unwrap(),
            pool_coin_token_account: Pubkey::from_str("${testPoolConfig.poolCoinTokenAccount}").unwrap(),
            pool_pc_token_account: Pubkey::from_str("${testPoolConfig.poolPcTokenAccount}").unwrap(),
            serum_program_id: Pubkey::from_str("${testPoolConfig.serumProgramId}").unwrap(),
            serum_market: Pubkey::from_str("${testPoolConfig.serumMarket}").unwrap(),
            serum_bids: Pubkey::from_str("${testPoolConfig.serumBids}").unwrap(),
            serum_asks: Pubkey::from_str("${testPoolConfig.serumAsks}").unwrap(),
            serum_event_queue: Pubkey::from_str("${testPoolConfig.serumEventQueue}").unwrap(),
            serum_coin_vault_account: Pubkey::from_str("${testPoolConfig.serumCoinVaultAccount}").unwrap(),
            serum_pc_vault_account: Pubkey::from_str("${testPoolConfig.serumPcVaultAccount}").unwrap(),
            serum_vault_signer: Pubkey::from_str("${testPoolConfig.serumVaultSigner}").unwrap(),
        })
    } else {
        None
    }
}

/// Mock pool accounts for testing
pub fn get_mock_pool_accounts() -> RaydiumPoolAccounts {
    load_pool_accounts(
        &Pubkey::from_str("${testPoolConfig.poolId}").unwrap()
    ).unwrap()
}
`;

    fs.writeFileSync(
        path.join(__dirname, '../../continuum-relayer/src/raydium_accounts.rs'),
        raydiumAccountsContent
    );
    
    console.log('✅ Updated raydium_accounts.rs with test pool configuration');
    console.log('\n📝 Next steps:');
    console.log('1. cd ../continuum-relayer && cargo build');
    console.log('2. Run the relayer: cargo run');
    console.log('3. Test swaps using the HTTP API');
}

main().catch(console.error);