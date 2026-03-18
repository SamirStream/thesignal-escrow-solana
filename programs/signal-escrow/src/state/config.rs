use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct EscrowConfig {
    pub admin: Pubkey,
    pub protocol_wallet: Pubkey,
    pub deal_count: u64,
    pub bump: u8,
}
