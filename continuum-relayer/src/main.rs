use anchor_client::{Client, Cluster, Program};
use anchor_lang::prelude::*;
use anyhow::Result;
use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use spl_associated_token_account::get_associated_token_address;
use spl_token::instruction::approve_checked;
use std::{
    str::FromStr,
    sync::Arc,
    time::Duration,
};
use tokio::sync::RwLock;

mod config;
mod errors;
mod pool_manager;
mod sequence_tracker;
mod swap_executor;

use config::RelayerConfig;
use errors::RelayerError;
use pool_manager::PoolManager;
use sequence_tracker::SequenceTracker;
use swap_executor::SwapExecutor;

// Constants
const CONTINUUM_PROGRAM_ID: &str = "9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y";
const RAYDIUM_AMM_V4: &str = "HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8";

#[derive(Clone)]
struct RelayerState {
    config: Arc<RelayerConfig>,
    rpc_client: Arc<RpcClient>,
    sequence_tracker: Arc<RwLock<SequenceTracker>>,
    pool_manager: Arc<PoolManager>,
    swap_executor: Arc<SwapExecutor>,
    relayer_keypair: Arc<Keypair>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SwapRequest {
    user_pubkey: String,
    pool_id: String,
    amount_in: u64,
    minimum_amount_out: u64,
    token_a_account: String,
    token_b_account: String,
    is_a_to_b: bool,
}

#[derive(Debug, Serialize)]
struct SwapResponse {
    signature: String,
    sequence: u64,
    estimated_output: u64,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
    current_sequence: u64,
    pending_swaps: usize,
    pools_tracked: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    info!("Starting Continuum Relayer...");

    // Load configuration
    let config = RelayerConfig::from_env()?;
    let rpc_client = Arc::new(RpcClient::new_with_commitment(
        config.rpc_url.clone(),
        CommitmentConfig::confirmed(),
    ));

    // Load relayer keypair
    let relayer_keypair = Arc::new(
        Keypair::from_bytes(&bs58::decode(&config.relayer_private_key).into_vec()?)?
    );
    
    info!("Relayer pubkey: {}", relayer_keypair.pubkey());

    // Initialize components
    let sequence_tracker = Arc::new(RwLock::new(
        SequenceTracker::new(&config.database_path)?
    ));
    
    let pool_manager = Arc::new(
        PoolManager::new(rpc_client.clone(), config.clone())
    );
    
    let swap_executor = Arc::new(
        SwapExecutor::new(
            rpc_client.clone(),
            relayer_keypair.clone(),
            sequence_tracker.clone(),
        )
    );

    // Create app state
    let state = RelayerState {
        config: Arc::new(config.clone()),
        rpc_client,
        sequence_tracker,
        pool_manager,
        swap_executor,
        relayer_keypair,
    };

    // Start background tasks
    let state_clone = state.clone();
    tokio::spawn(async move {
        sequence_monitor_task(state_clone).await;
    });

    // Build HTTP server
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/swap", post(swap_handler))
        .route("/pools", get(pools_handler))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    info!("Listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_handler(
    State(state): State<RelayerState>,
) -> Result<Json<HealthResponse>, StatusCode> {
    let tracker = state.sequence_tracker.read().await;
    let current_seq = tracker.get_current_sequence()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(HealthResponse {
        status: "healthy".to_string(),
        current_sequence: current_seq,
        pending_swaps: tracker.get_pending_count(),
        pools_tracked: state.pool_manager.get_pool_count(),
    }))
}

async fn swap_handler(
    State(state): State<RelayerState>,
    Json(request): Json<SwapRequest>,
) -> Result<Json<SwapResponse>, StatusCode> {
    info!("Received swap request: {:?}", request);
    
    // Validate request
    let user_pubkey = Pubkey::from_str(&request.user_pubkey)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let pool_id = Pubkey::from_str(&request.pool_id)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    
    // Execute swap
    match state.swap_executor.execute_swap(request).await {
        Ok(response) => Ok(Json(response)),
        Err(e) => {
            error!("Swap execution failed: {:?}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn pools_handler(
    State(state): State<RelayerState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    Ok(Json(state.pool_manager.get_pool_list()))
}

async fn sequence_monitor_task(state: RelayerState) {
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    
    loop {
        interval.tick().await;
        
        // Monitor sequence and process pending swaps
        if let Err(e) = process_pending_swaps(&state).await {
            error!("Error processing pending swaps: {:?}", e);
        }
    }
}

async fn process_pending_swaps(state: &RelayerState) -> Result<()> {
    let mut tracker = state.sequence_tracker.write().await;
    
    // Get on-chain sequence
    let fifo_state_pubkey = get_fifo_state_pubkey();
    let account_data = state.rpc_client.get_account(&fifo_state_pubkey)?;
    
    if account_data.data.len() >= 16 {
        let current_seq = u64::from_le_bytes(
            account_data.data[8..16].try_into().unwrap()
        );
        tracker.update_on_chain_sequence(current_seq)?;
    }
    
    Ok(())
}

fn get_fifo_state_pubkey() -> Pubkey {
    let program_id = Pubkey::from_str(CONTINUUM_PROGRAM_ID).unwrap();
    let (pda, _) = Pubkey::find_program_address(&[b"fifo_state"], &program_id);
    pda
}
