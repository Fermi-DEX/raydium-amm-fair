use thiserror::Error;

#[derive(Error, Debug)]
pub enum RelayerError {
    #[error("Sequence mismatch")]
    SequenceMismatch,
    #[error("Pool not found")]
    PoolNotFound,
    #[error("RPC error: {0}")]
    RpcError(String),
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("Invalid request: {0}")]
    InvalidRequest(String),
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),
}