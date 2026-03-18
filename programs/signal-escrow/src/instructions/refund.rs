use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use crate::state::*;
use crate::errors::SignalEscrowError;
use crate::events::DealRefunded;

#[derive(Accounts)]
#[instruction(deal_id: u64)]
pub struct Refund<'info> {
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
        bump = deal.bump
    )]
    pub deal: Account<'info, Deal>,

    #[account(
        mut,
        seeds = [b"vault", deal_id.to_le_bytes().as_ref()],
        bump = deal.vault_bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Client's token account for full refund
    #[account(mut, token::mint = deal.token_mint)]
    pub client_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(address = deal.token_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Refund>, deal_id: u64) -> Result<()> {
    let deal = &mut ctx.accounts.deal;

    require!(
        deal.status != DealStatus::Completed && deal.status != DealStatus::Cancelled,
        SignalEscrowError::DealFinalized
    );

    let decimals = ctx.accounts.token_mint.decimals;
    let deal_id_bytes = deal_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[b"deal", deal_id_bytes.as_ref(), &[deal.bump]]];

    let mut total_refunded: u64 = 0;

    for milestone in deal.milestones.iter_mut() {
        if milestone.status == MilestoneStatus::Funded
            || milestone.status == MilestoneStatus::Disputed
        {
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
                milestone.amount,
                decimals,
            )?;

            total_refunded = total_refunded.checked_add(milestone.amount).unwrap();
            milestone.status = MilestoneStatus::Refunded;
        }
    }

    require!(total_refunded > 0, SignalEscrowError::NothingToRefund);

    deal.status = DealStatus::Cancelled;

    emit!(DealRefunded {
        deal_id: deal.deal_id,
        total_refunded,
    });

    Ok(())
}
