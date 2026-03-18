use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

/// Initialize the ExtraAccountMetaList for a token mint.
/// This tells Token-2022 which additional accounts to pass to our hook.
#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: ExtraAccountMetaList PDA — validated by seeds
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
    let extra_account_metas = vec![
        // Extra account 0: Sender's KYC status PDA
        // Derived from: ["kyc", source_token_account.owner]
        // source token account owner is at index 3 in the Execute instruction
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: b"kyc".to_vec(),
                },
                Seed::AccountKey { index: 3 }, // owner/authority (source owner)
            ],
            false, // is_signer
            false, // is_writable
        )
        .unwrap(),
        // Extra account 1: Receiver's KYC status PDA
        // Derived from: ["kyc", destination_token_account.owner]
        // We need to read the owner from the destination token account data
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: b"kyc".to_vec(),
                },
                Seed::AccountData {
                    account_index: 2, // destination token account
                    data_index: 32,   // owner field offset in token account layout
                    length: 32,       // pubkey is 32 bytes
                },
            ],
            false,
            false,
        )
        .unwrap(),
    ];

    // Calculate account size needed
    let account_size = ExtraAccountMetaList::size_of(extra_account_metas.len()).unwrap();
    let lamports = Rent::get()?.minimum_balance(account_size);

    let mint_key = ctx.accounts.mint.key();
    let signer_seeds: &[&[u8]] = &[
        b"extra-account-metas",
        mint_key.as_ref(),
        &[ctx.bumps.extra_account_meta_list],
    ];

    // Create the account
    system_program::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::CreateAccount {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.extra_account_meta_list.to_account_info(),
            },
            &[signer_seeds],
        ),
        lamports,
        account_size as u64,
        ctx.program_id,
    )?;

    // Initialize the extra account meta list
    let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_account_metas)?;

    Ok(())
}
