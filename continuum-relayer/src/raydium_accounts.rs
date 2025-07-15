use solana_sdk::pubkey::Pubkey;
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

/// Get pool accounts for testing
pub fn get_mock_pool_accounts() -> RaydiumPoolAccounts {
    load_pool_accounts(
        &Pubkey::from_str("FWP3JA31eauPJA6RJftReaus3T75rUZc4xVCgGpz7CQQ").unwrap()
    ).unwrap()
}
