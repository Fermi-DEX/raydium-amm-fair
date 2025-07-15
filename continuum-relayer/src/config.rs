use anyhow::Result;

#[derive(Clone)]
pub struct RelayerConfig {
    pub rpc_url: String,
    pub relayer_private_key: String,
    pub database_path: String,
    pub port: u16,
}

impl RelayerConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            rpc_url: std::env::var("RPC_URL")
                .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string()),
            relayer_private_key: std::env::var("RELAYER_PRIVATE_KEY")
                .unwrap_or_else(|_| "".to_string()), // Will need to be set
            database_path: std::env::var("DATABASE_PATH")
                .unwrap_or_else(|_| "./relayer.db".to_string()),
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()?,
        })
    }
}