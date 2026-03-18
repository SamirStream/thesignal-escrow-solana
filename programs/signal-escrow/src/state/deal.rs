use anchor_lang::prelude::*;

pub const MAX_MILESTONES: usize = 10;

#[account]
#[derive(InitSpace)]
pub struct Deal {
    pub deal_id: u64,
    pub client: Pubkey,
    pub provider: Pubkey,
    pub connector: Pubkey,
    pub protocol_wallet: Pubkey,
    pub token_mint: Pubkey,
    pub vault: Pubkey,
    pub total_amount: u64,
    pub platform_fee_bps: u16,
    pub connector_share_bps: u16,
    pub status: DealStatus,
    pub funded_amount: u64,
    pub milestone_count: u8,
    pub bump: u8,
    pub vault_bump: u8,
    #[max_len(10)]
    pub milestones: Vec<Milestone>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum DealStatus {
    Created,
    Active,
    Completed,
    Cancelled,
    Disputed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct Milestone {
    pub amount: u64,
    pub status: MilestoneStatus,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MilestoneStatus {
    Pending,
    Funded,
    Released,
    Disputed,
    Refunded,
}
