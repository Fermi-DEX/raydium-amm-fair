use crate::config::RelayerConfig;
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::sync::Arc;
use std::collections::HashMap;

pub struct PoolInfo {
    pub pool_id: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub authority: Pubkey,
    pub is_continuum_controlled: bool,
}

pub struct PoolManager {
    rpc_client: Arc<RpcClient>,
    config: RelayerConfig,
    pools: HashMap<Pubkey, PoolInfo>,
}

impl PoolManager {
    pub fn new(rpc_client: Arc<RpcClient>, config: RelayerConfig) -> Self {
        Self {
            rpc_client,
            config,
            pools: HashMap::new(),
        }
    }
    
    pub fn get_pool_count(&self) -> usize {
        self.pools.len()
    }
    
    pub fn get_pool_list(&self) -> Vec<String> {
        self.pools.keys().map(|p| p.to_string()).collect()
    }
    
    pub fn get_pool(&self, pool_id: &Pubkey) -> Option<&PoolInfo> {
        self.pools.get(pool_id)
    }
    
    pub fn add_pool(&mut self, pool_info: PoolInfo) {
        self.pools.insert(pool_info.pool_id, pool_info);
    }
    
    pub fn is_continuum_controlled(&self, pool_id: &Pubkey) -> bool {
        self.pools
            .get(pool_id)
            .map(|p| p.is_continuum_controlled)
            .unwrap_or(false)
    }
}