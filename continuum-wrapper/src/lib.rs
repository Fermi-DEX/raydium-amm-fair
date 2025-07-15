//! Continuum FIFO wrapper V2 - With Pool Authority Support
//! This version ensures ALL swaps must go through FIFO ordering

use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_spl::token::{self, Revoke, Token, TokenAccount};

declare_id!("9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y");

#[program]
pub mod continuum_wrapper {
    use super::*;

    /// Initialize the global FIFO state
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.fifo_state;
        state.seq = 0;
        Ok(())
    }

    /// Initialize pool authority for a specific pool
    pub fn initialize_pool_authority(
        ctx: Context<InitializePoolAuthority>,
        pool_id: Pubkey,
    ) -> Result<()> {
        let pool_auth = &mut ctx.accounts.pool_authority_state;
        pool_auth.pool_id = pool_id;
        pool_auth.fifo_enforced = true;
        pool_auth.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Swap with FIFO ordering AND pool authority
    /// This version signs with both delegate AND pool authority
    pub fn swap_with_pool_authority(
        ctx: Context<SwapWithPoolAuthority>,
        seq: u64,
        raydium_ix_data: Vec<u8>,
    ) -> Result<()> {
        // 1️⃣  FIFO check
        let state = &mut ctx.accounts.fifo_state;
        require!(state.seq + 1 == seq, ErrorCode::BadSeq);

        // 2️⃣  Build the Raydium CPI instruction
        let ix = solana_program::instruction::Instruction {
            program_id: ctx.accounts.raydium_program.key(),
            accounts: ctx
                .remaining_accounts
                .iter()
                .map(|acc| solana_program::instruction::AccountMeta {
                    pubkey: acc.key(),
                    is_signer: acc.is_signer,
                    is_writable: acc.is_writable,
                })
                .collect(),
            data: raydium_ix_data,
        };

        // Seeds for BOTH signers
        let delegate_bump = ctx.bumps.delegate_authority;
        let pool_auth_bump = ctx.bumps.pool_authority;
        let user_source_key = ctx.accounts.user_source.key();
        let pool_id = ctx.accounts.pool_authority_state.pool_id;
        
        let delegate_seeds: &[&[u8]] = &[
            b"delegate",
            user_source_key.as_ref(),
            &[delegate_bump],
        ];
        
        let pool_auth_seeds: &[&[u8]] = &[
            b"pool_authority",
            pool_id.as_ref(),
            &[pool_auth_bump],
        ];

        // 3️⃣  CPI with BOTH signatures
        solana_program::program::invoke_signed(
            &ix,
            ctx.remaining_accounts,
            &[delegate_seeds, pool_auth_seeds], // Both PDAs sign!
        )?;

        // 4️⃣  Revoke delegate
        let revoke_seeds = &[delegate_seeds];
        let revoke_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Revoke {
                source: ctx.accounts.user_source.to_account_info(),
                authority: ctx.accounts.delegate_authority.to_account_info(),
            },
            revoke_seeds,
        );
        token::revoke(revoke_ctx)?;

        // 5️⃣  Advance sequence
        state.seq = seq;
        emit!(SwapEvent {
            seq,
            user: ctx.accounts.user.key(),
            pool_id,
        });

        Ok(())
    }

    /// Create a pool with Continuum as authority
    pub fn create_pool_with_authority(
        _ctx: Context<CreatePoolWithAuthority>,
        _pool_params: CreatePoolParams,
    ) -> Result<()> {
        // This would contain the logic to create a Raydium pool
        // with the Continuum pool authority PDA as the authority
        // Implementation depends on Raydium's pool creation interface
        
        msg!("Pool creation with FIFO authority not yet implemented");
        Ok(())
    }
}

// Account structures

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 8,
        seeds = [b"fifo_state"],
        bump
    )]
    pub fifo_state: Account<'info, FifoState>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: Pubkey)]
pub struct InitializePoolAuthority<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 8 + 1, // discriminator + pubkey + timestamp + bool
        seeds = [b"pool_authority_state", pool_id.as_ref()],
        bump
    )]
    pub pool_authority_state: Account<'info, PoolAuthorityState>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SwapWithPoolAuthority<'info> {
    #[account(mut, seeds = [b"fifo_state"], bump)]
    pub fifo_state: Account<'info, FifoState>,

    /// Pool authority state
    #[account(
        seeds = [b"pool_authority_state", pool_authority_state.pool_id.as_ref()],
        bump
    )]
    pub pool_authority_state: Account<'info, PoolAuthorityState>,

    /// Pool authority PDA that signs for pool operations
    #[account(
        seeds = [b"pool_authority", pool_authority_state.pool_id.as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// Delegate authority for user's tokens
    #[account(
        seeds = [b"delegate", user_source.key().as_ref()],
        bump
    )]
    pub delegate_authority: UncheckedAccount<'info>,

    pub user: Signer<'info>,

    #[account(mut)]
    pub user_source: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_destination: Account<'info, TokenAccount>,

    pub raydium_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CreatePoolWithAuthority<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    /// Pool authority PDA that will control the pool
    #[account(
        seeds = [b"pool_authority", pool_id.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,
    
    /// The pool account to be created
    pub pool_id: UncheckedAccount<'info>,
    
    pub raydium_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

// State structures

#[account]
pub struct FifoState {
    pub seq: u64,
}

#[account]
pub struct PoolAuthorityState {
    pub pool_id: Pubkey,
    pub created_at: i64,
    pub fifo_enforced: bool,
}

// Events

#[event]
pub struct SwapEvent {
    pub seq: u64,
    pub user: Pubkey,
    pub pool_id: Pubkey,
}

// Errors

#[error_code]
pub enum ErrorCode {
    #[msg("Sequence mismatch: expected fifo_state.seq + 1")] 
    BadSeq,
}

// Parameters

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreatePoolParams {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_amount: u64,
    pub quote_amount: u64,
    // Additional pool parameters...
}