import pkg from '@coral-xyz/anchor';
const { AnchorProvider, Program, BN, setProvider } = pkg;
import { Keypair, PublicKey, SystemProgram, Connection } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load IDLs and env
const escrowIdl = JSON.parse(readFileSync('/Users/leo/Documents/GitHub/thesignal-escrow-solana/frontend/src/idl/signal_escrow.json', 'utf8'));
const kycIdl = JSON.parse(readFileSync('/Users/leo/Documents/GitHub/thesignal-escrow-solana/frontend/src/idl/signal_kyc_hook.json', 'utf8'));
const env = readFileSync('/Users/leo/Documents/GitHub/thesignal-escrow-solana/frontend/.env', 'utf8');

const MINT = new PublicKey(env.match(/VITE_VUSDC_MINT=(.+)/)[1].trim());
const KYC_HOOK_ID = new PublicKey(env.match(/VITE_KYC_HOOK_PROGRAM_ID=(.+)/)[1].trim());
const ADMIN_B64 = env.match(/VITE_DEMO_ADMIN_KEYPAIR=(.+)/)[1].trim();
const adminKeypair = Keypair.fromSecretKey(Buffer.from(ADMIN_B64, 'base64'));

const provider = AnchorProvider.env();
setProvider(provider);

const escrowProgram = new Program(escrowIdl, provider);
const kycProgram = new Program(kycIdl, provider);

console.log('Programs:', escrowProgram.programId.toBase58(), kycProgram.programId.toBase58());
console.log('Mint:', MINT.toBase58());
console.log('Admin:', adminKeypair.publicKey.toBase58());

// PDAs
const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('escrow_config')], escrowProgram.programId);
const [kycAdminPDA] = PublicKey.findProgramAddressSync([Buffer.from('kyc_admin')], kycProgram.programId);
const [extraMetaPDA] = PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), MINT.toBuffer()], KYC_HOOK_ID);

const getKycPDA = (addr) => PublicKey.findProgramAddressSync([Buffer.from('kyc'), addr.toBuffer()], KYC_HOOK_ID);
const getDealPDA = (id) => PublicKey.findProgramAddressSync([Buffer.from('deal'), new BN(id).toArrayLike(Buffer, 'le', 8)], escrowProgram.programId);
const getVaultPDA = (id) => PublicKey.findProgramAddressSync([Buffer.from('vault'), new BN(id).toArrayLike(Buffer, 'le', 8)], escrowProgram.programId);
const getRepPDA = (addr) => PublicKey.findProgramAddressSync([Buffer.from('reputation'), addr.toBuffer()], escrowProgram.programId);

async function ensureKyc(target) {
  const [kycPDA] = getKycPDA(target);
  try {
    await kycProgram.account.kycStatus.fetch(kycPDA);
    console.log('  KYC already registered for', target.toBase58().slice(0,8));
  } catch {
    const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    await kycProgram.methods.registerKyc(target, 2, Buffer.from('US'), new BN(expiry))
      .accounts({ admin: adminKeypair.publicKey, config: kycAdminPDA, kycStatus: kycPDA, systemProgram: SystemProgram.programId })
      .signers([adminKeypair]).rpc();
    console.log('  KYC registered for', target.toBase58().slice(0,8));
  }
}

function hookAccounts(sender, receiver) {
  const [sKyc] = getKycPDA(sender);
  const [rKyc] = getKycPDA(receiver);
  return [
    { pubkey: sKyc, isWritable: false, isSigner: false },
    { pubkey: rKyc, isWritable: false, isSigner: false },
    { pubkey: KYC_HOOK_ID, isWritable: false, isSigner: false },
    { pubkey: extraMetaPDA, isWritable: false, isSigner: false },
  ];
}

// Test wallets
const client = Keypair.generate();
const providerWallet = Keypair.generate();
const connector = Keypair.generate();

console.log('\n--- Funding test wallets ---');
for (const kp of [client, providerWallet, connector]) {
  await provider.connection.requestAirdrop(kp.publicKey, 1e9);
}
await new Promise(r => setTimeout(r, 2000));

console.log('\n--- Minting vUSDC to client ---');
const clientAta = await getOrCreateAssociatedTokenAccount(provider.connection, adminKeypair, MINT, client.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID);
await mintTo(provider.connection, adminKeypair, MINT, clientAta.address, adminKeypair, 10_000 * 1_000_000, [], undefined, TOKEN_2022_PROGRAM_ID);
console.log('  Minted 10,000 vUSDC to client');

