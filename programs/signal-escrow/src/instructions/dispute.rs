use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::SignalEscrowError;
use crate::events::DealDisputed;

#[derive(Accounts)]
#[instruction(deal_id: u64, milestone_idx: u8)]
pub struct Dispute<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deal", deal_id.to_le_bytes().as_ref()],
        bump = deal.bump,
        constraint = deal.status == DealStatus::Active @ SignalEscrowError::DealNotActive
    )]
    pub deal: Account<'info, Deal>,
}

pub fn handler(ctx: Context<Dispute>, _deal_id: u64, milestone_idx: u8) -> Result<()> {
    let deal = &mut ctx.accounts.deal;
    let caller = ctx.accounts.caller.key();

    // Only client or provider can dispute
    require!(
        caller == deal.client || caller == deal.provider,
        SignalEscrowError::DisputeUnauthorized
    );

    let idx = milestone_idx as usize;
    require!(idx < deal.milestones.len(), SignalEscrowError::InvalidMilestoneIndex);
    require!(
        deal.milestones[idx].status == MilestoneStatus::Funded,
        SignalEscrowError::NotFunded
    );

    deal.milestones[idx].status = MilestoneStatus::Disputed;
    deal.status = DealStatus::Disputed;

    emit!(DealDisputed {
        deal_id: deal.deal_id,
        milestone_idx,
        disputed_by: caller,
    });

    Ok(())
}
