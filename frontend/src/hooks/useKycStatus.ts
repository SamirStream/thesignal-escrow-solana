import { useCallback, useEffect, useState } from 'react';
import { useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { KYC_HOOK_PROGRAM_ID, getKycPDA } from '../lib/solana';

import kycIdl from '../idl/signal_kyc_hook.json';

export interface KycData {
  wallet: string;
  verified: boolean;
  kycLevel: number;
  countryCode: string;
  verifiedAt: number;
  expiresAt: number;
  isBlocked: boolean;
}

const KYC_LEVEL_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Basic',
  2: 'Enhanced',
  3: 'Institutional',
};

export function getKycLevelLabel(level: number): string {
  return KYC_LEVEL_LABELS[level] || 'Unknown';
}

export function useKycStatus() {
  const wallet = useAnchorWallet();
  const { connection } = useConnection();
  const [kycData, setKycData] = useState<KycData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const getProgram = useCallback(() => {
    if (!wallet) throw new Error('Wallet not connected');
    const provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });
    return new Program(kycIdl as any, KYC_HOOK_PROGRAM_ID, provider);
  }, [wallet, connection]);

  const fetchKycStatus = useCallback(async (walletAddress?: PublicKey) => {
    const target = walletAddress || wallet?.publicKey;
    if (!target) return null;

    setIsLoading(true);
    try {
      const program = getProgram();
      const [kycPDA] = getKycPDA(target);

      const kyc = await program.account.kycStatus.fetch(kycPDA);
      const data: KycData = {
        wallet: (kyc.wallet as PublicKey).toBase58(),
        verified: kyc.verified as boolean,
        kycLevel: kyc.kycLevel as number,
        countryCode: String.fromCharCode(
          (kyc.countryCode as number[])[0],
          (kyc.countryCode as number[])[1]
        ),
        verifiedAt: (kyc.verifiedAt as BN).toNumber(),
        expiresAt: (kyc.expiresAt as BN).toNumber(),
        isBlocked: kyc.isBlocked as boolean,
      };
      setKycData(data);
      return data;
    } catch {
      setKycData(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [wallet, getProgram]);

  // Demo: self-verify KYC (admin instruction, for hackathon demo only)
  const selfVerifyKyc = useCallback(async (
    kycLevel: number = 2,
    countryCode: string = 'US',
  ): Promise<string> => {
    const program = getProgram();
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    const [kycPDA] = getKycPDA(wallet.publicKey);
    const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

    const txHash = await program.methods
      .registerKyc(
        wallet.publicKey,
        kycLevel,
        Buffer.from(countryCode.slice(0, 2)),
        new BN(oneYearFromNow)
      )
      .accounts({
        admin: wallet.publicKey,
        kycStatus: kycPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await fetchKycStatus();
    return txHash;
  }, [wallet, getProgram, fetchKycStatus]);

  // Auto-fetch on wallet connect
  useEffect(() => {
    if (wallet?.publicKey) {
      fetchKycStatus();
    } else {
      setKycData(null);
    }
  }, [wallet?.publicKey, fetchKycStatus]);

  return {
    kycData,
    isLoading,
    fetchKycStatus,
    selfVerifyKyc,
    getKycLevelLabel,
  };
}
