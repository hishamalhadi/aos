/**
 * ReadinessBar — Compact strip showing connector status for the current spec.
 * Auto-derives from spec steps. Hidden when empty. Lives below the glass pill tabs.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useSpecReadiness, type ConnectorReadiness } from '@/hooks/useSpecReadiness';
import { statusDotColor } from '@/hooks/useConnectorStatus';
import { getConnectorIcon } from './constants';
import { ConnectorCatalog } from './ConnectorCatalog';
import { ConnectorSetupPopover } from './ConnectorSetupPopover';

function ServicePill({
  connector,
  onClick,
}: {
  connector: ConnectorReadiness;
  onClick: () => void;
}) {
  const Icon = getConnectorIcon(connector.icon);
  const dotColor = statusDotColor(connector.status);
  const needsAttention = connector.status !== 'connected';

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full transition-colors cursor-pointer"
      style={{
        background: needsAttention ? 'rgba(255, 69, 58, 0.06)' : 'rgba(255, 245, 235, 0.04)',
        border: `1px solid ${needsAttention ? 'rgba(255, 69, 58, 0.12)' : 'rgba(255, 245, 235, 0.04)'}`,
      }}
    >
      <Icon className="w-2.5 h-2.5" style={{ color: connector.color }} />
      <span className={`text-[10px] font-[510] ${needsAttention ? 'text-text-secondary' : 'text-text-quaternary'}`}>
        {connector.connectorName}
      </span>
      <div className="w-[5px] h-[5px] rounded-full" style={{ background: dotColor }} />
    </button>
  );
}

export function ReadinessBar() {
  const { connectors, ready, total, loading } = useSpecReadiness();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [setupConnector, setSetupConnector] = useState<string | null>(null);

  if (loading || total === 0) return null;

  return (
    <div
      className="shrink-0 flex items-center gap-1.5 px-4 py-1.5"
      style={{
        borderTop: '1px solid rgba(255, 245, 235, 0.03)',
      }}
    >
      {/* Service pills */}
      <div className="flex items-center gap-1 flex-1 flex-wrap">
        {connectors.map((c) => (
          <ServicePill
            key={c.connectorId}
            connector={c}
            onClick={() => c.status !== 'connected' && setSetupConnector(c.connectorId)}
          />
        ))}
      </div>

      {/* Summary + catalog button */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-text-quaternary font-[510] tabular-nums">
          {ready}/{total}
        </span>

        <div className="relative">
          <button
            onClick={() => setCatalogOpen(!catalogOpen)}
            className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-colors"
            style={{
              background: 'rgba(255, 245, 235, 0.06)',
              border: '1px solid rgba(255, 245, 235, 0.06)',
            }}
          >
            <Plus className="w-2.5 h-2.5 text-text-quaternary" />
          </button>

          {catalogOpen && (
            <ConnectorCatalog
              onClose={() => setCatalogOpen(false)}
              onConnect={(id) => { setCatalogOpen(false); setSetupConnector(id); }}
            />
          )}
        </div>
      </div>

      {/* Setup popover */}
      {setupConnector && (
        <ConnectorSetupPopover
          connectorId={setupConnector}
          onClose={() => setSetupConnector(null)}
        />
      )}
    </div>
  );
}
