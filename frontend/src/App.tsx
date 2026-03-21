import { useState, useCallback, useContext, createContext, useRef, useEffect } from 'react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import {
  Award, Zap, ArrowRightLeft,
  Shield, FileText, LayoutDashboard,
  Network, Cpu, Lock, Plus, X,
  TerminalSquare, Activity, Globe2,
  Copy, Check, LogOut, Building2,
  ExternalLink, CheckCircle, AlertCircle, Info,
} from 'lucide-react';
import { SignalLogo, GlowingBackground } from './components/ui/Branding';
import { Card, Button, Tag } from './components/ui/Components';
import { ShortcutModal } from './components/ui/ShortcutModal';
import { KycVerification } from './components/KycVerification';
import { ComplianceDashboard } from './components/ComplianceDashboard';
import { BlocklistDemo } from './components/BlocklistDemo';
import { CreateDeal } from './components/CreateDeal';
import { DealDashboard } from './components/DealDashboard';
import { ReputationBadge } from './components/ReputationBadge';
import { WalletConnectModal } from './components/WalletConnectModal';
import { useUnifiedWallet } from './components/UnifiedWalletProvider';
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

/* ============================================
   Toast Notification System (with exit anim)
   ============================================ */
type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; type: ToastType; exiting?: boolean }

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});
export const useToast = () => useContext(ToastContext);

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-16 lg:bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t, i) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border backdrop-blur-md max-w-sm cursor-pointer ${
            t.exiting ? 'animate-slide-out-right' : 'animate-slide-in-right'
          } ${
            t.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
            t.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
            'bg-zinc-800/80 border-zinc-700 text-zinc-300'
          }`}
          style={{ animationDelay: `${i * 50}ms` }}
          onClick={() => onDismiss(t.id)}
        >
          {t.type === 'success' ? <CheckCircle size={16} /> : t.type === 'error' ? <AlertCircle size={16} /> : <Info size={16} />}
          <span className="text-sm font-medium flex-1">{t.message}</span>
          <button type="button" className="opacity-50 hover:opacity-100" title="Dismiss"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/* ============================================
   Live Network Ticker (real on-chain data)
   ============================================ */
interface TickerItem { label: string; amount: string; type: string }

const STATUS_ACTION_MAP: Record<string, string> = {
  Created: 'AWAITING_FUNDING',
  Active: 'ESCROW_ACTIVE',
  Completed: 'DEAL_COMPLETED',
  Cancelled: 'DEAL_CANCELLED',
  Disputed: 'DISPUTE_OPEN',
};

const TICKER_TYPE_COLORS: Record<string, string> = {
  DEAL_COMPLETED:     'text-emerald-400',
  MILESTONE_RELEASED: 'text-emerald-400',
  ESCROW_ACTIVE:      'text-blue-400',
  MILESTONE_FUNDED:   'text-blue-400',
  AWAITING_FUNDING:   'text-amber-400',
  DISPUTE_OPEN:       'text-red-400',
  DEAL_CANCELLED:     'text-zinc-600',
};

function dealToTickerItems(deal: DealData): TickerItem[] {
  const idLabel = `DEAL #${String(deal.dealId).padStart(3, '0')}`;
  const usdcStr = formatAmount(deal.totalAmount);
  const items: TickerItem[] = [
    { label: idLabel, amount: usdcStr, type: STATUS_ACTION_MAP[deal.status] || deal.status.toUpperCase() },
  ];
  deal.milestones.forEach((m, i) => {
    if (m.status === 'Released' || m.status === 'Funded') {
      items.push({
        label: `${idLabel} · MS${i + 1}`,
        amount: formatAmount(m.amount),
        type: m.status === 'Released' ? 'MILESTONE_RELEASED' : 'MILESTONE_FUNDED',
      });
    }
  });
  return items;
}

