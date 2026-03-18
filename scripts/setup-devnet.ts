/**
 * Setup script for The Signal Escrow on Solana Devnet
 *
 * This script:
 * 1. Creates a Token-2022 mint (vUSDC) with Transfer Hook extension
 * 2. Initializes the ExtraAccountMetaList for KYC hook
 * 3. Airdrops SOL and mints vUSDC to demo wallets
 * 4. Registers KYC for demo wallets
 * 5. Initializes the EscrowConfig
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const DECIMALS = 6;
const DEMO_MINT_AMOUNT = 100_000 * 10 ** DECIMALS; // 100,000 vUSDC per wallet

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const escrowProgram = anchor.workspace.SignalEscrow;
  const kycProgram = anchor.workspace.SignalKycHook;

  const admin = provider.wallet as anchor.Wallet;
  console.log("Admin:", admin.publicKey.toBase58());

  // --- Step 1: Create Token-2022 Mint with Transfer Hook ---
  console.log("\n--- Creating vUSDC Mint with Transfer Hook ---");

  const mintKeypair = Keypair.generate();
  const extensions = [ExtensionType.TransferHook];
  const mintLen = getMintLen(extensions);
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferHookInstruction(
      mintKeypair.publicKey,
      admin.publicKey,
      kycProgram.programId,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      DECIMALS,
      admin.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(provider.connection, createMintTx, [
    (admin as any).payer,
    mintKeypair,
  ]);

  console.log("vUSDC Mint:", mintKeypair.publicKey.toBase58());

  // --- Step 2: Initialize ExtraAccountMetaList ---
  console.log("\n--- Initializing ExtraAccountMetaList ---");

  const [extraAccountMetaListPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mintKeypair.publicKey.toBuffer()],
    kycProgram.programId
  );

  await kycProgram.methods
    .initializeExtraAccountMetaList()
    .accounts({
      payer: admin.publicKey,
      extraAccountMetaList: extraAccountMetaListPDA,
      mint: mintKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("ExtraAccountMetaList:", extraAccountMetaListPDA.toBase58());

  // --- Step 3: Demo wallets ---
  console.log("\n--- Setting up demo wallets ---");

  const demoWallets = {
    provider: Keypair.generate(),
    connector: Keypair.generate(),
    protocol: Keypair.generate(),
  };

  // Airdrop SOL
  for (const [name, kp] of Object.entries(demoWallets)) {
    const sig = await provider.connection.requestAirdrop(
      kp.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
    console.log(`  ${name}: ${kp.publicKey.toBase58()} (2 SOL airdropped)`);
  }

  // Create token accounts and mint vUSDC
  const adminTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    (admin as any).payer,
    mintKeypair.publicKey,
    admin.publicKey,
    false,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  // Mint to admin first, then distribute
  await mintTo(
    provider.connection,
    (admin as any).payer,
    mintKeypair.publicKey,
    adminTokenAccount.address,
    admin.publicKey,
    DEMO_MINT_AMOUNT * 5,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("  Minted 500,000 vUSDC to admin");

  // --- Step 4: Register KYC for all wallets ---
  console.log("\n--- Registering KYC ---");

  const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

  const walletsToKyc = [
    { name: "admin", pubkey: admin.publicKey, level: 3, country: "CH" },
    { name: "provider", pubkey: demoWallets.provider.publicKey, level: 2, country: "US" },
    { name: "connector", pubkey: demoWallets.connector.publicKey, level: 2, country: "DE" },
    { name: "protocol", pubkey: demoWallets.protocol.publicKey, level: 3, country: "CH" },
  ];

  for (const w of walletsToKyc) {
    const [kycPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("kyc"), w.pubkey.toBuffer()],
      kycProgram.programId
    );

    await kycProgram.methods
      .registerKyc(
        w.pubkey,
        w.level,
        Buffer.from(w.country),
        new anchor.BN(oneYearFromNow)
      )
      .accounts({
        admin: admin.publicKey,
        kycStatus: kycPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`  ${w.name} KYC registered (level ${w.level}, ${w.country})`);
  }

  // --- Step 5: Initialize Escrow Config ---
  console.log("\n--- Initializing Escrow Config ---");

  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow_config")],
    escrowProgram.programId
  );

  await escrowProgram.methods
    .initialize()
    .accounts({
      admin: admin.publicKey,
      protocolWallet: demoWallets.protocol.publicKey,
      config: configPDA,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("EscrowConfig:", configPDA.toBase58());

  // --- Summary ---
  console.log("\n=== SETUP COMPLETE ===");
  console.log(`vUSDC Mint:    ${mintKeypair.publicKey.toBase58()}`);
  console.log(`Escrow Config: ${configPDA.toBase58()}`);
  console.log(`KYC Hook:      ${kycProgram.programId.toBase58()}`);
  console.log(`Escrow:        ${escrowProgram.programId.toBase58()}`);
  console.log("\nDemo wallets:");
  for (const [name, kp] of Object.entries(demoWallets)) {
    console.log(`  ${name}: ${kp.publicKey.toBase58()}`);
  }

  console.log("\n--- Add these to frontend/.env ---");
  console.log(`VITE_ESCROW_PROGRAM_ID=${escrowProgram.programId.toBase58()}`);
  console.log(`VITE_KYC_HOOK_PROGRAM_ID=${kycProgram.programId.toBase58()}`);
  console.log(`VITE_VUSDC_MINT=${mintKeypair.publicKey.toBase58()}`);
}

main().catch(console.error);
