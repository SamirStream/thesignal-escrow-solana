import React, { useState } from 'react';
import { Shield, ShieldCheck, ShieldX, Clock, Globe, AlertTriangle } from 'lucide-react';
import { Card, Button, Tag } from './ui/Components';
import { useKycStatus, getKycLevelLabel } from '../hooks/useKycStatus';
import { truncateAddress, getExplorerTxLink } from '../lib/solana';

interface KycVerificationProps {
  address: string;
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function KycVerification({ address, onToast }: KycVerificationProps) {
  const { kycData, isLoading, selfVerifyKyc } = useKycStatus();
  const [selectedLevel, setSelectedLevel] = useState(2);
  const [selectedCountry, setSelectedCountry] = useState('US');
  const [isVerifying, setIsVerifying] = useState(false);

  const handleVerify = async () => {
    setIsVerifying(true);
    try {
      const txHash = await selfVerifyKyc(selectedLevel, selectedCountry);
      onToast(`KYC verified! TX: ${txHash.slice(0, 8)}...`, 'success');
    } catch (err: any) {
      onToast(`KYC verification failed: ${err.message}`, 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  const isExpired = kycData ? kycData.expiresAt * 1000 < Date.now() : false;
  const expiresIn = kycData
    ? Math.max(0, Math.floor((kycData.expiresAt * 1000 - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 mb-4">
          <Shield className="w-8 h-8 text-emerald-400" />
          <h2 className="text-2xl font-display text-white">KYC Compliance</h2>
        </div>
        <p className="text-zinc-400 text-sm max-w-md mx-auto">
          All participants must complete KYC verification before transacting.
          Transfer Hook enforces compliance at the token level.
        </p>
      </div>

      {/* Current Status */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-white">Your KYC Status</h3>
          {kycData?.verified && !kycData.isBlocked && !isExpired ? (
            <Tag color="emerald">Verified</Tag>
          ) : kycData?.isBlocked ? (
            <Tag color="red">Blocked</Tag>
          ) : kycData && isExpired ? (
            <Tag color="amber">Expired</Tag>
          ) : (
            <Tag color="zinc">Unverified</Tag>
          )}
        </div>

        {!address ? (
          <div className="text-center py-8">
            <Shield className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-500">Connect your wallet to view KYC status</p>
          </div>
        ) : kycData?.verified ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
                <div className="flex items-center gap-2 text-zinc-400 text-xs mb-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>KYC Level</span>
                </div>
                <p className="text-white font-bold text-lg">
                  {getKycLevelLabel(kycData.kycLevel)}
                </p>
              </div>
              <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
                <div className="flex items-center gap-2 text-zinc-400 text-xs mb-2">
                  <Globe className="w-4 h-4" />
                  <span>Country</span>
                </div>
                <p className="text-white font-bold text-lg">
                  {kycData.countryCode}
                </p>
              </div>
              <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
                <div className="flex items-center gap-2 text-zinc-400 text-xs mb-2">
                  <Clock className="w-4 h-4" />
                  <span>Expires In</span>
                </div>
                <p className={`font-bold text-lg ${isExpired ? 'text-red-400' : expiresIn < 30 ? 'text-amber-400' : 'text-white'}`}>
                  {isExpired ? 'Expired' : `${expiresIn} days`}
                </p>
              </div>
              <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
                <div className="flex items-center gap-2 text-zinc-400 text-xs mb-2">
                  <Shield className="w-4 h-4" />
                  <span>Wallet</span>
                </div>
                <p className="text-white font-mono text-sm">
                  {truncateAddress(kycData.wallet)}
                </p>
              </div>
            </div>

            {kycData.isBlocked && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                <ShieldX className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-400 font-bold text-sm">Address Blocked (AML)</p>
                  <p className="text-red-400/70 text-xs mt-1">
                    This address has been flagged and cannot participate in transfers.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Verification Form */
          <div className="space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-400 font-bold text-sm">KYC Required</p>
                <p className="text-amber-400/70 text-xs mt-1">
                  You must verify your identity before depositing or receiving stablecoin payments.
                  The Transfer Hook will reject transactions from unverified wallets.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">
                Verification Level
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { level: 1, label: 'Basic', desc: 'Email + Phone' },
                  { level: 2, label: 'Enhanced', desc: 'Gov. ID + Address' },
                  { level: 3, label: 'Institutional', desc: 'Full Due Diligence' },
                ].map(({ level, label, desc }) => (
                  <button
                    key={level}
                    onClick={() => setSelectedLevel(level)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedLevel === level
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                        : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    <p className="font-bold text-sm">{label}</p>
                    <p className="text-xs opacity-70 mt-1">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">
                Country
              </label>
              <select
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="US">United States</option>
                <option value="CH">Switzerland</option>
                <option value="DE">Germany</option>
                <option value="GB">United Kingdom</option>
                <option value="SG">Singapore</option>
                <option value="JP">Japan</option>
                <option value="FR">France</option>
              </select>
            </div>

            <Button
              onClick={handleVerify}
              disabled={isVerifying || isLoading}
              icon={ShieldCheck}
              className="w-full"
            >
              {isVerifying ? 'Verifying...' : 'Verify KYC (Demo)'}
            </Button>

            <p className="text-zinc-600 text-xs text-center">
              In production, this would integrate with Civic Pass or a licensed KYC provider.
            </p>
          </div>
        )}
      </Card>

      {/* How it works */}
      <Card className="p-6">
        <h3 className="text-lg font-bold text-white mb-4">How Transfer Hook KYC Works</h3>
        <div className="space-y-3">
          {[
            { step: '1', title: 'Token Mint Created', desc: 'vUSDC mint includes Transfer Hook extension pointing to our KYC program' },
            { step: '2', title: 'KYC Registration', desc: 'Admin registers verified wallets on-chain with KYC level, country, and expiry' },
            { step: '3', title: 'Automatic Enforcement', desc: 'Every transfer_checked call triggers the hook — both sender AND receiver must be KYC verified' },
            { step: '4', title: 'AML Blocklist', desc: 'Blocked addresses fail instantly — no transfer possible even if previously verified' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <span className="text-emerald-400 font-bold text-sm">{step}</span>
              </div>
              <div>
                <p className="text-white font-bold text-sm">{title}</p>
                <p className="text-zinc-400 text-xs mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