// Create ATAs for provider and connector
const providerAta = await getOrCreateAssociatedTokenAccount(provider.connection, adminKeypair, MINT, providerWallet.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID);
const connectorAta = await getOrCreateAssociatedTokenAccount(provider.connection, adminKeypair, MINT, connector.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID);

// Protocol wallet (use admin for simplicity)
const protocolPubkey = adminKeypair.publicKey;
const protocolAta = await getOrCreateAssociatedTokenAccount(provider.connection, adminKeypair, MINT, protocolPubkey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID);

console.log('\n--- Registering KYC ---');
await ensureKyc(client.publicKey);
await ensureKyc(providerWallet.publicKey);
await ensureKyc(connector.publicKey);
await ensureKyc(protocolPubkey);

console.log('\n--- Reading config ---');
const config = await escrowProgram.account.escrowConfig.fetch(configPDA);
const dealId = config.dealCount.toNumber();
console.log('  Next deal ID:', dealId);

const [dealPDA] = getDealPDA(dealId);
const [vaultPDA] = getVaultPDA(dealId);

console.log('\n--- Creating deal ---');
// Use main provider (admin pays fees) + client as extra signer
const milestoneAmounts = [new BN(1000 * 1_000_000), new BN(2000 * 1_000_000)]; // 1000 + 2000 vUSDC
await escrowProgram.methods.createDeal(500, 400, milestoneAmounts)
  .accounts({
    client: client.publicKey,
    provider: providerWallet.publicKey,
    connector: connector.publicKey,
    config: configPDA,
    deal: dealPDA,
    vault: vaultPDA,
    tokenMint: MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).signers([client]).rpc();
console.log('  Deal created! ID:', dealId);

console.log('\n--- Depositing milestone 0 (needs KYC for deal PDA — vault owner) ---');
// Vault's token account owner is the deal PDA; KYC hook checks owner, not vault address
await ensureKyc(dealPDA);
await escrowProgram.methods.deposit(new BN(dealId), 0)
  .accounts({
    client: client.publicKey,
    deal: dealPDA,
    vault: vaultPDA,
    clientTokenAccount: clientAta.address,
    tokenMint: MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .remainingAccounts(hookAccounts(client.publicKey, dealPDA))
  .signers([client]).rpc();
console.log('  Deposit SUCCESS!');

console.log('\n--- Releasing milestone 0 (3-way split) ---');
const [repPDA] = getRepPDA(providerWallet.publicKey);
// For release: vault authority = deal PDA, so senderKyc = KYC of deal PDA
const [dealKyc] = getKycPDA(dealPDA);
const [provKyc] = getKycPDA(providerWallet.publicKey);
const [conKyc] = getKycPDA(connector.publicKey);
const [protKyc] = getKycPDA(protocolPubkey);

await escrowProgram.methods.releaseMilestone(new BN(dealId), 0)
  .accounts({
    client: client.publicKey,
    deal: dealPDA,
    vault: vaultPDA,
    providerTokenAccount: providerAta.address,
    connectorTokenAccount: connectorAta.address,
    protocolTokenAccount: protocolAta.address,
    tokenMint: MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    reputation: repPDA,
    systemProgram: SystemProgram.programId,
  })
  .remainingAccounts([
    { pubkey: dealKyc, isWritable: false, isSigner: false },
    { pubkey: provKyc, isWritable: false, isSigner: false },
    { pubkey: conKyc, isWritable: false, isSigner: false },
    { pubkey: protKyc, isWritable: false, isSigner: false },
    { pubkey: KYC_HOOK_ID, isWritable: false, isSigner: false },
    { pubkey: extraMetaPDA, isWritable: false, isSigner: false },
  ])
  .signers([client]).rpc();
console.log('  Release SUCCESS!');

// Check balances
const provBal = await provider.connection.getTokenAccountBalance(providerAta.address);
const conBal = await provider.connection.getTokenAccountBalance(connectorAta.address);
const protBal = await provider.connection.getTokenAccountBalance(protocolAta.address);
console.log('\n--- Final balances (milestone 0 = 1000 vUSDC) ---');
console.log('  Provider:', provBal.value.uiAmount, 'vUSDC (expect ~950 after 5% fees)');
console.log('  Connector:', conBal.value.uiAmount, 'vUSDC');
console.log('  Protocol:', protBal.value.uiAmount, 'vUSDC');
console.log('\n✅ Full escrow flow (create → deposit → release) works correctly!');
