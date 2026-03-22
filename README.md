# The Signal Escrow — Institutional Stablecoin Escrow on Solana

> **StableHacks 2026** · Track 3: Programmable Stablecoin Payments · Built on Solana with Token-2022

**Live Demo**: https://thesignal-escrow.vercel.app · **Network**: Localnet (devnet deploy ready)

---

## What We Built

A production-grade **milestone escrow** for institutional stablecoin payments — where compliance is enforced at the token level, not the application layer.

Three parties collaborate on a deal: a **Client** who pays, a **Provider** who delivers, and a **Network BD** who sources the deal. When a milestone is approved, funds split atomically in a single transaction. KYC is checked automatically by the token itself on every transfer — no way to bypass it.

This is a working business model from [The Signal](https://thesignal.directory), to Solana with Token-2022 compliance features.

---

## The Problem

Institutional stablecoin payments have a compliance gap: KYC is enforced at the app layer, not the token layer. Any direct program interaction bypasses it entirely. Multi-party fee splits happen off-chain. Dispute resolution requires trusted intermediaries.

## Our Solution

### 1. Transfer Hook KYC — Compliance at the Token Level

vUSDC is a Token-2022 mint with a Transfer Hook extension pointing to our KYC program. On **every** `transfer_checked` call — whether from our escrow, a DEX, or a direct wallet transfer — Token-2022 automatically invokes our hook:

- Sender must have a valid, unexpired KYC record on-chain
- Receiver must have a valid, unexpired KYC record on-chain
- Neither party can be on the AML blocklist

If any check fails, the entire transfer reverts. This is enforced by the Solana runtime, not our UI.

### 2. Atomic 3-Way Split

One transaction. No intermediate steps. No trust required.

```
Milestone Released: 1,000 vUSDC | Platform Fee: 10% | BD Share: 40% of platform fee

  900 vUSDC → Provider     (90% of total — service payment)
   40 vUSDC → Network BD   (40% of the 10% platform fee — connector commission)
   60 vUSDC → Protocol     (60% of the 10% platform fee — platform cut)
```

### 3. On-Chain Reputation

Provider reputation increments only when all milestones in a deal are completed. Stored in an immutable PDA. Cannot be faked or transferred.

### 4. Travel Rule Compliance

On-chain hashed metadata for deals exceeding $3,000, referencing originator and beneficiary identity records — meeting FATF Travel Rule requirements.

---

## Demo Flow

> Connect Phantom wallet on **Localnet** (`http://localhost:8899`) or use the built-in social login (Privy).

**Step 1 — Get Test Tokens**
Navigate to **Compliance** → **Test Token Faucet** → click **Get 10,000 vUSDC**
- Airdrops 1 SOL (for tx fees)
- Mints 10,000 vUSDC to your wallet
- Registers your KYC on-chain automatically

**Step 2 — Create a Deal**
Navigate to **Deploy Contract** → fill in provider address, milestones, fee structure → **Review Payload** → **Deploy**

**Step 3 — Fund a Milestone**
In **Deal Terminal**, select your deal → click **Fund Escrow Node** on any milestone

**Step 4 — Release or Dispute**
- **Approve & Release** — triggers atomic 3-way split, KYC enforced on all 3 transfers
- **Flag Dispute** — puts milestone on hold for admin review
- **Admin resolves** dispute with "Accept & Release to Provider" or "Refund to Client"

**Step 5 — View Reputation**
Navigate to **Oracle** — provider's completed deal count is stored on-chain

---

## Try the AML Blocklist

In **Compliance** → **AML Blocklist Demo**:
1. Block any address
2. Try to release a milestone to that address
3. Watch the token-level KYC hook reject the transfer

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Frontend (React 19 + Vite)          │
│  Privy (social login) + Phantom/Solflare         │
│  Anchor Client + @solana/spl-token               │
└──────────────────────┬──────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
┌─────────────────┐       ┌──────────────────────┐
│  signal-escrow  │       │   signal-kyc-hook     │
│   (Anchor)      │       │   (Anchor)            │
│                 │       │                       │
│ initialize      │       │ transfer_hook         │
│ create_deal     │◄──────│   ↳ checks KYC PDAs  │
│ deposit         │ Token │ register_kyc          │
│ release_milestone│ 2022 │ block_address (AML)   │
│ dispute         │  CPI  │ travel_rule           │
│ resolve_dispute │       │                       │
│ refund          │       │ ExtraAccountMetaList  │
│                 │       │  → senderKyc PDA      │
│ PDAs:           │       │  → receiverKyc PDA    │
│  EscrowConfig   │       └──────────────────────┘
│  Deal           │
│  Vault (Token)  │
│  Reputation     │
└─────────────────┘
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contracts | Anchor 0.30.1 (Rust) on Solana |
| Token Standard | SPL Token-2022 with Transfer Hook extension |
| KYC Enforcement | Custom Transfer Hook program with ExtraAccountMeta |
| Frontend | React 19 + Vite + Tailwind CSS v4 |
| Auth / Wallets | Privy v3 (email/social) + Phantom / Solflare |
| Deployment | Vercel (frontend) · Solana localnet / devnet |

---

## Program IDs (Localnet)

| Program | Address |
|---------|---------|
| `signal-escrow` | `Cv9qz4mN9kXAoLgNXpiZ1kuzhgXvcZabYSbYjgLQSrWg` |
| `signal-kyc-hook` | `FNsAAZABER8g8QUdJsfhMLck3JzNRmBHomozRiiwCM2B` |
| `vUSDC Mint` | `BGjrVtVpSqYwRGNiJq3ARyN8q4T7EmAwMgL3YPfaYFqV` |

---

## Why Token-2022 Transfer Hook?

Standard SPL Token cannot enforce compliance at the transfer level. Any program can call `transfer` and bypass application-layer KYC checks.

Token-2022's Transfer Hook extension solves this: the mint itself specifies a hook program that **must** be invoked on every transfer. The Solana runtime enforces this — our KYC check runs before every single token movement, regardless of which program initiates it.

This is what makes institutional stablecoin payments possible on-chain: compliance that cannot be circumvented.

---

## Why vUSDC instead of USDC?

Real USDC on Solana uses the standard SPL Token program — it has no Transfer Hook support. To demonstrate KYC enforcement at the token level, we created vUSDC: a Token-2022 mint with the Transfer Hook extension set to our KYC program at creation time.

In production, this would use a Token-2022 stablecoin from a licensed issuer (EURC by Circle already uses Token-2022; USDC migration is planned).

---

## Compliance Feature Matrix

| Feature | Implementation |
|---------|---------------|
| KYC at transfer level | Transfer Hook checks sender + receiver KYC PDA on every `transfer_checked` |
| AML Blocklist | `is_blocked` flag on KycStatus, admin-controlled, instant enforcement |
| KYC expiry | Configurable expiry timestamp per wallet, transfers rejected if expired |
| Travel Rule | On-chain hashed PII records for deals ≥ $3,000 |
| Audit trail | Anchor events emitted on every state change (immutable) |
| Role-based auth | `client`, `admin` constraints enforced at instruction level |
| On-chain reputation | Completed deals counter on provider PDA, incremented atomically |

---

## Local Setup

### Prerequisites
- [Rust](https://rustup.rs/) (stable)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) 2.1+
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) 0.30.1
- Node.js 20+

### Run Locally

**Terminal 1 — Local validator**
```bash
solana-test-validator --reset
```

**Terminal 2 — Build, deploy, setup**
```bash
# Build programs
cargo build-sbf --manifest-path programs/signal-escrow/Cargo.toml
cargo build-sbf --manifest-path programs/signal-kyc-hook/Cargo.toml

solana config set --url localhost
anchor deploy

# Deploy vUSDC mint + initialize programs
ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npm run setup
```

**Terminal 3 — Frontend**
```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### Environment Variables (`frontend/.env`)

```env
VITE_ESCROW_PROGRAM_ID=Cv9qz4mN9kXAoLgNXpiZ1kuzhgXvcZabYSbYjgLQSrWg
VITE_KYC_HOOK_PROGRAM_ID=FNsAAZABER8g8QUdJsfhMLck3JzNRmBHomozRiiwCM2B
VITE_VUSDC_MINT=BGjrVtVpSqYwRGNiJq3ARyN8q4T7EmAwMgL3YPfaYFqV
VITE_SOLANA_RPC_URL=http://localhost:8899
VITE_SOLANA_NETWORK=localnet
VITE_PRIVY_APP_ID=your_privy_app_id
VITE_DEMO_ADMIN_KEYPAIR=base64_encoded_admin_keypair
```

---

## Project Structure

```
thesignal-escrow-solana/
├── programs/
│   ├── signal-escrow/          # Main escrow (7 instructions)
│   │   └── src/instructions/   # initialize, create_deal, deposit,
│   │                           # release_milestone, dispute,
│   │                           # resolve_dispute, refund
│   └── signal-kyc-hook/        # Transfer Hook KYC program
│       └── src/instructions/   # transfer_hook, register_kyc,
│                               # block_address, travel_rule
├── frontend/
│   └── src/
│       ├── components/         # KycVerification, CreateDeal,
│       │                       # DealDashboard, ReputationBadge
│       ├── hooks/              # useDealEscrow, useKycStatus,
│       │                       # useFaucet, usePrivySolanaWallet
│       └── lib/                # solana.ts (PDAs, constants)
├── tests/                      # Anchor integration tests
└── scripts/                    # Setup scripts
```

---

## Institutional Relevance

- **AMINA Bank / Sygnum** — Programmable KYC-enforced stablecoin rails with on-chain compliance
- **Solana Foundation** — Real-world Token-2022 Transfer Hook implementation for B2B payments
- **Fireblocks / Copper** — PDA-based vault mirrors institutional custody patterns
- **FATF Travel Rule** — On-chain hashed identity records for transactions above threshold

---

## Origin

The Signal is a production B2B network for professional services. The 3-party deal structure (client → provider → BD connector with milestone-based escrow and fee splits) is our live business model, originally built on Stellar/Soroban. This is a Solana port with institutional compliance layers added for StableHacks 2026.

## Team

**Leo** · **Samir** — The Signal founders

---

## License

MIT
