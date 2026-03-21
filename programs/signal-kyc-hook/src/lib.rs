use anchor_lang::prelude::*;
use spl_transfer_hook_interface::instruction::TransferHookInstruction;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("FNsAAZABER8g8QUdJsfhMLck3JzNRmBHomozRiiwCM2B");

#[program]
pub mod signal_kyc_hook {
    use super::*;

    /// Initialize the KYC admin config
    pub fn initialize_kyc_admin(ctx: Context<InitializeKycAdmin>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Initialize ExtraAccountMetaList for a token mint
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        instructions::init_extra_accounts::handler(ctx)
    }

    /// Transfer Hook — called by Token-2022 on every transfer_checked
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        instructions::transfer_hook::handler(ctx, amount)
    }

    /// Admin: Register or update KYC status for a wallet
    pub fn register_kyc(
        ctx: Context<RegisterKyc>,
        wallet: Pubkey,
        kyc_level: u8,
        country_code: [u8; 2],
        expires_at: i64,
    ) -> Result<()> {
        instructions::register_kyc::handler(ctx, wallet, kyc_level, country_code, expires_at)
    }

    /// Admin: Block an address (AML)
    pub fn block_address(ctx: Context<BlockAddress>, wallet: Pubkey) -> Result<()> {
        instructions::block_address::handler(ctx, wallet)
    }

    /// Admin: Record Travel Rule metadata for a deal
    pub fn record_travel_rule(
        ctx: Context<RecordTravelRule>,
        deal_id: u64,
        originator_name_hash: [u8; 32],
        beneficiary_name_hash: [u8; 32],
        originator_institution: [u8; 32],
    ) -> Result<()> {
        instructions::record_travel_rule::handler(
            ctx,
            deal_id,
            originator_name_hash,
            beneficiary_name_hash,
            originator_institution,
        )
    }

    /// Fallback for SPL Transfer Hook interface compatibility
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        let instruction = TransferHookInstruction::unpack(data)?;

        match instruction {
            TransferHookInstruction::Execute { amount } => {
                let amount_bytes = amount.to_le_bytes();
                __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
            }
            _ => Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}
