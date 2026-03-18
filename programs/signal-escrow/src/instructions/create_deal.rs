use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::*;
use crate::errors::SignalEscrowError;
use crate::events::DealCreated;

#[derive(Accounts)]
pub struct CreateDeal<'info> {
    #[account(mut)]
    pub client: Signer<'info>,

    /// CHECK: The service provider
    pub provider: UncheckedAccount<'info>,

    /// CHECK: The BD connector receiving commission
    pub connector: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"escrow_config"],
        bump = config.bump
    )]
    pub config: Account<'info, EscrowConfig>,

    #[account(
        init,
        payer = client,
        space = 8 + Deal::INIT_SPACE,
        seeds = [b"deal", config.deal_count.to_le_bytes().as_ref()],
        bump
    )]
    pub deal: Account<'info, Deal>,

    #[account(
        init,
        payer = client,
        token::mint = token_mint,
        token::authority = deal,
        token::token_program = token_program,
        seeds = [b"vault", config.deal_count.to_le_bytes().as_ref()],
        bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateDeal>,
    platform_fee_bps: u16,
    connector_share_bps: u16,
    milestone_amounts: Vec<u64>,
) -> Result<()> {
    require!(platform_fee_bps <= 10000, SignalEscrowError::InvalidFeeBps);
    require!(connector_share_bps <= 10000, SignalEscrowError::InvalidConnectorShareBps);
    require!(!milestone_amounts.is_empty(), SignalEscrowError::NoMilestones);
    require!(milestone_amounts.len() <= MAX_MILESTONES, SignalEscrowError::TooManyMilestones);

    let total_amount: u64 = milestone_amounts
        .iter()
        .try_fold(0u64, |acc, &amt| {
            require!(amt > 0, SignalEscrowError::ZeroMilestoneAmount);
            acc.checked_add(amt).ok_or(SignalEscrowError::Overflow.into())
        })?;

    let milestones: Vec<Milestone> = milestone_amounts
        .iter()
        .map(|&amount| Milestone {
            amount,
            status: MilestoneStatus::Pending,
        })
        .collect();

    let config = &mut ctx.accounts.config;
    let deal_id = config.deal_count;

    let deal = &mut ctx.accounts.deal;
    deal.deal_id = deal_id;
    deal.client = ctx.accounts.client.key();
    deal.provider = ctx.accounts.provider.key();
    deal.connector = ctx.accounts.connector.key();
    deal.protocol_wallet = config.protocol_wallet;
    deal.token_mint = ctx.accounts.token_mint.key();
    deal.vault = ctx.accounts.vault.key();
    deal.total_amount = total_amount;
    deal.platform_fee_bps = platform_fee_bps;
    deal.connector_share_bps = connector_share_bps;
    deal.status = DealStatus::Created;
    deal.funded_amount = 0;
    deal.milestone_count = milestones.len() as u8;
    deal.bump = ctx.bumps.deal;
    deal.vault_bump = ctx.bumps.vault;
    deal.milestones = milestones;

    config.deal_count = config.deal_count.checked_add(1).unwrap();

    emit!(DealCreated {
        deal_id,
        client: deal.client,
        provider: deal.provider,
        connector: deal.connector,
        total_amount,
        milestone_count: deal.milestone_count,
    });

    Ok(())
}
