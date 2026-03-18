/**
 * Local metadata store for deals and milestone events.
 * Ported from stellar-demo — stores supplementary info in localStorage.
 */

export interface MilestoneEvent {
  action: 'funded' | 'released' | 'disputed' | 'resolved';
  timestamp: string;
  txHash: string;
  split?: {
    providerAmount: string;
    connectorAmount: string;
    protocolAmount: string;
  };
}

export interface DealMetadata {
  title: string;
  description: string;
  milestoneNames: string[];
  createdAt: string;
  txHash: string;
}

const DEAL_META_PREFIX = 'deal-meta:';
const DEAL_EVENTS_PREFIX = 'deal-events:';

export function saveDealMetadata(dealId: number, meta: DealMetadata): void {
  try {
    localStorage.setItem(DEAL_META_PREFIX + dealId, JSON.stringify(meta));
  } catch { /* non-critical */ }
}

export function getDealMetadata(dealId: number): DealMetadata | null {
  try {
    const raw = localStorage.getItem(DEAL_META_PREFIX + dealId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getEventsKey(dealId: number, milestoneIdx: number): string {
  return `${DEAL_EVENTS_PREFIX}${dealId}:${milestoneIdx}`;
}

export function recordMilestoneEvent(
  dealId: number,
  milestoneIdx: number,
  event: MilestoneEvent
): void {
  try {
    const key = getEventsKey(dealId, milestoneIdx);
    const existing = getMilestoneEvents(dealId, milestoneIdx);
    existing.push(event);
    localStorage.setItem(key, JSON.stringify(existing));
  } catch { /* non-critical */ }
}

export function getMilestoneEvents(
  dealId: number,
  milestoneIdx: number
): MilestoneEvent[] {
  try {
    const raw = localStorage.getItem(getEventsKey(dealId, milestoneIdx));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getAllDealEvents(
  dealId: number,
  milestoneCount: number
): Array<MilestoneEvent & { milestoneIdx: number }> {
  const all: Array<MilestoneEvent & { milestoneIdx: number }> = [];
  for (let i = 0; i < milestoneCount; i++) {
    const events = getMilestoneEvents(dealId, i);
    for (const e of events) {
      all.push({ ...e, milestoneIdx: i });
    }
  }
  return all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function formatEventDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' at '
    + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

const ACTION_LABELS: Record<string, string> = {
  funded: 'Milestone Funded',
  released: 'Milestone Released',
  disputed: 'Dispute Filed',
  resolved: 'Dispute Resolved',
};

export function getEventLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}
