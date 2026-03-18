use anchor_lang::prelude::*;

#[event]
pub struct DealCreated {
    pub deal_id: u64,
    pub client: Pubkey,
    pub provider: Pubkey,
    pub connector: Pubkey,
    pub total_amount: u64,
    pub milestone_count: u8,
}

#[event]
pub struct MilestoneFunded {
    pub deal_id: u64,
    pub milestone_idx: u8,
    pub amount: u64,
}

#[event]
pub struct MilestoneReleased {
    pub deal_id: u64,
    pub milestone_idx: u8,
    pub provider_amount: u64,
    pub connector_amount: u64,
    pub protocol_amount: u64,
}

#[event]
pub struct DealCompleted {
    pub deal_id: u64,
    pub provider: Pubkey,
    pub new_reputation: u64,
}

#[event]
pub struct DealDisputed {
    pub deal_id: u64,
    pub milestone_idx: u8,
    pub disputed_by: Pubkey,
}

#[event]
pub struct DisputeResolved {
    pub deal_id: u64,
    pub milestone_idx: u8,
    pub client_refund: u64,
    pub provider_amount: u64,
}

#[event]
pub struct DealRefunded {
    pub deal_id: u64,
    pub total_refunded: u64,
}
