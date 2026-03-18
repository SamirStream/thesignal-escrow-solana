use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct KycStatus {
    /// The wallet this KYC applies to
    pub wallet: Pubkey,
    /// Whether KYC is verified
    pub verified: bool,
    /// KYC level: 0=none, 1=basic, 2=enhanced, 3=institutional
    pub kyc_level: u8,
    /// ISO 3166-1 alpha-2 country code (e.g., b"US", b"CH")
    pub country_code: [u8; 2],
    /// Unix timestamp when KYC was verified
    pub verified_at: i64,
    /// Unix timestamp when KYC expires
    pub expires_at: i64,
    /// Whether address is on AML blocklist
    pub is_blocked: bool,
    /// PDA bump
    pub bump: u8,
}
