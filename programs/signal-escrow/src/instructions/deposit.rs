use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::*;
use crate::errors::SignalEscrowError;
use crate::events::MilestoneFunded;

#[derive(Accounts)]
#[instruction(deal_id: u64, milestone_idx: u8)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deal", deal_id.to_le_bytes().as_ref()],
        bump = deal.bump,
        constraint = deal.client == client.key() @ SignalEscrowError::Unauthorized
    )]
    pub deal: Account<'info, Deal>,

    #[account(
        mut,
        seeds = [b"vault", deal_id.to_le_bytes().as_ref()],
        bump = deal.vault_bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = deal.token_mint,
        token::authority = client
    )]
    pub client_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(address = deal.token_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, Deposit<'info>>, _deal_id: u64, milestone_idx: u8) -> Result<()> {
    let deal = &mut ctx.accounts.deal;

    require!(
        deal.status == DealStatus::Created || deal.status == DealStatus::Active,
        SignalEscrowError::DealFinalized
    );

    let idx = milestone_idx as usize;
    require!(idx < deal.milestones.len(), SignalEscrowError::InvalidMilestoneIndex);
    require!(
        deal.milestones[idx].status == MilestoneStatus::Pending,
        SignalEscrowError::AlreadyFunded
    );

    let amount = deal.milestones[idx].amount;
    let decimals = ctx.accounts.token_mint.decimals;

    // CPI: transfer tokens from client to vault (with transfer hook accounts)
    let mut ix = spl_token_2022::instruction::transfer_checked(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.client_token_account.key(),
        &ctx.accounts.token_mint.key(),
        &ctx.accounts.vault.key(),
        ctx.accounts.client.key,
        &[],
        amount,
        decimals,
    )?;
    for account in ctx.remaining_accounts.iter() {
        if account.is_writable {
            ix.accounts.push(AccountMeta::new(*account.key, account.is_signer));
        } else {
            ix.accounts.push(AccountMeta::new_readonly(*account.key, account.is_signer));
        }
    }
    let mut account_infos = vec![
        ctx.accounts.client_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.client.to_account_info(),
    ];
    account_infos.extend_from_slice(ctx.remaining_accounts);
    invoke_signed(&ix, &account_infos, &[])?;

    // Update state
    deal.milestones[idx].status = MilestoneStatus::Funded;
    deal.funded_amount = deal.funded_amount
        .checked_add(amount)
        .ok_or(SignalEscrowError::Overflow)?;

    if deal.status == DealStatus::Created {
        deal.status = DealStatus::Active;
    }

    emit!(MilestoneFunded {
        deal_id: deal.deal_id,
        milestone_idx,
        amount,
    });

    Ok(())
}
