import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  Shield, FileText, LayoutDashboard, Award,
  X, ExternalLink, CheckCircle, AlertCircle, Info,
  Zap, Building2, Globe2, Lock
} from 'lucide-react';
import { SignalLogo, GlowingBackground } from './components/ui/Branding';
import { Card, Tag } from './components/ui/Components';
import { KycVerification } from './components/KycVerification';
import { useSolanaWallet } from './hooks/useSolanaWallet';
import { useDealEscrow, DealData } from './hooks/useDealEscrow';
import {
  truncateAddress,
  getExplorerTxLink,
  formatAmount,
  toContractAmount,
  isValidSolanaAddress,
  DECIMALS,
  NETWORK,
} from './lib/solana';
import { saveDealMetadata, recordMilestoneEvent } from './lib/dealMetadata';

// --- Toast System ---
interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastId = 0;

// --- Tabs ---
type TabId = 'compliance' | 'create' | 'deals' | 'oracle';

const TABS: { id: TabId; label: string; icon: typeof Shield }[] = [
  { id: 'compliance', label: 'Compliance', icon: Shield },
  { id: 'create', label: 'New Deal', icon: FileText },
  { id: 'deals', label: 'Deals', icon: LayoutDashboard },
  { id: 'oracle', label: 'Oracle', icon: Award },
];

