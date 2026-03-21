import pkg from '@coral-xyz/anchor';
const { AnchorProvider, Program, BN, setProvider } = pkg;
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const idl = JSON.parse(readFileSync(join(__dirname, '../frontend/src/idl/signal_kyc_hook.json'), 'utf8'));

const provider = AnchorProvider.env();
setProvider(provider);
const program = new Program(idl, provider);

const TARGET = new PublicKey(process.argv[2]);
console.log('Registering KYC for:', TARGET.toBase58());

const [kycPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('kyc'), TARGET.toBuffer()],
  program.programId
);
const [configPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('kyc_admin')],
  program.programId
);

const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

const tx = await program.methods
  .registerKyc(TARGET, 2, Buffer.from('US'), new BN(oneYear))
  .accounts({
    admin: provider.wallet.publicKey,
    config: configPDA,
    kycStatus: kycPDA,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

console.log('KYC registered! tx:', tx);
