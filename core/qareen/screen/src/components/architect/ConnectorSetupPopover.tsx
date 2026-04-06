/**
 * ConnectorSetupPopover — Floating card with connector health + setup guidance.
 * Shows health check results and auth instructions for connecting a service.
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import { Check, X, RefreshCw, AlertTriangle } from 'lucide-react';
import { getConnectorIcon } from './constants';
import { statusDotColor } from '@/hooks/useConnectorStatus';

interface ConnectorDetail {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: string;
  health: { name: string; status: string; detail: string; description?: string }[];
  auth?: { method?: string; credentials?: { key: string; label: string }[]; cli?: { auth_command?: string } };
}

export function ConnectorSetupPopover({
  connectorId,
  onClose,
}: {
  connectorId: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ConnectorDetail | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/connectors/${connectorId}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
  }, [connectorId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/connectors/${connectorId}/health`);
      await fetchDetail();
    } finally {
      setRefreshing(false);
    }
  };

  if (!data) return null;

  const Icon = getConnectorIcon(data.icon);
  const dotColor = statusDotColor(data.status as any);
  const authMethod = data.auth?.method;

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-[400] flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.3)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[300px] rounded-[12px] overflow-hidden"
        style={{
          background: '#1E1A16',
          border: '1px solid rgba(255, 245, 235, 0.08)',
          boxShadow: '0 12px 48px rgba(0, 0, 0, 0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <div
            className="w-8 h-8 rounded-[8px] flex items-center justify-center"
            style={{ background: `${data.color}20` }}
          >
            <Icon className="w-4 h-4" style={{ color: data.color }} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-[560] text-text">{data.name}</span>
              <div className="w-[6px] h-[6px] rounded-full" style={{ background: dotColor }} />
            </div>
            <span className="text-[10px] text-text-quaternary capitalize">{data.status}</span>
          </div>
          <button onClick={onClose} className="text-text-quaternary hover:text-text-tertiary cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Health checks */}
        {data.health?.length > 0 && (
          <div className="px-4 py-2.5 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-[590] text-text-quaternary uppercase tracking-[0.04em]">Health</span>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="text-text-quaternary hover:text-text-tertiary cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="space-y-1.5">
              {data.health.map((h) => (
                <div key={h.name} className="flex items-start gap-2">
                  {h.status === 'pass' ? (
                    <Check className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <span className="text-[10px] text-text-secondary block">
                      {h.description || h.name}
                    </span>
                    {h.status !== 'pass' && h.detail && (
                      <span className="text-[9px] text-text-quaternary">{h.detail}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Setup guidance */}
        <div className="px-4 py-3">
          <span className="text-[10px] font-[590] text-text-quaternary uppercase tracking-[0.04em] block mb-2">Setup</span>

          {authMethod === 'api_key' && data.auth?.credentials && (
            <div className="space-y-1.5">
              {data.auth.credentials.map((cred) => (
                <div key={cred.key} className="text-[10px]">
                  <span className="text-text-tertiary">Add </span>
                  <code className="font-mono text-[9px] px-1 py-0.5 rounded bg-bg-tertiary text-accent">{cred.key}</code>
                  <span className="text-text-tertiary"> to keychain:</span>
                  <div
                    className="mt-1 px-2 py-1.5 rounded-[6px] font-mono text-[9px] text-text-quaternary"
                    style={{ background: 'rgba(13, 11, 9, 0.5)' }}
                  >
                    agent-secret set {cred.key}
                  </div>
                </div>
              ))}
            </div>
          )}

          {authMethod === 'cli_auth' && data.auth?.cli?.auth_command && (
            <div>
              <span className="text-[10px] text-text-tertiary block mb-1">Run in your terminal:</span>
              <div
                className="px-2 py-1.5 rounded-[6px] font-mono text-[9px] text-text-quaternary"
                style={{ background: 'rgba(13, 11, 9, 0.5)' }}
              >
                {data.auth.cli.auth_command}
              </div>
            </div>
          )}

          {authMethod === 'oauth' && (
            <div className="text-[10px] text-text-tertiary">
              OAuth credentials required. Set up via onboarding or add keys to keychain.
            </div>
          )}

          {!authMethod && (
            <div className="text-[10px] text-text-quaternary italic">
              Check health status above for what's needed.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
