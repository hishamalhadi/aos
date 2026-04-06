/**
 * ConnectorCatalog — Dropdown showing all available connectors grouped by category.
 * Opened from the "+" button in ReadinessBar.
 */
import { useRef, useEffect } from 'react';
import { useConnectors, type ConnectorInfo } from '@/hooks/useConnectors';
import { statusDotColor } from '@/hooks/useConnectorStatus';
import { getConnectorIcon } from './constants';

const CATEGORY_LABELS: Record<string, string> = {
  communication: 'Communication',
  productivity: 'Productivity',
  development: 'Development',
  knowledge: 'Knowledge',
  data: 'Data',
  ecommerce: 'Commerce',
};

export function ConnectorCatalog({
  onClose,
  onConnect,
}: {
  onClose: () => void;
  onConnect: (connectorId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { connectors, summary, isLoading } = useConnectors();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Group by category
  const groups: Record<string, ConnectorInfo[]> = {};
  for (const c of connectors) {
    const cat = c.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(c);
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-8 w-[240px] rounded-[10px] overflow-hidden z-50"
      style={{
        background: '#1E1A16',
        border: '1px solid rgba(255, 245, 235, 0.08)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[10px] font-[590] text-text-quaternary uppercase tracking-[0.04em]">
          Connectors
        </span>
        <span className="text-[10px] font-[510] text-text-quaternary">
          {summary.connected} of {summary.total} connected
        </span>
      </div>

      <div className="max-h-[320px] overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-4 text-center text-[11px] text-text-quaternary">Loading...</div>
        ) : (
          Object.entries(groups).map(([cat, items]) => (
            <div key={cat}>
              <div className="px-3 pt-2.5 pb-1">
                <span className="text-[9px] font-[590] text-text-quaternary uppercase tracking-[0.06em]">
                  {CATEGORY_LABELS[cat] || cat}
                </span>
              </div>
              {items.map((c) => {
                const Icon = getConnectorIcon(c.icon);
                const dotColor = statusDotColor(c.status === 'unavailable' ? 'broken' : c.status);
                return (
                  <button
                    key={c.id}
                    onClick={() => c.status !== 'connected' ? onConnect(c.id) : undefined}
                    className="w-full flex items-start gap-2.5 px-3 py-1.5 hover:bg-bg-tertiary transition-colors text-left cursor-pointer"
                  >
                    <div
                      className="w-5 h-5 rounded-[5px] flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: `${c.color}20` }}
                    >
                      <Icon className="w-2.5 h-2.5" style={{ color: c.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-[510] text-text-secondary">{c.name}</span>
                        <div className="w-[5px] h-[5px] rounded-full shrink-0" style={{ background: dotColor }} />
                      </div>
                      <p className="text-[9px] text-text-quaternary leading-[1.3] truncate">{c.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
