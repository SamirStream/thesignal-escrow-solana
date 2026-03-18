# Architecture

## Programs

### signal-escrow (Main Escrow)

**7 instructions** managing the full deal lifecycle:

1. `initialize` — One-time setup: admin + protocol wallet
2. `create_deal` — Client creates deal with milestones and fee structure
3. `deposit` — Client funds a milestone (CPI transfer_checked to vault)
4. `release_milestone` — Client triggers atomic 3-way split
5. `dispute` — Client or provider freezes a milestone
6. `resolve_dispute` — Admin splits disputed funds
7. `refund` — Admin returns all funded milestones to client

### signal-kyc-hook (Transfer Hook)

**6 instructions** for compliance enforcement:

1. `initialize_extra_account_meta_list` — Configure hook accounts for a mint
2. `transfer_hook` — Execute handler (called by Token-2022 automatically)
3. `fallback` — SPL interface compatibility
4. `register_kyc` — Admin registers wallet KYC status
5. `block_address` — Admin blocklists a wallet (AML)
6. `record_travel_rule` — Admin stores hashed Travel Rule metadata

## PDA Scheme

| Account | Seeds | Program |
|---------|-------|---------|
| EscrowConfig | `["escrow_config"]` | signal-escrow |
| Deal | `["deal", deal_id (u64 LE)]` | signal-escrow |
| Vault | `["vault", deal_id (u64 LE)]` | signal-escrow |
| Reputation | `["reputation", provider_pubkey]` | signal-escrow |
| KycStatus | `["kyc", wallet_pubkey]` | signal-kyc-hook |
| TravelRuleRecord | `["travel_rule", deal_id (u64 LE)]` | signal-kyc-hook |
| ExtraAccountMetaList | `["extra-account-metas", mint_pubkey]` | signal-kyc-hook |

## Fee Calculation

```
Given: amount, platform_fee_bps, connector_share_bps

platform_fee  = amount × platform_fee_bps / 10000
connector_cut = platform_fee × connector_share_bps / 10000
protocol_cut  = platform_fee - connector_cut
provider_cut  = amount - platform_fee
```

Example (10% fee, 40% connector share):
- 3,000 USDC milestone
- Provider: 2,700 USDC (90%)
- Connector: 120 USDC (4%)
- Protocol: 180 USDC (6%)

## Security

- All arithmetic uses checked operations (no overflow)
- Auth constraints on every instruction (client, admin, caller)
- PDAs prevent account spoofing
- Vault authority is the Deal PDA (only program can sign transfers)
- Transfer Hook makes KYC bypass impossible at the token level
