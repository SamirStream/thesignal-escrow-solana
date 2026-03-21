use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use crate::state::*;
use crate::errors::SignalEscrowError;
use crate::events::DisputeResolved;

#[derive(Accounts)]
#[instruction(deal_id: u64, milestone_idx: u8)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"escrow_config"],
        bump = config.bump,
        constraint = config.admin == admin.key() @ SignalEscrowError::AdminOnly
    )]
    pub config: Account<'info, EscrowConfig>,

    #[account(
        mut,
        seeds = [b"deal", deal_id.to_le_bytes().as_ref()],
        bump = deal.bump,
        constraint = deal.status == DealStatus::Disputed @ SignalEscrowError::DealNotDisputed
    )]
    pub deal: Account<'info, Deal>,

    #[account(
        mut,
        seeds = [b"vault", deal_id.to_le_bytes().as_ref()],
        bump = deal.vault_bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Client's token account for refund portion
    #[account(mut, token::mint = deal.token_mint)]
    pub client_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Provider's token account for their portion
    #[account(mut, token::mint = deal.token_mint)]
    pub provider_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(address = deal.token_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ResolveDispute>, deal_id: u64, milestone_idx: u8, refund_bps: u16) -> Result<()> {
    require!(refund_bps <= 10000, SignalEscrowError::InvalidRefundBps);

    let deal = &mut ctx.accounts.deal;
    let idx = milestone_idx as usize;

    require!(idx < deal.milestones.len(), SignalEscrowError::InvalidMilestoneIndex);
    require!(
        deal.milestones[idx].status == MilestoneStatus::Disputed,
        SignalEscrowError::MilestoneNotDisputed
    );

    let amount = deal.milestones[idx].amount;
    let decimals = ctx.accounts.token_mint.decimals;

    let client_refund = amount
        .checked_mul(refund_bps as u64)
        .and_then(|v| v.checked_div(10000))
        .ok_or(SignalEscrowError::Overflow)?;

    let provider_amount = amount
        .checked_sub(client_refund)
        .ok_or(SignalEscrowError::Overflow)?;

    let deal_id_bytes = deal_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[b"deal", deal_id_bytes.as_ref(), &[deal.bump]]];

    // Transfer refund to client
    if client_refund > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.client_token_account.to_account_info(),
                    authority: deal.to_account_info(),
                },
                signer_seeds,
            ),
            client_refund,
            decimals,
        )?;
    }

    // Transfer remainder to provider
    if provider_amount > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.provider_token_account.to_account_info(),
                    authority: deal.to_account_info(),
                },
                signer_seeds,
            ),
            provider_amount,
            decimals,
        )?;
    }

    deal.milestones[idx].status = MilestoneStatus::Refunded;

    // Check if any milestones are still active
    let has_active = deal.milestones.iter().any(|m| {
        m.status == MilestoneStatus::Funded || m.status == MilestoneStatus::Disputed
    });
    if !has_active {
        deal.status = DealStatus::Cancelled;
    }

    emit!(DisputeResolved {
        deal_id: deal.deal_id,
        milestone_idx,
        client_refund,
        provider_amount,
    });

    Ok(())
}
