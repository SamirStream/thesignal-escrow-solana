use anchor_lang::prelude::*;

#[error_code]
pub enum SignalEscrowError {
    #[msg("Only the deal client can perform this action")]
    Unauthorized,
    #[msg("Only the admin can perform this action")]
    AdminOnly,
    #[msg("Fee basis points must be <= 10000")]
    InvalidFeeBps,
    #[msg("Connector share basis points must be <= 10000")]
    InvalidConnectorShareBps,
    #[msg("At least one milestone is required")]
    NoMilestones,
    #[msg("Maximum 10 milestones allowed")]
    TooManyMilestones,
    #[msg("Milestone amount must be greater than 0")]
    ZeroMilestoneAmount,
    #[msg("Deal not found")]
    DealNotFound,
    #[msg("Invalid milestone index")]
    InvalidMilestoneIndex,
    #[msg("Milestone already funded")]
    AlreadyFunded,
    #[msg("Milestone not funded")]
    NotFunded,
    #[msg("Deal is not active")]
    DealNotActive,
    #[msg("Deal is not in disputed state")]
    DealNotDisputed,
    #[msg("Milestone is not in disputed state")]
    MilestoneNotDisputed,
    #[msg("Only client or provider can dispute")]
    DisputeUnauthorized,
    #[msg("Refund basis points must be <= 10000")]
    InvalidRefundBps,
    #[msg("Deal already completed or cancelled")]
    DealFinalized,
    #[msg("No milestones to refund")]
    NothingToRefund,
    #[msg("Arithmetic overflow")]
    Overflow,
}
