use anchor_lang::prelude::*;
use crate::state::KycStatus;

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct RegisterKyc<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + KycStatus::INIT_SPACE,
        seeds = [b"kyc", wallet.as_ref()],
        bump
    )]
    pub kyc_status: Account<'info, KycStatus>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterKyc>,
    wallet: Pubkey,
    kyc_level: u8,
    country_code: [u8; 2],
    expires_at: i64,
) -> Result<()> {
    let kyc = &mut ctx.accounts.kyc_status;
    let clock = Clock::get()?;

    kyc.wallet = wallet;
    kyc.verified = true;
    kyc.kyc_level = kyc_level;
    kyc.country_code = country_code;
    kyc.verified_at = clock.unix_timestamp;
    kyc.expires_at = expires_at;
    kyc.is_blocked = false;
    kyc.bump = ctx.bumps.kyc_status;

    msg!(
        "KYC registered: wallet={}, level={}, country={}{}",
        wallet,
        kyc_level,
        country_code[0] as char,
        country_code[1] as char,
    );

    Ok(())
}
