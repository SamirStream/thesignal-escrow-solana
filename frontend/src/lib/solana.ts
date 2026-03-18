import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';

// --- Network Config ---
export const NETWORK = 'devnet';
export const RPC_URL = clusterApiUrl('devnet');
export const connection = new Connection(RPC_URL, 'confirmed');

// --- Program IDs (updated after deployment) ---
export const ESCROW_PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_ESCROW_PROGRAM_ID || 'EscW1bMhpQRXmGCG6Lgr2bPBi8S42FX1DPYjgPqz6hK3'
);
export const KYC_HOOK_PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_KYC_HOOK_PROGRAM_ID || 'KycH1bMhpQRXmGCG6Lgr2bPBi8S42FX1DPYjgPqz7hK4'
);
export const VUSDC_MINT = new PublicKey(
  import.meta.env.VITE_VUSDC_MINT || '11111111111111111111111111111111'
);

// --- Constants ---
export const DECIMALS = 6; // USDC uses 6 decimals on Solana
export const EXPLORER_URL = 'https://explorer.solana.com';

// --- Demo Accounts (devnet) ---
export const DEMO_ACCOUNTS = {
  provider: 'DemoProviderAddressWillBeSetAfterDeployment11111',
  connector: 'DemoConnectorAddressWillBeSetAfterDeployment11111',
  protocol: 'DemoProtocolAddressWillBeSetAfterDeployment11111',
};

// --- Helpers ---
export function getExplorerTxLink(signature: string): string {
  return `${EXPLORER_URL}/tx/${signature}?cluster=${NETWORK}`;
}

export function getExplorerAccountLink(address: string): string {
  return `${EXPLORER_URL}/address/${address}?cluster=${NETWORK}`;
}

export function truncateAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function formatAmount(lamports: number | bigint | string, decimals = DECIMALS): string {
  const num = typeof lamports === 'string' ? parseInt(lamports) : Number(lamports);
  return (num / Math.pow(10, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function toContractAmount(humanAmount: number, decimals = DECIMALS): number {
  return Math.round(humanAmount * Math.pow(10, decimals));
}

// --- PDA Derivation Helpers ---
export function getConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow_config')],
    ESCROW_PROGRAM_ID
  );
}

export function getDealPDA(dealId: number): [PublicKey, number] {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(dealId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from('deal'), buffer],
    ESCROW_PROGRAM_ID
  );
}

export function getVaultPDA(dealId: number): [PublicKey, number] {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(dealId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), buffer],
    ESCROW_PROGRAM_ID
  );
}

export function getReputationPDA(provider: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reputation'), provider.toBuffer()],
    ESCROW_PROGRAM_ID
  );
}

export function getKycPDA(wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('kyc'), wallet.toBuffer()],
    KYC_HOOK_PROGRAM_ID
  );
}
