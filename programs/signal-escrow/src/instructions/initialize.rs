use anchor_lang::prelude::*;
use crate::state::EscrowConfig;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Protocol wallet receives fees
    pub protocol_wallet: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + EscrowConfig::INIT_SPACE,
        seeds = [b"escrow_config"],
        bump
    )]
    pub config: Account<'info, EscrowConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.protocol_wallet = ctx.accounts.protocol_wallet.key();
    config.deal_count = 0;
    config.bump = ctx.bumps.config;
    Ok(())
}
