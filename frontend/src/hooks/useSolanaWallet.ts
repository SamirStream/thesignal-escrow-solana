import { useCallback, useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { VUSDC_MINT, DECIMALS, formatAmount } from '../lib/solana';

export function useSolanaWallet() {
  const { publicKey, connected, disconnect, signTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  const [solBalance, setSolBalance] = useState('0');
  const [usdcBalance, setUsdcBalance] = useState('0');
  const [isLoading, setIsLoading] = useState(false);

  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;
    setIsLoading(true);
    try {
      // SOL balance
      const solBal = await connection.getBalance(publicKey);
      setSolBalance((solBal / LAMPORTS_PER_SOL).toFixed(4));

      // vUSDC balance (Token-2022)
      try {
        const ata = getAssociatedTokenAddressSync(
          VUSDC_MINT,
          publicKey,
          false,
          TOKEN_2022_PROGRAM_ID
        );
        const account = await getAccount(connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
        setUsdcBalance(formatAmount(account.amount));
      } catch {
        setUsdcBalance('0.00');
      }
    } catch (err) {
      console.error('Balance refresh failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    if (connected && publicKey) {
      refreshBalances();
    } else {
      setSolBalance('0');
      setUsdcBalance('0.00');
    }
  }, [connected, publicKey, refreshBalances]);

  return {
    address: publicKey?.toBase58() || '',
    publicKey,
    isConnected: connected,
    solBalance,
    usdcBalance,
    isLoading,
    disconnect,
    refreshBalances,
    signTransaction,
    signAllTransactions,
  };
}
