/**
 * Finish devnet setup — runs KYC admin init + EscrowConfig init
 * using the already-deployed mint (26SZbMQoByiyUGHwMTTeyAQABghUpX4PUp84JevokZtB)
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

const VUSDC_MINT = new PublicKey("26SZbMQoByiyUGHwMTTeyAQABghUpX4PUp84JevokZtB");
const DECIMALS = 6;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const escrowProgram = anchor.workspace.SignalEscrow;
  const kycProgram = anchor.workspace.SignalKycHook;
  const admin = provider.wallet as anchor.Wallet;

  console.log("Admin:", admin.publicKey.toBase58());
  console.log("vUSDC Mint:", VUSDC_MINT.toBase58());

  // --- KYC Admin ---
  const [kycAdminPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("kyc_admin")],
    kycProgram.programId
  );

  // Check if already initialized
  const existing = await provider.connection.getAccountInfo(kycAdminPDA);
  if (!existing) {
    console.log("\n--- Initializing KYC Admin ---");
    await kycProgram.methods
      .initializeKycAdmin()
      .accounts({
        admin: admin.publicKey,
        config: kycAdminPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("KYC Admin Config:", kycAdminPDA.toBase58());
  } else {
    console.log("KYC Admin already initialized:", kycAdminPDA.toBase58());
  }

  // --- Register admin KYC ---
  const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const [adminKycPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("kyc"), admin.publicKey.toBuffer()],
    kycProgram.programId
  );

  const existingKyc = await provider.connection.getAccountInfo(adminKycPDA);
  if (!existingKyc) {
    console.log("\n--- Registering Admin KYC ---");
    await kycProgram.methods
      .registerKyc(admin.publicKey, 3, Buffer.from("CH"), new anchor.BN(oneYearFromNow))
      .accounts({
        admin: admin.publicKey,
        config: kycAdminPDA,
        kycStatus: adminKycPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Admin KYC registered");
  } else {
    console.log("Admin KYC already registered");
  }

  // --- Mint vUSDC to admin ---
  console.log("\n--- Creating admin token account + minting vUSDC ---");
  const adminTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    (admin as any).payer,
    VUSDC_MINT,
    admin.publicKey,
    false,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  console.log("Admin token account:", adminTokenAccount.address.toBase58());

  await mintTo(
    provider.connection,
    (admin as any).payer,
    VUSDC_MINT,
    adminTokenAccount.address,
    admin.publicKey,
    1_000_000 * 10 ** DECIMALS, // 1M vUSDC for faucet usage
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  console.log("Minted 1,000,000 vUSDC to admin");

  // --- EscrowConfig ---
  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow_config")],
    escrowProgram.programId
  );

  const existingConfig = await provider.connection.getAccountInfo(configPDA);
  if (!existingConfig) {
    console.log("\n--- Initializing EscrowConfig (admin as protocol wallet) ---");
    await escrowProgram.methods
      .initialize()
      .accounts({
        admin: admin.publicKey,
        protocolWallet: admin.publicKey, // admin receives protocol fees for demo
        config: configPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("EscrowConfig:", configPDA.toBase58());
  } else {
    console.log("EscrowConfig already initialized:", configPDA.toBase58());
  }

  console.log("\n=== SETUP COMPLETE ===");
  console.log(`VITE_ESCROW_PROGRAM_ID=${escrowProgram.programId.toBase58()}`);
  console.log(`VITE_KYC_HOOK_PROGRAM_ID=${kycProgram.programId.toBase58()}`);
  console.log(`VITE_VUSDC_MINT=${VUSDC_MINT.toBase58()}`);
  console.log(`VITE_SOLANA_RPC_URL=https://api.devnet.solana.com`);
  console.log(`VITE_SOLANA_NETWORK=devnet`);
}

main().catch(console.error);
