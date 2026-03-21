# The Signal Escrow — Institutional Stablecoin Escrow on Solana

> **StableHacks 2026** | Track 3: Programmable Stablecoin Payments | Built on Solana with Token-2022

## Problem

Institutional stablecoin payments lack programmable compliance. Today, banks and service providers rely on manual KYC checks, off-chain escrow systems, and opaque fee structures. This creates:

- **Compliance gaps**: No enforcement at the token level — KYC is checked at the app layer and easily bypassed
- **Trust issues**: Multi-party deals (client → provider → BD connector) require trust or expensive legal escrow
- **Opacity**: Fee splits, milestone tracking, and dispute resolution happen off-chain with no verifiable audit trail

## Solution

The Signal Escrow is an **institutional-grade milestone escrow** with:

1. **Transfer Hook KYC** — Every token transfer is verified on-chain via a Token-2022 Transfer Hook. Both sender and receiver must have valid KYC before any stablecoin moves. Blocked addresses (AML) are rejected instantly.

2. **Atomic 3-Way Split** — When a milestone is released, funds are split in a single atomic transaction:
   - **Provider** receives the service payment
   - **Connector (BD)** receives their commission
   - **Protocol** receives the platform fee

3. **On-Chain Reputation** — Immutable counter that increments only when all milestones in a deal are completed. Cannot be faked.

4. **Travel Rule Compliance** — On-chain hashed metadata for deals exceeding $3,000, referencing originator and beneficiary identity records.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React 19)                    │
│  Wallet Adapter (Phantom/Solflare) → Anchor Client       │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
┌───────────────┐         ┌─────────────────┐
│ signal-escrow │         │ signal-kyc-hook  │
│   (Anchor)    │         │   (Anchor)       │
│               │         │                  │
│ • initialize  │         │ • transfer_hook  │
│ • create_deal │◄────────│   (Execute)      │
│ • deposit     │ Token-  │ • register_kyc   │
│ • release     │ 2022    │ • block_address  │
│ • dispute     │ CPI     │ • travel_rule    │
│ • resolve     │         │                  │
│ • refund      │         │ ExtraAccountMeta │
│               │         │ → sender KYC PDA │
│ PDAs:         │         │ → receiver KYC   │
│ • EscrowConfig│         └─────────────────┘
│ • Deal        │
│ • Vault       │
│ • Reputation  │
└───────────────┘
```

## Token-2022 Transfer Hook: How It Works

The KYC compliance is enforced at the **token level**, not the application level:

1. We create a **vUSDC mint** (Token-2022) with a Transfer Hook extension pointing to our KYC program
2. The KYC program declares **ExtraAccountMetaList** — telling Token-2022 to pass sender and receiver KYC PDAs to every transfer
3. On every `transfer_checked` call, Token-2022 **automatically invokes our hook** which verifies:
   - Sender is KYC verified and not expired
   - Receiver is KYC verified and not expired
   - Neither party is on the AML blocklist
4. If any check fails, the **entire transfer reverts** — the escrow deposit, release, or refund fails

This means compliance is **impossible to bypass** — even if someone interacts with the program directly, the token itself enforces KYC.

## Escrow Flow

```
Client creates deal → defines milestones, fee structure, participants
                    ↓
Client deposits (per milestone) → funds held in vault PDA
                    ↓
Client releases milestone → ATOMIC 3-WAY SPLIT:
  ├─ 90% → Provider (service payment)
  ├─  4% → Connector (BD commission)
  └─  6% → Protocol (platform fee)
                    ↓
All milestones released → Deal completed → Provider reputation++
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contracts | Anchor (Rust) on Solana |
| Token Standard | SPL Token-2022 (Token Extensions) |
| Compliance | Transfer Hook + KYC Registry PDAs |
| Frontend | React 19 + Vite + Tailwind v4 |
| Wallet | @solana/wallet-adapter (Phantom, Solflare) |
| Network | Solana Devnet |

## Deployed Program IDs

