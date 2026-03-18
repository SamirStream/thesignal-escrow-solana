# Compliance Architecture

## Overview

The Signal Escrow implements compliance at the **token infrastructure level** using Solana Token-2022 Transfer Hooks. This means compliance is enforced by the blockchain itself, not by application-layer middleware.

## KYC (Know Your Customer)

### On-Chain KYC Registry

Every wallet that interacts with vUSDC must have a `KycStatus` PDA:

- **Seeds**: `["kyc", wallet_pubkey]`
- **Fields**: `verified`, `kyc_level` (0-3), `country_code`, `verified_at`, `expires_at`, `is_blocked`

### KYC Levels

| Level | Name | Requirements | Use Case |
|-------|------|-------------|----------|
| 0 | None | — | Cannot transact |
| 1 | Basic | Email + Phone verification | Small transactions |
| 2 | Enhanced | Government ID + Address proof | Standard institutional |
| 3 | Institutional | Full due diligence, LEI/BIC | Large institutional deals |

### Enforcement via Transfer Hook

The `signal-kyc-hook` program is registered as the Transfer Hook for the vUSDC mint. On every `transfer_checked` call:

1. Token-2022 resolves the sender's KYC PDA from `ExtraAccountMetaList`
2. Token-2022 resolves the receiver's KYC PDA from the destination token account owner
3. Our hook program checks: `verified == true && !is_blocked && expires_at > now`
4. If any check fails → entire transfer reverts (including the escrow operation)

## KYT (Know Your Transaction)

All state changes emit Anchor events:

- `DealCreated` — deal_id, client, provider, connector, total_amount
- `MilestoneFunded` — deal_id, milestone_idx, amount
- `MilestoneReleased` — deal_id, milestone_idx, provider_amount, connector_amount, protocol_amount
- `DealCompleted` — deal_id, provider, new_reputation
- `DealDisputed` — deal_id, milestone_idx, disputed_by
- `DisputeResolved` — deal_id, milestone_idx, client_refund, provider_amount
- `DealRefunded` — deal_id, total_refunded

These events can be indexed by any Solana event listener for real-time transaction monitoring.

## AML (Anti-Money Laundering)

### Blocklist

Admin can call `block_address(wallet)` to set `is_blocked = true` on a wallet's KYC PDA. Once blocked:

- All transfers from/to this address will fail at the Transfer Hook level
- The block is immediate and cannot be circumvented
- Unblocking requires admin action

### Sanctions Screening

In production, the admin would integrate with OFAC, EU sanctions lists, and other compliance databases. The on-chain `block_address` instruction provides the enforcement mechanism.

## Travel Rule

### FATF Travel Rule Requirements

For transactions >= $3,000, VASPs must exchange:
- Originator name and account number
- Beneficiary name and account number
- Originator institution identifier (BIC/LEI)

### On-Chain Implementation

`TravelRuleRecord` PDA stores **hashed** PII:
- `originator_name_hash` — SHA-256 of originator full name
- `beneficiary_name_hash` — SHA-256 of beneficiary full name
- `originator_institution` — SHA-256 of institution BIC/LEI
- `amount_threshold_met` — boolean flag

Actual PII is stored off-chain in a compliant database. The on-chain hash provides:
- **Auditability** — regulators can verify the hash matches submitted PII
- **Privacy** — personal data is not stored on a public blockchain
- **Immutability** — once recorded, the hash cannot be altered

## Regulatory Alignment

| Regulation | How We Address It |
|-----------|------------------|
| FINMA (Switzerland) | KYC levels align with Swiss CDD requirements |
| MiCA (EU) | Transfer Hook enforcement for all stablecoin transfers |
| FATF Travel Rule | On-chain hashed metadata for transactions >= $3,000 |
| OFAC Sanctions | AML blocklist with immediate transfer blocking |
| GDPR | PII stored off-chain, only hashes on-chain |
