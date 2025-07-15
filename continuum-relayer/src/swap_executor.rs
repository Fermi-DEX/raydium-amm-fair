use crate::{
    errors::RelayerError,
    sequence_tracker::SequenceTracker,
    raydium_accounts::{RaydiumPoolAccounts, load_pool_accounts, get_mock_pool_accounts},
    SwapRequest, SwapResponse,
    CONTINUUM_PROGRAM_ID, RAYDIUM_AMM_V4,
};
use anyhow::Result;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
    compute_budget::ComputeBudgetInstruction,
    commitment_config::CommitmentConfig,
};
use spl_token::instruction::approve_checked;
use spl_associated_token_account::get_associated_token_address;
use std::{str::FromStr, sync::Arc};
use tokio::sync::RwLock;

pub struct SwapExecutor {
    rpc_client: Arc<RpcClient>,
    keypair: Arc<Keypair>,
    sequence_tracker: Arc<RwLock<SequenceTracker>>,
}

impl SwapExecutor {
    pub fn new(
        rpc_client: Arc<RpcClient>,
        keypair: Arc<Keypair>,
        sequence_tracker: Arc<RwLock<SequenceTracker>>,
    ) -> Self {
        Self {
            rpc_client,
            keypair,
            sequence_tracker,
        }
    }
    
    pub async fn execute_swap(
        &self,
        request: SwapRequest,
    ) -> Result<SwapResponse> {
        // Parse pubkeys
        let user_pubkey = Pubkey::from_str(&request.user_pubkey)?;
        let pool_id = Pubkey::from_str(&request.pool_id)?;
        let token_a_account = Pubkey::from_str(&request.token_a_account)?;
        let token_b_account = Pubkey::from_str(&request.token_b_account)?;
        
        // Get next sequence
        let mut tracker = self.sequence_tracker.write().await;
        let next_seq = tracker.get_next_sequence();
        drop(tracker); // Release lock early
        
        // Load pool accounts
        let pool_accounts = load_pool_accounts(&pool_id)
            .ok_or_else(|| anyhow::anyhow!("Pool not found: {}", pool_id))?;
        
        // Determine source and destination
        let (source_account, dest_account, source_mint, dest_mint) = if request.is_a_to_b {
            (
                token_a_account, 
                token_b_account,
                Pubkey::from_str("Fk3i45btpZTU1a1npiNvd7my7q67kNnPsYd11Qs98RJm")?, // CONT mint
                Pubkey::from_str("4QHAYf1fEfJA57WcEuN8FEZkWJiRx9G2uDNF5RQoKrzp")?, // FIFO mint
            )
        } else {
            (
                token_b_account, 
                token_a_account,
                Pubkey::from_str("4QHAYf1fEfJA57WcEuN8FEZkWJiRx9G2uDNF5RQoKrzp")?, // FIFO mint
                Pubkey::from_str("Fk3i45btpZTU1a1npiNvd7my7q67kNnPsYd11Qs98RJm")?, // CONT mint
            )
        };
        
        // Derive PDAs
        let program_id = Pubkey::from_str(CONTINUUM_PROGRAM_ID)?;
        let (delegate_authority, _) = Pubkey::find_program_address(
            &[b"delegate", source_account.as_ref()],
            &program_id,
        );
        
        let (fifo_state, _) = Pubkey::find_program_address(
            &[b"fifo_state"],
            &program_id,
        );
        
        let (pool_authority_state, _) = Pubkey::find_program_address(
            &[b"pool_authority_state", pool_id.as_ref()],
            &program_id,
        );
        
        let (pool_authority, _) = Pubkey::find_program_address(
            &[b"pool_authority", pool_id.as_ref()],
            &program_id,
        );
        
        // Build transaction
        let blockhash = self.rpc_client.get_latest_blockhash()?;
        let mut transaction = Transaction::new_with_payer(
            &[],
            Some(&self.keypair.pubkey()),
        );
        
        // Add compute budget
        transaction.add(ComputeBudgetInstruction::set_compute_unit_limit(600_000));
        
        // Add approve instruction
        let approve_ix = approve_checked(
            &spl_token::id(),
            &source_account,
            &source_mint,
            &delegate_authority,
            &user_pubkey,
            &[],
            request.amount_in,
            9, // decimals
        )?;
        transaction.add(approve_ix);
        
        // Build swap instruction
        let swap_ix = self.build_swap_instruction(
            pool_id,
            pool_authority_state,
            pool_authority,
            fifo_state,
            user_pubkey,
            source_account,
            dest_account,
            delegate_authority,
            request.amount_in,
            request.minimum_amount_out,
            next_seq,
            pool_accounts,
        )?;
        transaction.add(swap_ix);
        
        // Sign and send
        transaction.sign(&[self.keypair.as_ref()], blockhash);
        
        let signature = self.rpc_client.send_and_confirm_transaction_with_spinner_and_config(
            &transaction,
            CommitmentConfig::confirmed(),
            Default::default(),
        )?;
        
        Ok(SwapResponse {
            signature: signature.to_string(),
            sequence: next_seq,
            estimated_output: request.minimum_amount_out,
        })
    }
    
    fn build_swap_instruction(
        &self,
        pool_id: Pubkey,
        pool_authority_state: Pubkey,
        pool_authority: Pubkey,
        fifo_state: Pubkey,
        user: Pubkey,
        source: Pubkey,
        destination: Pubkey,
        delegate_authority: Pubkey,
        amount_in: u64,
        minimum_amount_out: u64,
        sequence: u64,
        pool_accounts: RaydiumPoolAccounts,
    ) -> Result<Instruction> {
        // Build Raydium swap data
        let raydium_data = self.build_raydium_swap_data(amount_in, minimum_amount_out);
        
        // Build wrapper instruction data
        let mut data = Vec::new();
        data.extend_from_slice(&[237, 180, 80, 103, 107, 172, 187, 137]); // swap_with_pool_authority discriminator
        data.extend_from_slice(&sequence.to_le_bytes());
        data.extend_from_slice(&(raydium_data.len() as u32).to_le_bytes());
        data.extend_from_slice(&raydium_data);
        
        // Build account list
        let mut accounts = vec![
            // Wrapper-specific accounts
            AccountMeta::new(fifo_state, false),
            AccountMeta::new_readonly(pool_authority_state, false),
            AccountMeta::new_readonly(pool_authority, false),
            AccountMeta::new_readonly(delegate_authority, false),
            AccountMeta::new_readonly(user, true), // User is signer
            AccountMeta::new(source, false),
            AccountMeta::new(destination, false),
            AccountMeta::new_readonly(Pubkey::from_str(RAYDIUM_AMM_V4)?, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ];
        
        // Add Raydium accounts
        let raydium_accounts = pool_accounts.to_account_metas(source, destination, pool_authority);
        accounts.extend(raydium_accounts);
        
        Ok(Instruction {
            program_id: Pubkey::from_str(CONTINUUM_PROGRAM_ID)?,
            accounts,
            data,
        })
    }
    
    fn build_raydium_swap_data(&self, amount_in: u64, minimum_amount_out: u64) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&[248, 198, 158, 145, 225, 117, 135, 200]); // Raydium swap discriminator
        data.extend_from_slice(&amount_in.to_le_bytes());
        data.extend_from_slice(&minimum_amount_out.to_le_bytes());
        data
    }
}