import { useCallback, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useUnifiedAnchorWallet } from '../components/UnifiedWalletProvider';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import {
  VUSDC_MINT,
  KYC_HOOK_PROGRAM_ID,
  getConfigPDA,
  getDealPDA,
  getVaultPDA,
  getReputationPDA,
  getKycPDA,
  getKycAdminPDA,
} from '../lib/solana';
import kycIdl from '../idl/signal_kyc_hook.json';

function getAdminKeypair(): Keypair | null {
  const b64 = import.meta.env.VITE_DEMO_ADMIN_KEYPAIR;
  if (!b64) return null;
  try { return Keypair.fromSecretKey(Buffer.from(b64, 'base64')); } catch { return null; }
}

function getTransferHookAccounts(
  mint: PublicKey,
  senderOwner: PublicKey,
  receiverOwner: PublicKey,
) {
  const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), mint.toBuffer()],
    KYC_HOOK_PROGRAM_ID
  );
  const [senderKyc] = getKycPDA(senderOwner);
  const [receiverKyc] = getKycPDA(receiverOwner);
  // Order: [senderKyc, receiverKyc, hookProgram, extraMetaList]
  // Token-2022 expects extra accounts first, then the hook program + meta list
  return [
    { pubkey: senderKyc, isWritable: false, isSigner: false },
    { pubkey: receiverKyc, isWritable: false, isSigner: false },
    { pubkey: KYC_HOOK_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: extraAccountMetaList, isWritable: false, isSigner: false },
  ];
}

// IDL loaded from generated JSON (placeholder until anchor build)
import idl from '../idl/signal_escrow.json';

export interface DealData {
  dealId: number;
  client: string;
  provider: string;
  connector: string;
  protocolWallet: string;
  tokenMint: string;
  totalAmount: number;
  platformFeeBps: number;
  connectorShareBps: number;
  status: string;
  fundedAmount: number;
  milestoneCount: number;
  milestones: Array<{
    amount: number;
    status: string;
  }>;
}

function parseDealStatus(status: any): string {
  if (status.created) return 'Created';
  if (status.active) return 'Active';
  if (status.completed) return 'Completed';
  if (status.cancelled) return 'Cancelled';
  if (status.disputed) return 'Disputed';
  return 'Unknown';
}

function parseMilestoneStatus(status: any): string {
  if (status.pending) return 'Pending';
  if (status.funded) return 'Funded';
  if (status.released) return 'Released';
  if (status.disputed) return 'Disputed';
  if (status.refunded) return 'Refunded';
  return 'Unknown';
}

