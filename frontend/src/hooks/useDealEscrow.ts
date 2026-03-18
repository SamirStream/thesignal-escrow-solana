import { useCallback, useState } from 'react';
import { useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  ESCROW_PROGRAM_ID,
  VUSDC_MINT,
  getConfigPDA,
  getDealPDA,
  getVaultPDA,
  getReputationPDA,
} from '../lib/solana';

// IDL will be loaded from the generated JSON after anchor build
// For now, we define the types inline
import type { SignalEscrow } from '../idl/signal_escrow';
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
  const wallet = useAnchorWallet();
  const { connection } = useConnection();
  const [isProcessing, setIsProcessing] = useState(false);

  const getProgram = useCallback(() => {
    if (!wallet) throw new Error('Wallet not connected');
    const provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });
    return new Program(idl as any, ESCROW_PROGRAM_ID, provider) as unknown as Program<SignalEscrow>;
  }, [wallet, connection]);

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
        .rpc();

      return { txHash };
    } finally {
      setIsProcessing(false);
    }
  }, [getProgram, wallet]);

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

      const providerAta = getAssociatedTokenAddressSync(
        VUSDC_MINT, new PublicKey(providerAddr), false, TOKEN_2022_PROGRAM_ID
      );
      const connectorAta = getAssociatedTokenAddressSync(
        VUSDC_MINT, new PublicKey(connectorAddr), false, TOKEN_2022_PROGRAM_ID
      );
      const protocolAta = getAssociatedTokenAddressSync(
        VUSDC_MINT, new PublicKey(protocolWalletAddr), false, TOKEN_2022_PROGRAM_ID
      );

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
        .rpc();

      return { txHash };
    } finally {
      setIsProcessing(false);
    }
  }, [getProgram, wallet]);

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

  return {
    isProcessing,
    getDealCount,
    getDeal,
    getReputation,
    createDeal,
    deposit,
    releaseMilestone,
    dispute,
  };
}
