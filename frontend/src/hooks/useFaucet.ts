import { useCallback, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useUnifiedAnchorWallet } from '../components/UnifiedWalletProvider';
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { VUSDC_MINT, KYC_HOOK_PROGRAM_ID, getKycPDA, getKycAdminPDA } from '../lib/solana';
import kycIdl from '../idl/signal_kyc_hook.json';

function getAdminKeypair(): Keypair | null {
  const b64 = import.meta.env.VITE_DEMO_ADMIN_KEYPAIR;
  if (!b64) return null;
  try { return Keypair.fromSecretKey(Buffer.from(b64, 'base64')); } catch { return null; }
}

export function useFaucet() {
  const wallet = useUnifiedAnchorWallet();
  const { connection } = useConnection();
  const [isClaiming, setIsClaiming] = useState(false);

  const claimFaucet = useCallback(async (): Promise<{ txHash: string; amount: number }> => {
    if (!wallet) throw new Error('Wallet not connected');
    const adminKeypair = getAdminKeypair();
    if (!adminKeypair) throw new Error('Faucet not configured (missing admin keypair)');

    setIsClaiming(true);
    try {
      const AMOUNT = 10_000 * 1_000_000; // 10,000 vUSDC

      // 0. Airdrop SOL if wallet has less than 0.1 SOL (needed for tx fees)
      const balance = await connection.getBalance(wallet.publicKey);
      if (balance < 0.1 * LAMPORTS_PER_SOL) {
        const sig = await connection.requestAirdrop(wallet.publicKey, LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, 'confirmed');
      }

      // 1. Create ATA for user if needed, then mint vUSDC
      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        adminKeypair,
        VUSDC_MINT,
        wallet.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      const mintTx = await mintTo(
        connection,
        adminKeypair,
        VUSDC_MINT,
        ata.address,
        adminKeypair,
        AMOUNT,
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      // 2. Register KYC for the user if not already registered (admin pays fees)
      const adminWallet = {
        publicKey: adminKeypair.publicKey,
        signTransaction: async (tx: any) => { tx.partialSign(adminKeypair); return tx; },
        signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.partialSign(adminKeypair)); return txs; },
      };
      const adminProvider = new AnchorProvider(connection, adminWallet as any, { commitment: 'confirmed' });
      const kycProgram = new Program(kycIdl as any, adminProvider);
      const [kycPDA] = getKycPDA(wallet.publicKey);
      const [configPDA] = getKycAdminPDA();
      try {
        await (kycProgram.account as any).kycStatus.fetch(kycPDA);
        // Already registered — skip
      } catch {
        const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
        await (kycProgram as any).methods
          .registerKyc(wallet.publicKey, 2, Buffer.from('US'), new BN(oneYear))
          .accounts({
            admin: adminKeypair.publicKey,
            config: configPDA,
            kycStatus: kycPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      return { txHash: mintTx, amount: AMOUNT / 1_000_000 };
    } finally {
      setIsClaiming(false);
    }
  }, [wallet, connection]);

  return { isClaiming, claimFaucet };
}