export default function App() {
  const { connected } = useWallet();
  const wallet = useSolanaWallet();
  const escrow = useDealEscrow();

  const [activeTab, setActiveTab] = useState<TabId>('compliance');
  const [toasts, setToasts] = useState<Toast[]>([]);

  // --- Toast helpers ---
  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId;
    setToasts(prev => [...prev.slice(-2), { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // --- Deal creation state ---
  const [providerAddr, setProviderAddr] = useState('');
  const [connectorAddr, setConnectorAddr] = useState('');
  const [platformFee, setPlatformFee] = useState(10);
  const [connectorShare, setConnectorShare] = useState(40);
  const [milestones, setMilestones] = useState([
    { name: 'Phase 1', amount: 3000 },
    { name: 'Phase 2', amount: 5000 },
    { name: 'Phase 3', amount: 2000 },
  ]);
  const [dealTitle, setDealTitle] = useState('Security Audit');

  // --- Deal list state ---
  const [deals, setDeals] = useState<DealData[]>([]);
  const [selectedDeal, setSelectedDeal] = useState<DealData | null>(null);
  const [dealCount, setDealCount] = useState(0);

  // --- Reputation state ---
  const [repAddress, setRepAddress] = useState('');
  const [repScore, setRepScore] = useState<number | null>(null);

  // Fetch deals
  const refreshDeals = useCallback(async () => {
    if (!connected) return;
    try {
      const count = await escrow.getDealCount();
      setDealCount(count);
      const loaded: DealData[] = [];
      for (let i = 0; i < Math.min(count, 20); i++) {
        const deal = await escrow.getDeal(i);
        if (deal) loaded.push(deal);
      }
      setDeals(loaded);
    } catch (err) {
      console.error('Failed to fetch deals:', err);
    }
  }, [connected, escrow]);

  useEffect(() => {
    if (connected && activeTab === 'deals') {
      refreshDeals();
    }
  }, [connected, activeTab, refreshDeals]);

  // --- Create Deal ---
  const handleCreateDeal = async () => {
    if (!isValidSolanaAddress(providerAddr) || !isValidSolanaAddress(connectorAddr)) {
      addToast('Invalid Solana address', 'error');
      return;
    }
    try {
      const amounts = milestones.map(m => toContractAmount(m.amount));
      const { dealId, txHash } = await escrow.createDeal(
        providerAddr,
        connectorAddr,
        platformFee * 100, // bps
        connectorShare * 100, // bps
        amounts,
      );
      saveDealMetadata(dealId, {
        title: dealTitle,
        description: '',
        milestoneNames: milestones.map(m => m.name),
        createdAt: new Date().toISOString(),
        txHash,
      });
      addToast(`Deal #${dealId} created!`, 'success');
      setActiveTab('deals');
      refreshDeals();
    } catch (err: any) {
      addToast(`Failed: ${err.message}`, 'error');
    }
  };

  // --- Deposit ---
  const handleDeposit = async (dealId: number, milestoneIdx: number) => {
    try {
      const { txHash } = await escrow.deposit(dealId, milestoneIdx);
      recordMilestoneEvent(dealId, milestoneIdx, {
        action: 'funded',
        timestamp: new Date().toISOString(),
        txHash,
      });
      addToast(`Milestone ${milestoneIdx} funded!`, 'success');
      const updated = await escrow.getDeal(dealId);
      if (updated) setSelectedDeal(updated);
      refreshDeals();
    } catch (err: any) {
      addToast(`Deposit failed: ${err.message}`, 'error');
    }
  };

  // --- Release ---
  const handleRelease = async (deal: DealData, milestoneIdx: number) => {
    try {
      const { txHash } = await escrow.releaseMilestone(
        deal.dealId,
        milestoneIdx,
        deal.provider,
        deal.connector,
        deal.protocolWallet,
      );
      const amount = deal.milestones[milestoneIdx].amount;
      const fee = Math.floor(amount * deal.platformFeeBps / 10000);
      const connCut = Math.floor(fee * deal.connectorShareBps / 10000);

      recordMilestoneEvent(deal.dealId, milestoneIdx, {
        action: 'released',
        timestamp: new Date().toISOString(),
        txHash,
        split: {
          providerAmount: formatAmount(amount - fee),
          connectorAmount: formatAmount(connCut),
          protocolAmount: formatAmount(fee - connCut),
        },
      });
      addToast(`Milestone ${milestoneIdx} released with 3-way split!`, 'success');
      const updated = await escrow.getDeal(deal.dealId);
      if (updated) setSelectedDeal(updated);
      refreshDeals();
    } catch (err: any) {
      addToast(`Release failed: ${err.message}`, 'error');
    }
  };

  // --- Dispute ---
  const handleDispute = async (dealId: number, milestoneIdx: number) => {
    try {
      const { txHash } = await escrow.dispute(dealId, milestoneIdx);
      recordMilestoneEvent(dealId, milestoneIdx, {
        action: 'disputed',
        timestamp: new Date().toISOString(),
        txHash,
      });
      addToast('Dispute filed', 'info');
      const updated = await escrow.getDeal(dealId);
      if (updated) setSelectedDeal(updated);
      refreshDeals();
    } catch (err: any) {
      addToast(`Dispute failed: ${err.message}`, 'error');
    }
  };

  // --- Reputation Lookup ---
  const handleRepLookup = async () => {
    if (!isValidSolanaAddress(repAddress)) {
      addToast('Invalid address', 'error');
      return;
    }
    try {
      const { PublicKey } = await import('@solana/web3.js');
      const score = await escrow.getReputation(new PublicKey(repAddress));
      setRepScore(score);
    } catch {
      setRepScore(0);
    }
  };

  const statusColor = (status: string): 'emerald' | 'amber' | 'red' | 'blue' | 'zinc' => {
    switch (status) {
      case 'Active': return 'emerald';
      case 'Created': return 'blue';
      case 'Completed': return 'emerald';
      case 'Disputed': return 'red';
      case 'Cancelled': return 'zinc';
      default: return 'zinc';
    }
  };

  const milestoneStatusColor = (status: string): string => {
    switch (status) {
      case 'Funded': return 'text-emerald-400';
      case 'Released': return 'text-green-300';
      case 'Pending': return 'text-zinc-500';
      case 'Disputed': return 'text-red-400';
      case 'Refunded': return 'text-amber-400';
      default: return 'text-zinc-500';
    }
  };

  return (
    <div className="min-h-screen relative">
      <GlowingBackground />

      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-2xl animate-fade-in max-w-sm ${
              toast.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : toast.type === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle size={16} /> : toast.type === 'error' ? <AlertCircle size={16} /> : <Info size={16} />}
            <span className="text-sm font-medium flex-1">{toast.message}</span>
            <button onClick={() => removeToast(toast.id)} className="opacity-50 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-zinc-800/60">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SignalLogo className="w-10 h-10" />
            <div>
              <h1 className="text-xl font-display text-white tracking-tight">
                The Signal Escrow
              </h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/60">
                Institutional Stablecoin Escrow on Solana
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {connected && (
              <div className="hidden md:flex items-center gap-3 text-xs text-zinc-400">
                <span>{wallet.solBalance} SOL</span>
                <span className="text-emerald-400">{wallet.usdcBalance} vUSDC</span>
              </div>
            )}
            <Tag color="blue">{NETWORK}</Tag>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* Feature Banner */}
      <div className="relative z-10 bg-gradient-to-r from-emerald-500/5 via-transparent to-emerald-500/5 border-b border-zinc-800/30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-center gap-6 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5"><Lock size={12} className="text-emerald-400" /> Transfer Hook KYC</span>
          <span className="flex items-center gap-1.5"><Zap size={12} className="text-emerald-400" /> Atomic 3-Way Split</span>
          <span className="flex items-center gap-1.5"><Building2 size={12} className="text-emerald-400" /> Token-2022 Compliance</span>
          <span className="flex items-center gap-1.5"><Globe2 size={12} className="text-emerald-400" /> Travel Rule Ready</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="relative z-10 border-b border-zinc-800/60">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'border-emerald-400 text-emerald-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 py-8">
        {!connected ? (
          <div className="text-center py-20">
            <SignalLogo className="w-20 h-20 mx-auto mb-6 opacity-50" />
            <h2 className="text-2xl font-display text-white mb-3">Connect Your Wallet</h2>
            <p className="text-zinc-400 mb-8 max-w-md mx-auto">
              Connect a Solana wallet (Phantom or Solflare) to start using
              The Signal Escrow on {NETWORK}.
            </p>
            <WalletMultiButton />
          </div>
        ) : activeTab === 'compliance' ? (
          <KycVerification address={wallet.address} onToast={addToast} />
        ) : activeTab === 'create' ? (
          /* --- CREATE DEAL TAB --- */
          <div className="max-w-2xl mx-auto space-y-6">
            <Card className="p-6">
              <h2 className="text-xl font-display text-white mb-6">Create New Deal</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">Deal Title</label>
                  <input
                    type="text"
                    value={dealTitle}
                    onChange={e => setDealTitle(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500"
                    placeholder="Security Audit"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">Provider Address</label>
                  <input
                    type="text"
                    value={providerAddr}
                    onChange={e => setProviderAddr(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="Provider Solana address..."
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">Connector (BD) Address</label>
                  <input
                    type="text"
                    value={connectorAddr}
                    onChange={e => setConnectorAddr(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="Connector Solana address..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">Platform Fee (%)</label>
                    <input
                      type="number"
                      value={platformFee}
                      onChange={e => setPlatformFee(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500"
                      min={0} max={100}
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">Connector Share (%)</label>
                    <input
                      type="number"
                      value={connectorShare}
                      onChange={e => setConnectorShare(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500"
                      min={0} max={100}
                    />
                  </div>
                </div>

                {/* Milestones */}
                <div>
                  <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">
                    Milestones ({milestones.length})
                  </label>
                  <div className="space-y-2">
                    {milestones.map((m, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="text"
                          value={m.name}
                          onChange={e => {
                            const updated = [...milestones];
                            updated[i].name = e.target.value;
                            setMilestones(updated);
                          }}
                          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                          placeholder="Milestone name"
                        />
                        <input
                          type="number"
                          value={m.amount}
                          onChange={e => {
                            const updated = [...milestones];
                            updated[i].amount = Number(e.target.value);
                            setMilestones(updated);
                          }}
                          className="w-32 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                          placeholder="Amount"
                          min={1}
                        />
                        <button
                          onClick={() => setMilestones(milestones.filter((_, idx) => idx !== i))}
                          className="text-zinc-600 hover:text-red-400 p-2"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setMilestones([...milestones, { name: `Phase ${milestones.length + 1}`, amount: 1000 }])}
                      className="text-emerald-400 text-sm hover:text-emerald-300"
                    >
                      + Add Milestone
                    </button>
                  </div>
                </div>

                {/* Fee Breakdown */}
                <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800 text-sm">
                  <p className="text-zinc-400 text-xs uppercase tracking-wider mb-3">Fee Breakdown per Milestone Release</p>
                  <div className="space-y-1 text-zinc-300">
                    <p>Provider: <span className="text-white font-bold">{100 - platformFee}%</span></p>
                    <p>Connector (BD): <span className="text-white font-bold">{(platformFee * connectorShare / 100).toFixed(1)}%</span></p>
                    <p>Protocol: <span className="text-white font-bold">{(platformFee * (100 - connectorShare) / 100).toFixed(1)}%</span></p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-zinc-800">
                    <p className="text-zinc-400">Total Deal Value: <span className="text-emerald-400 font-bold">{milestones.reduce((s, m) => s + m.amount, 0).toLocaleString()} vUSDC</span></p>
                  </div>
                </div>

                <button
                  onClick={handleCreateDeal}
                  disabled={escrow.isProcessing}
                  className="w-full bg-emerald-500 text-[#02040a] font-bold py-4 rounded-xl hover:shadow-[0_0_35px_rgba(16,185,129,0.5)] transition-all disabled:opacity-50"
                >
                  {escrow.isProcessing ? 'Creating Deal...' : 'Create Deal'}
                </button>
              </div>
            </Card>
          </div>
        ) : activeTab === 'deals' ? (
          /* --- DEALS TAB --- */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Deal List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-display text-white">Deals ({dealCount})</h2>
                <button onClick={refreshDeals} className="text-emerald-400 text-xs hover:text-emerald-300">
                  Refresh
                </button>
              </div>
              {deals.length === 0 ? (
                <Card className="p-8 text-center">
                  <p className="text-zinc-500">No deals yet</p>
                </Card>
              ) : (
                deals.map(deal => (
                  <Card
                    key={deal.dealId}
                    className={`p-4 cursor-pointer ${selectedDeal?.dealId === deal.dealId ? 'border-emerald-500/50' : ''}`}
                    hoverEffect
                    onClick={() => setSelectedDeal(deal)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-bold">Deal #{deal.dealId}</span>
                      <Tag color={statusColor(deal.status)}>{deal.status}</Tag>
                    </div>
                    <p className="text-zinc-400 text-xs">
                      {formatAmount(deal.totalAmount)} vUSDC | {deal.milestoneCount} milestones
                    </p>
                    <p className="text-zinc-600 text-xs mt-1 font-mono">
                      Provider: {truncateAddress(deal.provider)}
                    </p>
                  </Card>
                ))
              )}
            </div>

            {/* Deal Detail */}
            <div className="lg:col-span-2">
              {selectedDeal ? (
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-xl font-display text-white">Deal #{selectedDeal.dealId}</h3>
                      <p className="text-zinc-400 text-sm">{formatAmount(selectedDeal.totalAmount)} vUSDC total</p>
                    </div>
                    <Tag color={statusColor(selectedDeal.status)}>{selectedDeal.status}</Tag>
                  </div>

                  {/* Participants */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    {[
                      { role: 'Client', addr: selectedDeal.client },
                      { role: 'Provider', addr: selectedDeal.provider },
                      { role: 'Connector', addr: selectedDeal.connector },
                    ].map(({ role, addr }) => (
                      <div key={role} className="bg-zinc-900/50 rounded-xl p-3 border border-zinc-800">
                        <p className="text-zinc-500 text-xs mb-1">{role}</p>
                        <p className="text-white font-mono text-xs">{truncateAddress(addr)}</p>
                        {addr === wallet.address && (
                          <Tag color="emerald" className="mt-1">You</Tag>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Fee Structure */}
                  <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800 mb-6">
                    <p className="text-zinc-400 text-xs uppercase tracking-wider mb-2">Fee Structure</p>
                    <p className="text-zinc-300 text-sm">
                      Platform: {selectedDeal.platformFeeBps / 100}% |
                      Connector Share: {selectedDeal.connectorShareBps / 100}% of fee
                    </p>
                  </div>

                  {/* Milestones */}
                  <h4 className="text-white font-bold mb-3">Milestones</h4>
                  <div className="space-y-3">
                    {selectedDeal.milestones.map((m, i) => (
                      <div key={i} className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800 flex items-center justify-between">
                        <div>
                          <p className="text-white font-medium">
                            Milestone {i} — {formatAmount(m.amount)} vUSDC
                          </p>
                          <p className={`text-xs font-bold uppercase ${milestoneStatusColor(m.status)}`}>
                            {m.status}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {m.status === 'Pending' && selectedDeal.client === wallet.address && (
                            <button
                              onClick={() => handleDeposit(selectedDeal.dealId, i)}
                              disabled={escrow.isProcessing}
                              className="px-4 py-2 bg-emerald-500 text-[#02040a] rounded-lg text-xs font-bold hover:shadow-lg disabled:opacity-50"
                            >
                              Deposit
                            </button>
                          )}
                          {m.status === 'Funded' && selectedDeal.client === wallet.address && (
                            <>
                              <button
                                onClick={() => handleRelease(selectedDeal, i)}
                                disabled={escrow.isProcessing}
                                className="px-4 py-2 bg-emerald-500 text-[#02040a] rounded-lg text-xs font-bold hover:shadow-lg disabled:opacity-50"
                              >
                                Release
                              </button>
                              <button
                                onClick={() => handleDispute(selectedDeal.dealId, i)}
                                disabled={escrow.isProcessing}
                                className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold hover:bg-red-500/20 disabled:opacity-50"
                              >
                                Dispute
                              </button>
                            </>
                          )}
                          {m.status === 'Funded' && selectedDeal.provider === wallet.address && (
                            <button
                              onClick={() => handleDispute(selectedDeal.dealId, i)}
                              disabled={escrow.isProcessing}
                              className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold hover:bg-red-500/20 disabled:opacity-50"
                            >
                              Dispute
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : (
                <Card className="p-12 text-center">
                  <LayoutDashboard className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                  <p className="text-zinc-500">Select a deal to view details</p>
                </Card>
              )}
            </div>
          </div>
        ) : activeTab === 'oracle' ? (
          /* --- ORACLE TAB --- */
          <div className="max-w-lg mx-auto space-y-6">
            <Card className="p-6">
              <h2 className="text-xl font-display text-white mb-6">On-Chain Reputation Oracle</h2>
              <p className="text-zinc-400 text-sm mb-6">
                Immutable on-chain counter. Increments only when all milestones
                in a deal are released. Cannot be faked.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={repAddress}
                  onChange={e => setRepAddress(e.target.value)}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="Provider address..."
                />
                <button
                  onClick={handleRepLookup}
                  className="px-6 py-3 bg-emerald-500 text-[#02040a] rounded-xl font-bold hover:shadow-lg"
                >
                  Lookup
                </button>
              </div>
              {repScore !== null && (
                <div className="mt-6 text-center bg-zinc-900/50 rounded-xl p-8 border border-zinc-800">
                  <p className="text-5xl font-display text-emerald-400 mb-2">{repScore}</p>
                  <p className="text-zinc-400 text-sm">Completed Deals</p>
                  <p className="text-zinc-600 text-xs mt-2 font-mono">{truncateAddress(repAddress)}</p>
                </div>
              )}
            </Card>
          </div>
        ) : null}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-zinc-800/60 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between text-xs text-zinc-600">
          <span>The Signal Escrow | StableHacks 2026 | Track 3: Programmable Stablecoin Payments</span>
          <span className="flex items-center gap-2">
            Built with Anchor + Token-2022
            <ExternalLink size={12} />
          </span>
        </div>
      </footer>
    </div>
  );
}
