use anchor_lang::prelude::*;
use crate::state::KycStatus;

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct BlockAddress<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"kyc", wallet.as_ref()],
        bump = kyc_status.bump
    )]
    pub kyc_status: Account<'info, KycStatus>,
}

pub fn handler(ctx: Context<BlockAddress>, _wallet: Pubkey) -> Result<()> {
    let kyc = &mut ctx.accounts.kyc_status;
    kyc.is_blocked = true;
    kyc.verified = false;

    msg!("Address blocked (AML): {}", kyc.wallet);

    Ok(())
}