function LiveTicker({ items }: { items: TickerItem[] }) {
  const doubled = [...items, ...items];
  return (
    <div className="w-full bg-[#050505] border-b border-zinc-900 flex items-center h-9 overflow-hidden text-[10px] font-mono font-bold uppercase tracking-widest relative z-40">
      <div className="bg-emerald-500 text-[#010205] h-full px-4 flex items-center justify-center shrink-0 shadow-[10px_0_20px_rgba(0,0,0,0.9)]">
        <Activity size={11} className="mr-2 animate-pulse" />
        Live Network
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="flex whitespace-nowrap animate-marquee w-max">
          {doubled.map((item, i) => (
            <div key={i} className="flex items-center gap-4 px-8">
              <span className="text-zinc-500">{item.label}</span>
              <span className={TICKER_TYPE_COLORS[item.type] ?? 'text-zinc-600'}>{item.type}</span>
              <span className="text-zinc-300 font-bold">{item.amount} vUSDC</span>
              <span className="text-zinc-800">&middot;</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================
   Tab Configuration
   ============================================ */
type TabId = 'compliance' | 'create' | 'deals' | 'oracle';

const TABS: { id: TabId; label: string; mobileLabel: string; icon: any }[] = [
  { id: 'compliance', label: 'Compliance', mobileLabel: 'KYC', icon: Shield },
  { id: 'create', label: 'Deploy Contract', mobileLabel: 'Deploy', icon: Plus },
  { id: 'deals', label: 'Deals', mobileLabel: 'Deals', icon: TerminalSquare },
  { id: 'oracle', label: 'Oracle', mobileLabel: 'Oracle', icon: Award },
];

/* ============================================
   Landing Page View (pre-connect)
   ============================================ */
function LandingView({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[85vh] text-center px-2 sm:px-4 animate-fade-in relative z-10 pt-6 lg:pt-10">
      {/* Network badge */}
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/50 border border-emerald-500/20 text-emerald-400 mb-8 lg:mb-12 backdrop-blur-md shadow-[0_0_20px_rgba(16,185,129,0.1)] hover:border-emerald-500/50 transition-colors cursor-default">
        <span className="relative flex h-2.5 w-2.5 lg:h-3 lg:w-3 mr-1">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 lg:h-3 lg:w-3 bg-emerald-500" />
        </span>
        <span className="text-[9px] lg:text-[10px] font-black tracking-[0.2em] lg:tracking-[0.3em] uppercase">Solana {NETWORK}</span>
      </div>

      {/* Hero */}
      <div className="glitch-wrapper relative mb-6 lg:mb-10">
        <h1
          className="glitch-text text-[3rem] sm:text-[4.5rem] md:text-[6rem] lg:text-[10rem] xl:text-[12rem] 2xl:text-[14rem] font-black text-white tracking-tighter leading-[0.9]"
          data-text="Trust Engine."
        >
          Trust Engine.
        </h1>
      </div>

      <p className="text-base lg:text-xl text-zinc-400 max-w-2xl mb-8 lg:mb-14 leading-relaxed font-light px-2">
        Institutional stablecoin escrow with KYC-gated transfers, atomic 3-party splits,
        and on-chain reputation.{' '}
        <span className="text-white font-medium border-b border-zinc-600 pb-0.5">Compliance is Law.</span>
      </p>

      {/* CTA */}
      <div className="flex flex-col sm:flex-row gap-4 lg:gap-6 mb-10 lg:mb-16 relative w-full sm:w-auto px-2 sm:px-0">
        <div className="absolute -inset-6 bg-emerald-500/10 blur-3xl rounded-full pointer-events-none" />
        <Button onClick={onConnect} variant="primary" className="px-8 lg:px-10 py-4 lg:py-5 w-full sm:w-auto relative z-10" icon={TerminalSquare}>
          Connect Wallet
        </Button>
        <a href="https://github.com/SamirStream/The-Signal-Escrow-Institutional-Stablecoin-Escrow-on-Solana" target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto relative z-10">
          <Button variant="secondary" className="px-8 lg:px-10 py-4 lg:py-5 w-full h-full" icon={Globe2}>
            Read the Docs
          </Button>
        </a>
      </div>

      {/* Scroll affordance */}
      <div className="hidden lg:flex flex-col items-center gap-2 mb-12 xl:mb-20 animate-bounce-down">
        <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-600 font-bold">Scroll to explore</span>
        <svg width="20" height="20" viewBox="0 0 20 20" className="text-zinc-600">
          <path d="M10 4 L10 14 M5 10 L10 15 L15 10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-6 xl:gap-8 2xl:gap-10 w-full max-w-7xl relative">
        <div className="hidden md:block absolute top-1/2 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent -translate-y-1/2 z-0" />

        {[
          { icon: Lock, title: "Transfer Hook KYC", desc: "Every token movement verified by on-chain KYC compliance layer.", color: "text-emerald-400" },
          { icon: Network, title: "Atomic 3-Way Split", desc: "Provider, connector & protocol paid in a single indivisible transaction.", color: "text-emerald-300" },
          { icon: Cpu, title: "On-Chain Reputation", desc: "Immutable trust score generated by completed escrow milestones.", color: "text-green-400" },
          { icon: Shield, title: "Travel Rule Ready", desc: "Hashed PII records for FATF Travel Rule compliance on deals >= $3,000.", color: "text-emerald-500" },
        ].map((feature, idx) => (
          <Card key={idx} className="p-4 lg:p-8 xl:p-10 text-left z-10 bg-[#09090b] shadow-xl" hoverEffect glowOnHover>
            <div className="w-10 h-10 lg:w-14 lg:h-14 rounded-xl lg:rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3 lg:mb-6 shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]">
              <feature.icon size={20} className={`${feature.color} lg:!w-7 lg:!h-7`} />
            </div>
            <h3 className="text-sm lg:text-xl font-bold text-white mb-1.5 lg:mb-3 tracking-tight">{feature.title}</h3>
            <p className="text-zinc-400 text-xs lg:text-sm leading-relaxed font-medium">{feature.desc}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================================
   Main App
   ============================================ */
export default function App() {
  const wallet = useUnifiedWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const escrow = useDealEscrow();

  const [activeTab, setActiveTab] = useState<TabId>('compliance');
  const [lastCreatedDealId, setLastCreatedDealId] = useState<number | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  // --- Toast system with exit animation ---
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev.slice(-2), { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t)), 4500);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
  }, []);

  // --- Live Ticker (fetched on mount, read-only) ---
  const [tickerItems, setTickerItems] = useState<TickerItem[]>([]);
  const escrowRef = useRef(escrow);
  useEffect(() => { escrowRef.current = escrow; });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const count = await escrowRef.current.getDealCount();
        if (count === 0 || cancelled) return;
        const n = Math.min(count, 10);
        const start = Math.max(0, count - n);
        const results = await Promise.allSettled(
          Array.from({ length: n }, (_, i) => escrowRef.current.getDeal(start + i))
        );
        const newItems: TickerItem[] = results.flatMap((r) => {
          if (r.status !== 'fulfilled' || !r.value) return [];
          return dealToTickerItems(r.value);
        });
        if (!cancelled && newItems.length > 0) setTickerItems(newItems);
      } catch { /* chain not reachable */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- Keyboard shortcuts (Alt+1-4 tabs, ? cheat sheet) ---
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // ? key → toggle shortcut cheat sheet (skip if typing in input)
      if (e.key === '?' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          e.preventDefault();
          setShortcutsOpen(prev => !prev);
          return;
        }
      }
      if (!e.altKey || !wallet.isConnected) return;
      const tabMap: Record<string, TabId> = { '1': 'compliance', '2': 'create', '3': 'deals', '4': 'oracle' };
      const tab = tabMap[e.key];
      if (tab) { e.preventDefault(); setActiveTab(tab); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [wallet.isConnected]);

  // --- Scroll progress bar ---
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(docHeight > 0 ? (scrollTop / docHeight) * 100 : 0);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // --- Callback wrappers for extracted components ---
  const handleCreateDeal = useCallback(async (
    provider: string,
    connector: string,
    platformFeeBps: number,
    connectorShareBps: number,
    milestoneAmounts: number[],
  ) => {
    const result = await escrow.createDeal(provider, connector, platformFeeBps, connectorShareBps, milestoneAmounts);
    addToast(`Deal #${result.dealId} deployed on-chain!`, 'success');
    return result;
  }, [escrow, addToast]);

  const handleDealCreated = useCallback((dealId: number) => {
    setLastCreatedDealId(dealId);
    setActiveTab('deals');
  }, []);

  const handleDeposit = useCallback(async (dealId: number, milestoneIdx: number) => {
    const result = await escrow.deposit(dealId, milestoneIdx);
    recordMilestoneEvent(dealId, milestoneIdx, {
      action: 'funded', timestamp: new Date().toISOString(), txHash: result.txHash,
    });
    addToast(`Milestone ${milestoneIdx + 1} funded!`, 'success');
    return result;
  }, [escrow, addToast]);

  const handleRelease = useCallback(async (
    dealId: number,
    milestoneIdx: number,
    provider: string,
    connector: string,
    protocolWallet: string,
  ) => {
    const result = await escrow.releaseMilestone(dealId, milestoneIdx, provider, connector, protocolWallet);
    recordMilestoneEvent(dealId, milestoneIdx, {
      action: 'released', timestamp: new Date().toISOString(), txHash: result.txHash,
    });
    addToast(`Milestone ${milestoneIdx + 1} released with atomic 3-way split!`, 'success');
    return result;
  }, [escrow, addToast]);

  const handleDispute = useCallback(async (dealId: number, milestoneIdx: number) => {
    const result = await escrow.dispute(dealId, milestoneIdx);
    recordMilestoneEvent(dealId, milestoneIdx, {
      action: 'disputed', timestamp: new Date().toISOString(), txHash: result.txHash,
    });
    addToast('Dispute filed on-chain', 'info');
    return result;
  }, [escrow, addToast]);

  const handleGetReputation = useCallback(async (address: string) => {
    return escrow.getReputation(new PublicKey(address));
  }, [escrow]);

  // --- Wallet chip ---
  const truncWallet = wallet.address ? `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}` : '';
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!wallet.address) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [wallet.address]);

  const handleWalletConnect = useCallback(() => {
    setIsConnectModalOpen(true);
  }, []);

  // --- Animated tab underline measurement ---
  const tabNavRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    compliance: null, create: null, deals: null, oracle: null,
  });
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  useEffect(() => {
    const el = tabRefs.current[activeTab];
    const nav = tabNavRef.current;
    if (el && nav) {
      setUnderline({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [activeTab]);

  return (
    <ToastContext.Provider value={addToast}>
      <div className="min-h-screen bg-[#02040a] text-zinc-200 selection:bg-emerald-500/30 overflow-x-hidden relative flex flex-col">
        {/* Scroll progress bar */}
        <div className="scroll-progress" style={{ width: `${scrollProgress}%` }} />
        <GlowingBackground />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />

        {/* Live Ticker — homepage only */}
        {!wallet.isConnected && tickerItems.length > 0 && <LiveTicker items={tickerItems} />}

        {/* Header */}
        <header className="relative z-50 border-b border-zinc-800/80 bg-[#02040a]/80 backdrop-blur-2xl sticky top-0">
          <div className="max-w-[90rem] mx-auto px-3 lg:px-6 h-14 lg:h-20 flex items-center justify-between">
            {/* Logo */}
            <a href="https://thesignal.directory" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 lg:gap-4 cursor-pointer group">
              <SignalLogo className="w-8 h-8 lg:w-10 lg:h-10" />
              <div className="flex flex-col">
                <span className="font-display text-lg lg:text-2xl text-white group-hover:text-emerald-400 transition-colors leading-none">THE SIGNAL</span>
                <span className="hidden lg:block text-[9px] font-mono text-zinc-500 uppercase tracking-[0.3em] mt-0.5">Institutional Escrow</span>
              </div>
            </a>

            {wallet.isConnected ? (
              <div className="flex items-center gap-6">
                {/* Desktop tabs in header — animated underline */}
                <nav ref={tabNavRef} className="hidden lg:flex gap-1.5 relative pb-0.5">
                  {TABS.map((tab, i) => (
                    <button
                      key={tab.id}
                      ref={(el) => { tabRefs.current[tab.id] = el; }}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-t-xl text-[10px] xl:text-[11px] font-black uppercase tracking-[0.15em] transition-all duration-300 ${
                        activeTab === tab.id
                          ? 'text-emerald-400'
                          : 'text-zinc-500 hover:text-white'
                      }`}
                    >
                      <tab.icon size={14} />
                      {tab.label}
                      <span className="hidden xl:inline text-zinc-700 text-[8px] font-mono ml-0.5">Alt+{i + 1}</span>
                    </button>
                  ))}
                  {/* Sliding underline */}
                  <div
                    className="absolute bottom-0 h-0.5 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.6)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ left: underline.left, width: underline.width }}
                  />
                </nav>

                {/* Connected Wallet Chip */}
                <div className="flex items-center gap-2 lg:gap-3 bg-[#09090b] border border-zinc-800/80 rounded-xl lg:rounded-2xl pl-3 lg:pl-4 pr-1 lg:pr-1.5 py-1 lg:py-1.5 shadow-xl">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-xs font-mono text-emerald-400 font-bold">{wallet.solBalance} SOL</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
                        {wallet.activeSource === 'privy' ? 'Privy' : 'Extension'}
                      </span>
                      <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">{NETWORK}</span>
                    </div>
                  </div>
                  <div className="bg-[#02040a] text-emerald-100 text-xs font-mono font-bold px-2 lg:px-3 py-2 lg:py-2.5 rounded-lg lg:rounded-xl border border-zinc-800 shadow-[inset_0_0_10px_rgba(16,185,129,0.05)] flex items-center gap-1.5 lg:gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] shrink-0 animate-pulse-ring" />
                    <button onClick={handleCopy} title="Copy address" className="flex items-center gap-1.5 hover:text-emerald-400 transition-colors">
                      {truncWallet}
                      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} className="text-zinc-600" />}
                    </button>
                    <span className="w-px h-4 bg-zinc-800 mx-0.5" />
                    <button
                      onClick={() => wallet.disconnect()}
                      title="Disconnect wallet"
                      className="flex items-center gap-1 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all px-1.5 lg:px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                    >
                      <LogOut size={12} />
                      <span className="hidden lg:inline">Disconnect</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Tag color="blue">{NETWORK}</Tag>
                <Button onClick={handleWalletConnect} variant="primary" className="px-4 py-2 text-xs" icon={TerminalSquare}>
                  Connect Wallet
                </Button>
              </div>
            )}
          </div>
        </header>

        {/* Feature Banner (when connected) */}
        {wallet.isConnected && (
          <div className="relative z-10 bg-gradient-to-r from-emerald-500/5 via-transparent to-emerald-500/5 border-b border-zinc-800/30">
            <div className="max-w-[90rem] mx-auto px-4 py-2.5 flex items-center justify-center gap-6 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <span className="flex items-center gap-1.5"><Lock size={11} className="text-emerald-400" /> Transfer Hook KYC</span>
              <span className="hidden sm:flex items-center gap-1.5"><Zap size={11} className="text-emerald-400" /> Atomic 3-Way Split</span>
              <span className="hidden md:flex items-center gap-1.5"><Building2 size={11} className="text-emerald-400" /> Token-2022</span>
              <span className="hidden lg:flex items-center gap-1.5"><Shield size={11} className="text-emerald-400" /> Travel Rule</span>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="relative z-10 max-w-[90rem] mx-auto px-3 sm:px-4 lg:px-6 xl:px-10 2xl:px-16 py-4 lg:py-10 xl:py-14 flex-1 w-full pb-20 lg:pb-0">
          {!wallet.isConnected ? (
            <LandingView onConnect={handleWalletConnect} />
          ) : activeTab === 'compliance' ? (
            <div className="space-y-8 animate-fade-in">
              <KycVerification address={wallet.address} onToast={addToast} />
              <ComplianceDashboard />
              <BlocklistDemo onToast={addToast} />
            </div>
          ) : activeTab === 'create' ? (
            <CreateDeal
              onCreateDeal={handleCreateDeal}
              onDealCreated={handleDealCreated}
            />
          ) : activeTab === 'deals' ? (
            <DealDashboard
              getDeal={escrow.getDeal}
              getDealCount={escrow.getDealCount}
              onDeposit={handleDeposit}
              onRelease={handleRelease}
              onDispute={handleDispute}
              walletAddress={wallet.address}
              solBalance={wallet.solBalance}
              initialDealId={lastCreatedDealId}
              onNavigateToCreate={() => setActiveTab('create')}
            />
          ) : activeTab === 'oracle' ? (
            <ReputationBadge
              getReputation={handleGetReputation}
              getDealCount={escrow.getDealCount}
              getDeal={escrow.getDeal}
              walletAddress={wallet.address}
            />
          ) : null}
        </main>

        {/* Footer */}
        <footer className="relative z-10 border-t border-zinc-800/80 py-6 lg:py-10 bg-[#02040a]/90 backdrop-blur-xl mt-auto mb-16 lg:mb-0">
          <div className="max-w-[90rem] mx-auto px-3 lg:px-6 grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-10 xl:gap-16 opacity-80 hover:opacity-100 transition-opacity">
            {/* Left */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <SignalLogo className="w-8 h-8 grayscale opacity-70" />
                <div>
                  <span className="block font-bold text-sm text-white">The Signal Escrow</span>
                  <span className="block text-xs text-zinc-500">Institutional Stablecoin Escrow</span>
                </div>
              </div>
              <p className="text-xs text-zinc-600">
                &copy; {new Date().getFullYear()} The Signal. StableHacks 2026 — Track 3.
              </p>
            </div>

            {/* Middle Links */}
            <div className="flex gap-8 lg:gap-16 justify-center text-sm">
              <div className="flex flex-col gap-3">
                <span className="font-bold text-zinc-400 uppercase tracking-widest text-[10px]">Protocol</span>
                <a href="https://explorer.solana.com/?cluster=devnet" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors flex items-center gap-1">
                  Solana Explorer <ExternalLink size={10} />
                </a>
                <a href="https://solana.com/docs/advanced/token-extensions" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors">
                  Token-2022 Docs
                </a>
              </div>
              <div className="flex flex-col gap-3">
                <span className="font-bold text-zinc-400 uppercase tracking-widest text-[10px]">Ecosystem</span>
                <a href="https://thesignal.directory" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors">
                  The Signal Directory
                </a>
                <a href="https://www.anchor-lang.com" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors">
                  Anchor Framework
                </a>
              </div>
            </div>

            {/* Right Socials */}
            <div className="flex flex-col items-end gap-4 justify-center md:items-end">
              <div className="flex gap-3">
                <a href="https://x.com/thesignaldir" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-all duration-300 p-2.5 lg:p-3 bg-zinc-900 rounded-lg hover:scale-110 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] hover:bg-zinc-800" aria-label="X (Twitter)">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 lg:w-5 lg:h-5"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
                <a href="https://www.linkedin.com/company/signaldirectory/" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-all duration-300 p-2.5 lg:p-3 bg-zinc-900 rounded-lg hover:scale-110 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] hover:bg-zinc-800" aria-label="LinkedIn">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 lg:w-5 lg:h-5"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
                <a href="https://t.me/thesignaldirectory" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-all duration-300 p-2.5 lg:p-3 bg-zinc-900 rounded-lg hover:scale-110 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] hover:bg-zinc-800" aria-label="Telegram">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 lg:w-5 lg:h-5"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                </a>
                <a href="https://discord.gg/DyMtfph9rA" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-all duration-300 p-2.5 lg:p-3 bg-zinc-900 rounded-lg hover:scale-110 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] hover:bg-zinc-800" aria-label="Discord">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 lg:w-5 lg:h-5"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.105 18.101.12 18.14.143 18.17a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                </a>
              </div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest font-mono flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Built with Anchor + Token-2022
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* Keyboard shortcut cheat sheet */}
      <ShortcutModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Wallet Connect Modal */}
      <WalletConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onExtensionConnect={() => {
          setIsConnectModalOpen(false);
          setWalletModalVisible(true);
        }}
        isPrivyAppConfigured={!!import.meta.env.VITE_PRIVY_APP_ID}
      />

      {/* Mobile Bottom Tab Bar */}
      {wallet.isConnected && (
        <nav className="fixed bottom-0 left-0 right-0 z-[9999] bg-[#0a0a0a] border-t border-zinc-700 lg:hidden pb-[env(safe-area-inset-bottom,0px)]">
          <div className="flex items-center justify-around h-14">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors relative ${
                  activeTab === tab.id ? 'text-emerald-400' : 'text-zinc-500 active:text-zinc-300'
                }`}
              >
                {activeTab === tab.id && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-400 rounded-full" />
                )}
                <tab.icon size={20} />
                <span className="text-[9px] font-bold uppercase tracking-wider">{tab.mobileLabel}</span>
              </button>
            ))}
          </div>
        </nav>
      )}
    </ToastContext.Provider>
  );
}
