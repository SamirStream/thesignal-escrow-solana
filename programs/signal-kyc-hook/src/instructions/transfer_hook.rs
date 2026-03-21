use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;
use crate::state::KycStatus;
use crate::errors::KycHookError;

/// The Transfer Hook Execute handler.
/// Called automatically by Token-2022 on every transfer_checked.
/// Verifies that both sender and receiver have valid KYC.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// Source token account
    #[account()]
    pub source_token: InterfaceAccount<'info, TokenAccount>,

    /// Token mint
    /// CHECK: Verified by Token-2022 program
    pub mint: UncheckedAccount<'info>,

    /// Destination token account
    #[account()]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// Source token account owner/authority
    /// CHECK: Verified by Token-2022 program
    pub owner: UncheckedAccount<'info>,

    /// CHECK: ExtraAccountMetaList PDA
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// Sender's KYC status PDA (extra account 0)
    #[account(
        seeds = [b"kyc", owner.key().as_ref()],
        bump = sender_kyc.bump
    )]
    pub sender_kyc: Account<'info, KycStatus>,

    /// Receiver's KYC status PDA (extra account 1)
    #[account(
        seeds = [b"kyc", destination_token.owner.as_ref()],
        bump = receiver_kyc.bump
    )]
    pub receiver_kyc: Account<'info, KycStatus>,
}

pub fn handler(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
    let sender_kyc = &ctx.accounts.sender_kyc;
    let receiver_kyc = &ctx.accounts.receiver_kyc;
    let clock = Clock::get()?;

    // Verify sender KYC
    require!(sender_kyc.verified, KycHookError::SenderKycNotVerified);
    require!(!sender_kyc.is_blocked, KycHookError::SenderBlocked);
    require!(
        sender_kyc.expires_at > clock.unix_timestamp,
        KycHookError::SenderKycExpired
    );

    // Verify receiver KYC
    require!(receiver_kyc.verified, KycHookError::ReceiverKycNotVerified);
    require!(!receiver_kyc.is_blocked, KycHookError::ReceiverBlocked);
    require!(
        receiver_kyc.expires_at > clock.unix_timestamp,
        KycHookError::ReceiverKycExpired
    );

    msg!(
        "KYC verified: sender_level={}, receiver_level={}, amount={}",
        sender_kyc.kyc_level,
        receiver_kyc.kyc_level,
        _amount
    );

    Ok(())
}
