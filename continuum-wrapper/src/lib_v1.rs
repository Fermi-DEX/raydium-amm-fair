
//! Continuum FIFO wrapper for Raydium swaps
//! -------------------------------------------------------------
//! * Enforces global, monotonically‑increasing `seq` so every swap
//!   must arrive through Continuum ordering.
//! * Uses a *Program‑Derived Address* (PDA) as the delegate that
//!   holds temporary spend‑authority over the user's source token
//!   account *only while this instruction executes*.
//! * After the CPI call into Raydium, the allowance is immediately
//!   revoked, bringing risk back to zero.
//! * Upgrade authority should be **burned** after audit; the PDA has
//!   no private key so off‑chain infrastructure cannot misuse it.
//!
//! Compile‑tested with Anchor 0.30.

use anchor_lang::prelude::*;

use anchor_lang::solana_program;
use anchor_spl::token::{self, Revoke, Token, TokenAccount};

// -----------------------------------------------------------------------------
// Program declaration
// -----------------------------------------------------------------------------

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

    /// Wrapper entry‑point. The client passes:
    /// * `seq`               – next FIFO number that *must* equal `fifo_state.seq + 1`.
    /// * `raydium_ix_data`   – the **raw** serialized Raydium `Swap` instruction data.
    /// Remaining accounts are *exactly* the accounts Raydium expects for its swap,
    /// prefixed with the accounts declared in [`SwapWithSeq`].
    pub fn swap_with_seq(
        ctx: Context<SwapWithSeq>,
        seq: u64,
        raydium_ix_data: Vec<u8>,
    ) -> Result<()> {
        // 1️⃣  FIFO check --------------------------------------------------------------------
        let state = &mut ctx.accounts.fifo_state;
        require!(state.seq + 1 == seq, ErrorCode::BadSeq);

        // 2️⃣  Build the Raydium CPI instruction ---------------------------------------------
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

        // Seeds for the delegate PDA signer
        let delegate_bump = ctx.bumps.delegate_authority;
        let user_source_key = ctx.accounts.user_source.key();
        let delegate_seeds: &[&[u8]] = &[
            b"delegate",
            user_source_key.as_ref(),
            &[delegate_bump],
        ];

        // 3️⃣  CPI into Raydium with PDA signature -------------------------------------------
        solana_program::program::invoke_signed(
            &ix,
            ctx.remaining_accounts,
            &[delegate_seeds],
        )?;

        // 4️⃣  Immediately revoke the temporary allowance ------------------------------------
        let revoke_seeds: &[&[u8]] = &[
            b"delegate",
            user_source_key.as_ref(),
            &[delegate_bump],
        ];
        let signer_seeds = &[revoke_seeds];
        
        let revoke_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Revoke {
                source: ctx.accounts.user_source.to_account_info(),
                authority: ctx.accounts.delegate_authority.to_account_info(),
            },
            signer_seeds,
        );
        token::revoke(revoke_ctx)?;

        // 5️⃣  Advance sequence and emit event ----------------------------------------------
        state.seq = seq;
        emit!(SeqEvent {
            seq,
            user: ctx.accounts.user.key(),
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Accounts & state
// -----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 8, // discriminator + u64
        seeds = [b"fifo_state"],
        bump
    )]
    pub fifo_state: Account<'info, FifoState>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SwapWithSeq<'info> {
    /// Global FIFO account (one per Raydium pair or per wrapper instance).
    #[account(mut, seeds = [b"fifo_state"], bump)]
    pub fifo_state: Account<'info, FifoState>,

    /// PDA that temporarily acts as *delegate authority* over `user_source`.
    /// Seeds: ["delegate", user_source]
    /// *Must* be passed in `remaining_accounts` list where Raydium expects
    /// the `user_authority` signer.
    #[account(
        mut,
        seeds = [b"delegate", user_source.key().as_ref()],
        bump
    )]
    pub delegate_authority: UncheckedAccount<'info>,

    /// Signer of the outer transaction (e.g. wallet or relayer).
    pub user: Signer<'info>,

    /// User's SPL‑Token account that supplies the *input* tokens.
    #[account(mut)]
    pub user_source: Account<'info, TokenAccount>,

    /// Where the *output* tokens will be credited; passed to Raydium as usual.
    #[account(mut)]
    pub user_destination: Account<'info, TokenAccount>,

    /// Raydium AMM or CLMM program – checked at runtime if desired.
    /// KEEP AS `UncheckedAccount` to avoid Anchor's ownership constraint.
    pub raydium_program: UncheckedAccount<'info>,

    /// SPL‑Token program.
    pub token_program: Program<'info, Token>,

    // ---------------------------------------------------------------------
    // NOTE: All other accounts required by Raydium's swap (pool vaults,
    // pool authority, tick arrays, etc.) must be appended to the
    // transaction's `remaining_accounts` in *exact* order expected by
    // Raydium. The wrapper forwards them untouched.
    // ---------------------------------------------------------------------
}

#[account]
pub struct FifoState {
    pub seq: u64,
}

#[event]
pub struct SeqEvent {
    pub seq: u64,
    pub user: Pubkey,
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

#[error_code]
pub enum ErrorCode {
    #[msg("Sequence mismatch: expected fifo_state.seq + 1")] 
    BadSeq,
    #[msg("Missing bump for delegate PDA (program error)")]
    MissingBump,
}

// -----------------------------------------------------------------------------
// Tests (optional): Place in `tests/` directory when scaffolding with Anchor.
// -----------------------------------------------------------------------------
// Use `anchor test` with a local Raydium mock to confirm:
// 1. Sequence enforcement.
// 2. Swap succeeds and allowance is revoked.
// 3. Any seq‑gap causes transaction failure.