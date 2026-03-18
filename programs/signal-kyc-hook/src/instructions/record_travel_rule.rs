use anchor_lang::prelude::*;
use crate::state::TravelRuleRecord;

#[derive(Accounts)]
#[instruction(deal_id: u64)]
pub struct RecordTravelRule<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + TravelRuleRecord::INIT_SPACE,
        seeds = [b"travel_rule", deal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub travel_rule: Account<'info, TravelRuleRecord>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RecordTravelRule>,
    deal_id: u64,
    originator_name_hash: [u8; 32],
    beneficiary_name_hash: [u8; 32],
    originator_institution: [u8; 32],
) -> Result<()> {
    let record = &mut ctx.accounts.travel_rule;
    let clock = Clock::get()?;

    record.deal_id = deal_id;
    record.originator_name_hash = originator_name_hash;
    record.beneficiary_name_hash = beneficiary_name_hash;
    record.originator_institution = originator_institution;
    record.amount_threshold_met = true;
    record.created_at = clock.unix_timestamp;
    record.bump = ctx.bumps.travel_rule;

    msg!("Travel Rule record created for deal {}", deal_id);

    Ok(())
}
