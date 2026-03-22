use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::*;
use crate::errors::SignalEscrowError;
use crate::events::{MilestoneReleased, DealCompleted};

#[derive(Accounts)]
#[instruction(deal_id: u64, milestone_idx: u8)]
pub struct ReleaseMilestone<'info> {
    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deal", deal_id.to_le_bytes().as_ref()],
        bump = deal.bump,
        constraint = deal.client == client.key() @ SignalEscrowError::Unauthorized,
        constraint = deal.status == DealStatus::Active @ SignalEscrowError::DealNotActive
    )]
    pub deal: Box<Account<'info, Deal>>,

    #[account(
        mut,
        seeds = [b"vault", deal_id.to_le_bytes().as_ref()],
        bump = deal.vault_bump
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Provider's token account to receive payment
    #[account(mut, token::mint = deal.token_mint)]
    pub provider_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Connector's token account to receive commission
    #[account(mut, token::mint = deal.token_mint)]
    pub connector_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Protocol wallet's token account to receive fees
    #[account(mut, token::mint = deal.token_mint)]
    pub protocol_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = deal.token_mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,

    /// Reputation PDA — init_if_needed for first completed deal
    #[account(
        init_if_needed,
        payer = client,
        space = 8 + Reputation::INIT_SPACE,
        seeds = [b"reputation", deal.provider.as_ref()],
        bump
    )]
    pub reputation: Account<'info, Reputation>,

    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, ReleaseMilestone<'info>>, deal_id: u64, milestone_idx: u8) -> Result<()> {
    let deal = &mut ctx.accounts.deal;
    let idx = milestone_idx as usize;

    require!(idx < deal.milestones.len(), SignalEscrowError::InvalidMilestoneIndex);
    require!(
        deal.milestones[idx].status == MilestoneStatus::Funded,
        SignalEscrowError::NotFunded
    );

    let amount = deal.milestones[idx].amount;
    let decimals = ctx.accounts.token_mint.decimals;

    // Calculate 3-way split
    let platform_fee = amount
        .checked_mul(deal.platform_fee_bps as u64)
        .and_then(|v| v.checked_div(10000))
        .ok_or(SignalEscrowError::Overflow)?;

    let connector_cut = platform_fee
        .checked_mul(deal.connector_share_bps as u64)
        .and_then(|v| v.checked_div(10000))
        .ok_or(SignalEscrowError::Overflow)?;

    let protocol_cut = platform_fee
        .checked_sub(connector_cut)
        .ok_or(SignalEscrowError::Overflow)?;

    let provider_cut = amount
        .checked_sub(platform_fee)
        .ok_or(SignalEscrowError::Overflow)?;

    // PDA signer seeds for the deal (vault authority)
    let deal_id_bytes = deal_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[b"deal", deal_id_bytes.as_ref(), &[deal.bump]]];

    let tp_key = ctx.accounts.token_program.key();
    let vault_key = ctx.accounts.vault.key();
    let mint_key = ctx.accounts.token_mint.key();
    let deal_key = deal.key();

    // CPI 1: Transfer to provider
    if provider_cut > 0 {
        let to_key = ctx.accounts.provider_token_account.key();
        let mut ix = spl_token_2022::instruction::transfer_checked(
            &tp_key, &vault_key, &mint_key, &to_key, &deal_key, &[], provider_cut, decimals,
        )?;
        for account in ctx.remaining_accounts.iter() {
            if account.is_writable { ix.accounts.push(AccountMeta::new(*account.key, account.is_signer)); }
            else { ix.accounts.push(AccountMeta::new_readonly(*account.key, account.is_signer)); }
        }
        let mut ai = vec![ctx.accounts.vault.to_account_info(), ctx.accounts.token_mint.to_account_info(), ctx.accounts.provider_token_account.to_account_info(), deal.to_account_info()];
        ai.extend_from_slice(ctx.remaining_accounts);
        invoke_signed(&ix, &ai, signer_seeds)?;
    }

    // CPI 2: Transfer to connector (BD commission)
    if connector_cut > 0 {
        let to_key = ctx.accounts.connector_token_account.key();
        let mut ix = spl_token_2022::instruction::transfer_checked(
            &tp_key, &vault_key, &mint_key, &to_key, &deal_key, &[], connector_cut, decimals,
        )?;
        for account in ctx.remaining_accounts.iter() {
            if account.is_writable { ix.accounts.push(AccountMeta::new(*account.key, account.is_signer)); }
            else { ix.accounts.push(AccountMeta::new_readonly(*account.key, account.is_signer)); }
        }
        let mut ai = vec![ctx.accounts.vault.to_account_info(), ctx.accounts.token_mint.to_account_info(), ctx.accounts.connector_token_account.to_account_info(), deal.to_account_info()];
        ai.extend_from_slice(ctx.remaining_accounts);
        invoke_signed(&ix, &ai, signer_seeds)?;
    }

    // CPI 3: Transfer to protocol wallet
    if protocol_cut > 0 {
        let to_key = ctx.accounts.protocol_token_account.key();
        let mut ix = spl_token_2022::instruction::transfer_checked(
            &tp_key, &vault_key, &mint_key, &to_key, &deal_key, &[], protocol_cut, decimals,
        )?;
        for account in ctx.remaining_accounts.iter() {
            if account.is_writable { ix.accounts.push(AccountMeta::new(*account.key, account.is_signer)); }
            else { ix.accounts.push(AccountMeta::new_readonly(*account.key, account.is_signer)); }
        }
        let mut ai = vec![ctx.accounts.vault.to_account_info(), ctx.accounts.token_mint.to_account_info(), ctx.accounts.protocol_token_account.to_account_info(), deal.to_account_info()];
        ai.extend_from_slice(ctx.remaining_accounts);
        invoke_signed(&ix, &ai, signer_seeds)?;
    }

    // Update milestone state
    deal.milestones[idx].status = MilestoneStatus::Released;

    emit!(MilestoneReleased {
        deal_id: deal.deal_id,
        milestone_idx,
        provider_amount: provider_cut,
        connector_amount: connector_cut,
        protocol_amount: protocol_cut,
    });

    // Check if all milestones are released -> deal completed
    let all_released = deal.milestones.iter().all(|m| m.status == MilestoneStatus::Released);
    if all_released {
        deal.status = DealStatus::Completed;

        let reputation = &mut ctx.accounts.reputation;
        if reputation.provider == Pubkey::default() {
            reputation.provider = deal.provider;
            reputation.bump = ctx.bumps.reputation;
        }
        reputation.completed_deals = reputation.completed_deals
            .checked_add(1)
            .ok_or(SignalEscrowError::Overflow)?;

        emit!(DealCompleted {
            deal_id: deal.deal_id,
            provider: deal.provider,
            new_reputation: reputation.completed_deals,
        });
    }

    Ok(())
}