export function useDealEscrow() {
  const wallet = useUnifiedAnchorWallet();
  const { connection } = useConnection();
  const [isProcessing, setIsProcessing] = useState(false);

  const getProgram = useCallback((): any => {
    if (!wallet) throw new Error('Wallet not connected');
    const provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });
    return new Program(idl as any, provider);
  }, [wallet, connection]);

  // Register KYC for a PDA using embedded admin keypair (demo only)
  const ensureKycRegistered = useCallback(async (target: PublicKey) => {
    const adminKeypair = getAdminKeypair();
    if (!adminKeypair) return;
    const [kycPDA] = getKycPDA(target);
    try {
      const provider = new AnchorProvider(connection, wallet!, { commitment: 'confirmed' });
      const kycProgram = new Program(kycIdl as any, provider);
      await kycProgram.account.kycStatus.fetch(kycPDA);
    } catch {
      // Not registered — register now
      const provider = new AnchorProvider(connection, wallet!, { commitment: 'confirmed' });
      const kycProgram = new Program(kycIdl as any, provider);
      const [configPDA] = getKycAdminPDA();
      const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      await kycProgram.methods
        .registerKyc(target, 2, Buffer.from('US'), new BN(oneYear))
        .accounts({ admin: adminKeypair.publicKey, config: configPDA, kycStatus: kycPDA, systemProgram: SystemProgram.programId })
        .signers([adminKeypair])
        .rpc();
    }
  }, [connection, wallet]);

  // --- Read Methods ---

  const getDealCount = useCallback(async (): Promise<number> => {
    const program = getProgram();
    const [configPDA] = getConfigPDA();
    try {
      const config = await program.account.escrowConfig.fetch(configPDA);
      return (config.dealCount as BN).toNumber();
    } catch {
      return 0;
    }
  }, [getProgram]);

  const getDeal = useCallback(async (dealId: number): Promise<DealData | null> => {
    const program = getProgram();
    const [dealPDA] = getDealPDA(dealId);
    try {
      const deal = await program.account.deal.fetch(dealPDA);
      return {
        dealId: (deal.dealId as BN).toNumber(),
        client: deal.client.toBase58(),
        provider: deal.provider.toBase58(),
        connector: deal.connector.toBase58(),
        protocolWallet: deal.protocolWallet.toBase58(),
        tokenMint: deal.tokenMint.toBase58(),
        totalAmount: (deal.totalAmount as BN).toNumber(),
        platformFeeBps: deal.platformFeeBps,
        connectorShareBps: deal.connectorShareBps,
        status: parseDealStatus(deal.status),
        fundedAmount: (deal.fundedAmount as BN).toNumber(),
        milestoneCount: deal.milestoneCount,
        milestones: deal.milestones.map((m: any) => ({
          amount: (m.amount as BN).toNumber(),
          status: parseMilestoneStatus(m.status),
        })),
      };
    } catch {
      return null;
    }
  }, [getProgram]);

  const getReputation = useCallback(async (provider: PublicKey): Promise<number> => {
    const program = getProgram();
    const [repPDA] = getReputationPDA(provider);
    try {
      const rep = await program.account.reputation.fetch(repPDA);
      return (rep.completedDeals as BN).toNumber();
    } catch {
      return 0;
    }
  }, [getProgram]);

  // --- Write Methods ---

  const createDeal = useCallback(async (
    providerAddr: string,
    connectorAddr: string,
    platformFeeBps: number,
    connectorShareBps: number,
    milestoneAmounts: number[],
  ): Promise<{ dealId: number; txHash: string }> => {
    setIsProcessing(true);
    try {
      const program = getProgram();
      const [configPDA] = getConfigPDA();
      const config = await program.account.escrowConfig.fetch(configPDA);
      const dealId = (config.dealCount as BN).toNumber();
      const [dealPDA] = getDealPDA(dealId);
      const [vaultPDA] = getVaultPDA(dealId);

      const bnAmounts = milestoneAmounts.map(a => new BN(a));

      const txHash = await program.methods
        .createDeal(platformFeeBps, connectorShareBps, bnAmounts)
        .accounts({
          client: wallet!.publicKey,
          provider: new PublicKey(providerAddr),
          connector: new PublicKey(connectorAddr),
          config: configPDA,
          deal: dealPDA,
          vault: vaultPDA,
          tokenMint: VUSDC_MINT,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { dealId, txHash };
    } finally {
      setIsProcessing(false);
    }
  }, [getProgram, wallet]);

  const deposit = useCallback(async (
    dealId: number,
    milestoneIdx: number,
  ): Promise<{ txHash: string }> => {
    setIsProcessing(true);
    try {
      const program = getProgram();
      const [dealPDA] = getDealPDA(dealId);
      const [vaultPDA] = getVaultPDA(dealId);

      const clientAta = getAssociatedTokenAddressSync(
        VUSDC_MINT,
        wallet!.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      // Vault's token account owner is the deal PDA — that's what the KYC hook checks
      await ensureKycRegistered(dealPDA);

      const txHash = await program.methods
        .deposit(new BN(dealId), milestoneIdx)
        .accounts({
          client: wallet!.publicKey,
          deal: dealPDA,
          vault: vaultPDA,
          clientTokenAccount: clientAta,
          tokenMint: VUSDC_MINT,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(getTransferHookAccounts(VUSDC_MINT, wallet!.publicKey, dealPDA))
        .rpc();

      return { txHash };
    } finally {
      setIsProcessing(false);
    }
  }, [getProgram, wallet, ensureKycRegistered]);

  const releaseMilestone = useCallback(async (
    dealId: number,
    milestoneIdx: number,
    providerAddr: string,
    connectorAddr: string,
    protocolWalletAddr: string,
  ): Promise<{ txHash: string }> => {
    setIsProcessing(true);
    try {
      const program = getProgram();
      const [dealPDA] = getDealPDA(dealId);
      const [vaultPDA] = getVaultPDA(dealId);
      const [reputationPDA] = getReputationPDA(new PublicKey(providerAddr));

      const providerPubkey = new PublicKey(providerAddr);
      const connectorPubkey = new PublicKey(connectorAddr);
      const protocolPubkey = new PublicKey(protocolWalletAddr);

      const providerAta = getAssociatedTokenAddressSync(VUSDC_MINT, providerPubkey, false, TOKEN_2022_PROGRAM_ID);
      const connectorAta = getAssociatedTokenAddressSync(VUSDC_MINT, connectorPubkey, false, TOKEN_2022_PROGRAM_ID);
      const protocolAta = getAssociatedTokenAddressSync(VUSDC_MINT, protocolPubkey, false, TOKEN_2022_PROGRAM_ID);

      // Vault's token authority = deal PDA (sender for all 3 release transfers)
      // KYC hook checks token account owners, not the token account addresses
      await ensureKycRegistered(dealPDA);
      await ensureKycRegistered(providerPubkey);
      await ensureKycRegistered(connectorPubkey);
      await ensureKycRegistered(protocolPubkey);

      // Build remaining accounts: [senderKyc, ...receiverKycs, hookProgram, extraMetaList]
      const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
        [Buffer.from('extra-account-metas'), VUSDC_MINT.toBuffer()],
        KYC_HOOK_PROGRAM_ID
      );
      const [dealKyc] = getKycPDA(dealPDA);
      const [providerKyc] = getKycPDA(providerPubkey);
      const [connectorKyc] = getKycPDA(connectorPubkey);
      const [protocolKyc] = getKycPDA(protocolPubkey);

      const txHash = await program.methods
        .releaseMilestone(new BN(dealId), milestoneIdx)
        .accounts({
          client: wallet!.publicKey,
          deal: dealPDA,
          vault: vaultPDA,
          providerTokenAccount: providerAta,
          connectorTokenAccount: connectorAta,
          protocolTokenAccount: protocolAta,
          tokenMint: VUSDC_MINT,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          reputation: reputationPDA,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: dealKyc, isWritable: false, isSigner: false },
          { pubkey: providerKyc, isWritable: false, isSigner: false },
          { pubkey: connectorKyc, isWritable: false, isSigner: false },
          { pubkey: protocolKyc, isWritable: false, isSigner: false },
          { pubkey: KYC_HOOK_PROGRAM_ID, isWritable: false, isSigner: false },
          { pubkey: extraAccountMetaList, isWritable: false, isSigner: false },
        ])
        .rpc();

      return { txHash };
    } finally {
      setIsProcessing(false);
    }
  }, [getProgram, wallet, ensureKycRegistered]);

  const dispute = useCallback(async (
    dealId: number,
    milestoneIdx: number,
  ): Promise<{ txHash: string }> => {
    setIsProcessing(true);
    try {
      const program = getProgram();
      const [dealPDA] = getDealPDA(dealId);

      const txHash = await program.methods
        .dispute(new BN(dealId), milestoneIdx)
        .accounts({
          caller: wallet!.publicKey,
          deal: dealPDA,
        })
        .rpc();

      return { txHash };
    } finally {
      setIsProcessing(false);
    }
  }, [getProgram, wallet]);

  // Admin resolves a dispute: refundBps=0 → 100% to provider, refundBps=10000 → 100% refund to client
  const resolveDispute = useCallback(async (
    dealId: number,
    milestoneIdx: number,
    clientAddr: string,
    providerAddr: string,
    refundBps: number, // 0 = full release to provider, 10000 = full refund to client
  ): Promise<{ txHash: string }> => {
    setIsProcessing(true);
    try {
      const adminKeypair = getAdminKeypair();
      if (!adminKeypair) throw new Error('Admin keypair not configured');

      const [dealPDA] = getDealPDA(dealId);
      const [vaultPDA] = getVaultPDA(dealId);
      const [configPDA] = getConfigPDA();

      const clientPubkey = new PublicKey(clientAddr);
      const providerPubkey = new PublicKey(providerAddr);

      // Ensure ATAs exist (admin pays)
      const clientAta = await getOrCreateAssociatedTokenAccount(
        connection, adminKeypair, VUSDC_MINT, clientPubkey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
      );
      const providerAta = await getOrCreateAssociatedTokenAccount(
        connection, adminKeypair, VUSDC_MINT, providerPubkey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
      );

      // Ensure KYC for both parties
      await ensureKycRegistered(clientPubkey);
      await ensureKycRegistered(providerPubkey);

      const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
        [Buffer.from('extra-account-metas'), VUSDC_MINT.toBuffer()],
        KYC_HOOK_PROGRAM_ID
      );
      const [dealKyc] = getKycPDA(dealPDA);
      const [clientKyc] = getKycPDA(clientPubkey);
      const [providerKyc] = getKycPDA(providerPubkey);

      // Admin wallet wrapper so admin pays fees
      const adminWallet = {
        publicKey: adminKeypair.publicKey,
        signTransaction: async (tx: any) => { tx.partialSign(adminKeypair); return tx; },
        signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.partialSign(adminKeypair)); return txs; },
      };
      const adminProvider = new AnchorProvider(connection, adminWallet as any, { commitment: 'confirmed' });
      const program = new Program(idl as any, adminProvider);

      const txHash = await program.methods
        .resolveDispute(new BN(dealId), milestoneIdx, refundBps)
        .accounts({
          admin: adminKeypair.publicKey,
          config: configPDA,
          deal: dealPDA,
          vault: vaultPDA,
          clientTokenAccount: clientAta.address,
          providerTokenAccount: providerAta.address,
          tokenMint: VUSDC_MINT,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: dealKyc, isWritable: false, isSigner: false },
          { pubkey: clientKyc, isWritable: false, isSigner: false },
          { pubkey: providerKyc, isWritable: false, isSigner: false },
          { pubkey: KYC_HOOK_PROGRAM_ID, isWritable: false, isSigner: false },
          { pubkey: extraAccountMetaList, isWritable: false, isSigner: false },
        ])
        .rpc();

      return { txHash };
    } finally {
      setIsProcessing(false);
    }
  }, [connection, wallet, ensureKycRegistered]);

  return {
    isProcessing,
    getDealCount,
    getDeal,
    getReputation,
    createDeal,
    deposit,
    releaseMilestone,
    dispute,
    resolveDispute,
  };
}
