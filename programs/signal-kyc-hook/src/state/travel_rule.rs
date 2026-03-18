use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct TravelRuleRecord {
    /// Deal ID this record belongs to
    pub deal_id: u64,
    /// SHA-256 hash of originator name (actual PII stored off-chain)
    pub originator_name_hash: [u8; 32],
    /// SHA-256 hash of beneficiary name
    pub beneficiary_name_hash: [u8; 32],
    /// SHA-256 hash of originator institution (BIC/LEI)
    pub originator_institution: [u8; 32],
    /// Whether amount exceeds Travel Rule threshold ($3000)
    pub amount_threshold_met: bool,
    /// Unix timestamp of record creation
    pub created_at: i64,
    /// PDA bump
    pub bump: u8,
}
