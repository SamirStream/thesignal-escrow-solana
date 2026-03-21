use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("Cv9qz4mN9kXAoLgNXpiZ1kuzhgXvcZabYSbYjgLQSrWg");

#[program]
pub mod signal_escrow {
    use super::*;

    /// Initialize the escrow protocol with admin and protocol wallet
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Create a new deal with milestones, specifying provider, connector, and fee structure
    pub fn create_deal(
        ctx: Context<CreateDeal>,
        platform_fee_bps: u16,
        connector_share_bps: u16,
        milestone_amounts: Vec<u64>,
    ) -> Result<()> {
        instructions::create_deal::handler(ctx, platform_fee_bps, connector_share_bps, milestone_amounts)
    }

    /// Client deposits funds for a specific milestone
    pub fn deposit(ctx: Context<Deposit>, deal_id: u64, milestone_idx: u8) -> Result<()> {
        instructions::deposit::handler(ctx, deal_id, milestone_idx)
    }

    /// Client releases a funded milestone — atomic 3-way split to provider, connector, protocol
    pub fn release_milestone(
        ctx: Context<ReleaseMilestone>,
        deal_id: u64,
        milestone_idx: u8,
    ) -> Result<()> {
        instructions::release::handler(ctx, deal_id, milestone_idx)
    }

    /// Client or provider disputes a funded milestone
    pub fn dispute(ctx: Context<Dispute>, deal_id: u64, milestone_idx: u8) -> Result<()> {
        instructions::dispute::handler(ctx, deal_id, milestone_idx)
    }

    /// Admin resolves a dispute, splitting funds between client and provider
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        deal_id: u64,
        milestone_idx: u8,
        refund_bps: u16,
    ) -> Result<()> {
        instructions::resolve::handler(ctx, deal_id, milestone_idx, refund_bps)
    }

    /// Admin refunds all funded/disputed milestones back to client
    pub fn refund(ctx: Context<Refund>, deal_id: u64) -> Result<()> {
        instructions::refund::handler(ctx, deal_id)
    }
}
