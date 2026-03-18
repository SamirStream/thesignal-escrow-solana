use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Reputation {
    pub provider: Pubkey,
    pub completed_deals: u64,
    pub bump: u8,
}
