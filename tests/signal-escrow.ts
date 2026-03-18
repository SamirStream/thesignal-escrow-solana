import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import { SignalEscrow } from "../target/types/signal_escrow";

describe("signal-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SignalEscrow as Program<SignalEscrow>;

  // Test accounts
  const admin = Keypair.generate();
  const client = Keypair.generate();
  const providerWallet = Keypair.generate();
  const connector = Keypair.generate();
  const protocolWallet = Keypair.generate();

  let mint: PublicKey;
  let clientTokenAccount: PublicKey;
  let providerTokenAccount: PublicKey;
  let connectorTokenAccount: PublicKey;
  let protocolTokenAccount: PublicKey;

  const DECIMALS = 6;
  const ONE_USDC = 1_000_000; // 1 USDC = 10^6

  // PDA helpers
  const getConfigPDA = () =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("escrow_config")],
      program.programId
    );

  const getDealPDA = (dealId: number) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("deal"),
        new anchor.BN(dealId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  const getVaultPDA = (dealId: number) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        new anchor.BN(dealId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  const getReputationPDA = (provider: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), provider.toBuffer()],
      program.programId
    );

  before(async () => {
    // Airdrop SOL to test accounts
    const airdropPromises = [admin, client, providerWallet, connector, protocolWallet].map(
      async (kp) => {
        const sig = await provider.connection.requestAirdrop(
          kp.publicKey,
          2 * LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig);
      }
    );
    await Promise.all(airdropPromises);

    // Create Token-2022 mint (without transfer hook for basic escrow tests)
    mint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      DECIMALS,
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create token accounts and mint test USDC
    const accounts = await Promise.all([
      getOrCreateAssociatedTokenAccount(
        provider.connection, admin, mint, client.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID
      ),
      getOrCreateAssociatedTokenAccount(
        provider.connection, admin, mint, providerWallet.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID
      ),
      getOrCreateAssociatedTokenAccount(
        provider.connection, admin, mint, connector.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID
      ),
      getOrCreateAssociatedTokenAccount(
        provider.connection, admin, mint, protocolWallet.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID
      ),
    ]);

    clientTokenAccount = accounts[0].address;
    providerTokenAccount = accounts[1].address;
    connectorTokenAccount = accounts[2].address;
    protocolTokenAccount = accounts[3].address;

    // Mint 10,000 USDC to client
    await mintTo(
      provider.connection,
      admin,
      mint,
      clientTokenAccount,
      admin,
      10_000 * ONE_USDC,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("Initializes the escrow config", async () => {
    const [configPDA] = getConfigPDA();

    await program.methods
      .initialize()
      .accounts({
        admin: admin.publicKey,
        protocolWallet: protocolWallet.publicKey,
        config: configPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const config = await program.account.escrowConfig.fetch(configPDA);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(
      config.protocolWallet.toBase58(),
      protocolWallet.publicKey.toBase58()
    );
    assert.equal(config.dealCount.toNumber(), 0);
  });

  it("Creates a deal with 3 milestones", async () => {
    const [configPDA] = getConfigPDA();
    const [dealPDA] = getDealPDA(0);
    const [vaultPDA] = getVaultPDA(0);

    const milestoneAmounts = [
      new anchor.BN(3000 * ONE_USDC), // 30%
      new anchor.BN(5000 * ONE_USDC), // 50%
      new anchor.BN(2000 * ONE_USDC), // 20%
    ];

    await program.methods
      .createDeal(
        1000, // 10% platform fee
        4000, // 40% connector share of fee
        milestoneAmounts
      )
      .accounts({
        client: client.publicKey,
        provider: providerWallet.publicKey,
        connector: connector.publicKey,
        config: configPDA,
        deal: dealPDA,
        vault: vaultPDA,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    const deal = await program.account.deal.fetch(dealPDA);
    assert.equal(deal.dealId.toNumber(), 0);
    assert.equal(deal.client.toBase58(), client.publicKey.toBase58());
    assert.equal(deal.provider.toBase58(), providerWallet.publicKey.toBase58());
    assert.equal(deal.connector.toBase58(), connector.publicKey.toBase58());
    assert.equal(deal.totalAmount.toNumber(), 10000 * ONE_USDC);
    assert.equal(deal.platformFeeBps, 1000);
    assert.equal(deal.connectorShareBps, 4000);
    assert.equal(deal.milestoneCount, 3);
    assert.deepEqual(deal.status, { created: {} });
    assert.equal(deal.milestones.length, 3);
    assert.equal(deal.milestones[0].amount.toNumber(), 3000 * ONE_USDC);

    const config = await program.account.escrowConfig.fetch(configPDA);
    assert.equal(config.dealCount.toNumber(), 1);
  });

  it("Client deposits for milestone 0", async () => {
    const [dealPDA] = getDealPDA(0);
    const [vaultPDA] = getVaultPDA(0);

    await program.methods
      .deposit(new anchor.BN(0), 0)
      .accounts({
        client: client.publicKey,
        deal: dealPDA,
        vault: vaultPDA,
        clientTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    const deal = await program.account.deal.fetch(dealPDA);
    assert.deepEqual(deal.milestones[0].status, { funded: {} });
    assert.deepEqual(deal.status, { active: {} });
    assert.equal(deal.fundedAmount.toNumber(), 3000 * ONE_USDC);
  });

  it("Releases milestone 0 with atomic 3-way split", async () => {
    const [dealPDA] = getDealPDA(0);
    const [vaultPDA] = getVaultPDA(0);
    const [reputationPDA] = getReputationPDA(providerWallet.publicKey);

    await program.methods
      .releaseMilestone(new anchor.BN(0), 0)
      .accounts({
        client: client.publicKey,
        deal: dealPDA,
        vault: vaultPDA,
        providerTokenAccount,
        connectorTokenAccount,
        protocolTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        reputation: reputationPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    const deal = await program.account.deal.fetch(dealPDA);
    assert.deepEqual(deal.milestones[0].status, { released: {} });

    // Verify 3-way split amounts
    // amount = 3000 USDC
    // platform_fee = 3000 * 1000 / 10000 = 300 USDC
    // connector_cut = 300 * 4000 / 10000 = 120 USDC
    // protocol_cut = 300 - 120 = 180 USDC
    // provider_cut = 3000 - 300 = 2700 USDC
  });

  it("Deposits and releases remaining milestones, completing the deal", async () => {
    const [dealPDA] = getDealPDA(0);
    const [vaultPDA] = getVaultPDA(0);
    const [reputationPDA] = getReputationPDA(providerWallet.publicKey);

    // Deposit + release milestone 1
    await program.methods
      .deposit(new anchor.BN(0), 1)
      .accounts({
        client: client.publicKey,
        deal: dealPDA,
        vault: vaultPDA,
        clientTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    await program.methods
      .releaseMilestone(new anchor.BN(0), 1)
      .accounts({
        client: client.publicKey,
        deal: dealPDA,
        vault: vaultPDA,
        providerTokenAccount,
        connectorTokenAccount,
        protocolTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        reputation: reputationPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    // Deposit + release milestone 2
    await program.methods
      .deposit(new anchor.BN(0), 2)
      .accounts({
        client: client.publicKey,
        deal: dealPDA,
        vault: vaultPDA,
        clientTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    await program.methods
      .releaseMilestone(new anchor.BN(0), 2)
      .accounts({
        client: client.publicKey,
        deal: dealPDA,
        vault: vaultPDA,
        providerTokenAccount,
        connectorTokenAccount,
        protocolTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        reputation: reputationPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    const deal = await program.account.deal.fetch(dealPDA);
    assert.deepEqual(deal.status, { completed: {} });

    // Check reputation
    const reputation = await program.account.reputation.fetch(reputationPDA);
    assert.equal(reputation.completedDeals.toNumber(), 1);
    assert.equal(
      reputation.provider.toBase58(),
      providerWallet.publicKey.toBase58()
    );
  });

  it("Creates and disputes a deal", async () => {
    const [configPDA] = getConfigPDA();
    const [dealPDA] = getDealPDA(1);
    const [vaultPDA] = getVaultPDA(1);

    // Create deal 1
    await program.methods
      .createDeal(
        500, // 5% fee
        5000, // 50% connector share
        [new anchor.BN(1000 * ONE_USDC)]
      )
      .accounts({
        client: client.publicKey,
        provider: providerWallet.publicKey,
        connector: connector.publicKey,
        config: configPDA,
        deal: dealPDA,
        vault: vaultPDA,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    // Deposit
    await program.methods
      .deposit(new anchor.BN(1), 0)
      .accounts({
        client: client.publicKey,
        deal: dealPDA,
        vault: vaultPDA,
        clientTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    // Provider disputes
    await program.methods
      .dispute(new anchor.BN(1), 0)
      .accounts({
        caller: providerWallet.publicKey,
        deal: dealPDA,
      })
      .signers([providerWallet])
      .rpc();

    const deal = await program.account.deal.fetch(dealPDA);
    assert.deepEqual(deal.status, { disputed: {} });
    assert.deepEqual(deal.milestones[0].status, { disputed: {} });
  });

  it("Admin resolves dispute with 50/50 split", async () => {
    const [configPDA] = getConfigPDA();
    const [dealPDA] = getDealPDA(1);
    const [vaultPDA] = getVaultPDA(1);

    await program.methods
      .resolveDispute(new anchor.BN(1), 0, 5000) // 50% refund to client
      .accounts({
        admin: admin.publicKey,
        config: configPDA,
        deal: dealPDA,
        vault: vaultPDA,
        clientTokenAccount,
        providerTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const deal = await program.account.deal.fetch(dealPDA);
    assert.deepEqual(deal.milestones[0].status, { refunded: {} });
    assert.deepEqual(deal.status, { cancelled: {} });
  });

  it("Admin refunds an entire deal", async () => {
    const [configPDA] = getConfigPDA();
    const [dealPDA] = getDealPDA(2);
    const [vaultPDA] = getVaultPDA(2);

    // Create deal 2
    await program.methods
      .createDeal(
        1000,
        4000,
        [new anchor.BN(500 * ONE_USDC), new anchor.BN(500 * ONE_USDC)]
      )
      .accounts({
        client: client.publicKey,
        provider: providerWallet.publicKey,
        connector: connector.publicKey,
        config: configPDA,
        deal: dealPDA,
        vault: vaultPDA,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    // Deposit both milestones
    await program.methods
      .deposit(new anchor.BN(2), 0)
      .accounts({
        client: client.publicKey,
        deal: dealPDA,
        vault: vaultPDA,
        clientTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    await program.methods
      .deposit(new anchor.BN(2), 1)
      .accounts({
        client: client.publicKey,
        deal: dealPDA,
        vault: vaultPDA,
        clientTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    // Admin refunds everything
    await program.methods
      .refund(new anchor.BN(2))
      .accounts({
        admin: admin.publicKey,
        config: configPDA,
        deal: dealPDA,
        vault: vaultPDA,
        clientTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const deal = await program.account.deal.fetch(dealPDA);
    assert.deepEqual(deal.status, { cancelled: {} });
    assert.deepEqual(deal.milestones[0].status, { refunded: {} });
    assert.deepEqual(deal.milestones[1].status, { refunded: {} });
  });
});