| Program | Address |
|---------|---------|
| `signal-escrow` | `DdfRLgw8YFB8ao4YaKpPfdorEPW1EhoE1gE3FYzdhNnu` |
| `signal-kyc-hook` | `5zyZimCxauJ4SsiAkB5PVBTevyLnznRfdoqJs1odjNSN` |

## Quick Start

### Prerequisites
- [Rust](https://rustup.rs/) (stable)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (2.1+)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) (0.30.1)
- Node.js 18+

### Build Programs

```bash
# Install dependencies
npm install

# Build both Solana programs (SBF target)
cargo build-sbf --manifest-path programs/signal-escrow/Cargo.toml
cargo build-sbf --manifest-path programs/signal-kyc-hook/Cargo.toml
```

> **Note**: `anchor build` IDL generation requires a specific Rust toolchain version.
> The IDL files in `frontend/src/idl/` are pre-generated and kept in sync manually.

### Deploy (Local Validator)

```bash
# Start local validator
solana-test-validator --reset --quiet &

# Configure CLI for localhost
solana config set --url http://localhost:8899

# Deploy both programs
solana program deploy target/deploy/signal_escrow.so --program-id target/deploy/signal_escrow-keypair.json
solana program deploy target/deploy/signal_kyc_hook.so --program-id target/deploy/signal_kyc_hook-keypair.json

# Run setup script (creates vUSDC mint, KYC records, demo data)
npm run setup
```

### Frontend

```bash
cd frontend
npm install

# Configure environment (defaults point to localhost:8899)
cp .env.example .env

# Start dev server
npm run dev
```

## Project Structure

```
signal-escrow/
├── programs/
│   ├── signal-escrow/          # Main escrow program (7 instructions)
│   │   └── src/
│   │       ├── instructions/   # initialize, create_deal, deposit, release, dispute, resolve, refund
│   │       ├── state/          # EscrowConfig, Deal, Milestone, Reputation
│   │       ├── errors.rs
│   │       └── events.rs
│   └── signal-kyc-hook/        # Transfer Hook KYC program
│       └── src/
│           ├── instructions/   # transfer_hook, register_kyc, block_address, travel_rule
│           └── state/          # KycStatus, TravelRuleRecord
├── frontend/                   # React SPA
│   └── src/
│       ├── components/         # KycVerification, CreateDeal, DealDashboard, etc.
│       ├── hooks/              # useSolanaWallet, useDealEscrow, useKycStatus
│       └── lib/                # solana.ts, dealMetadata.ts
├── tests/                      # Anchor integration tests
├── scripts/                    # Devnet setup & demo data
└── docs/                       # Architecture & compliance docs
```

## Compliance Features

| Feature | Implementation | Status |
|---------|---------------|--------|
| **KYC Verification** | Transfer Hook checks on-chain KYC PDA for every transfer | Implemented |
| **AML Blocklist** | `is_blocked` field on KycStatus, admin-controlled | Implemented |
| **Travel Rule** | On-chain hashed PII records for deals >= $3,000 | Implemented |
| **KYT (Transaction Monitoring)** | Anchor events emitted on every state change | Implemented |
| **Permissioned Access** | Auth checks on every instruction (client, admin roles) | Implemented |
| **Audit Trail** | Immutable on-chain events + local metadata store | Implemented |

## Institutional Fit

- **AMINA Bank**: Compliant stablecoin payment rails with programmable KYC enforcement
- **Solana Foundation**: Showcases Token-2022 Transfer Hooks for institutional use
- **Fireblocks**: PDA-based vault architecture mirrors institutional custody patterns
- **UBS/Keyrock**: Enterprise-grade compliance with on-chain audit trails

## Origin

This project is a port of [The Signal](https://thesignal.directory)'s production escrow system, originally built on Stellar/Soroban, to Solana with institutional compliance features for StableHacks 2026. The 3-party fee split and milestone-based escrow are a working business model, not a hackathon concept.

## Team

- **Samir** — Full-stack developer, The Signal founder
- Built with Anchor, Token-2022, and React

## License

MIT
ok