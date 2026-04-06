import { useState } from 'react';
import {
  Cpu, Plug, KeyRound, Loader2, Check, X, AlertCircle, Plus, RefreshCw,
  Globe, Zap, Server, Cloud, HardDrive,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  useProviders, useConnectors, useCredentials, useSyncConnectors,
  type Provider, type Connector, type Credential,
} from '@/hooks/useIntegrations';

// ============================================================
// Glass + style
// ============================================================

const GLASS: React.CSSProperties = {
  background: 'var(--glass-bg, rgba(30, 26, 22, 0.60))',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderColor: 'var(--glass-border, rgba(255, 245, 235, 0.06))',
  boxShadow: 'var(--glass-shadow, 0 2px 12px rgba(0,0,0,0.3))',
};

const TABS = [
  { id: 'providers', label: 'Providers', icon: <Cpu className="w-3 h-3" /> },
  { id: 'connectors', label: 'Connectors', icon: <Plug className="w-3 h-3" /> },
  { id: 'credentials', label: 'Credentials', icon: <KeyRound className="w-3 h-3" /> },
] as const;
type TabId = (typeof TABS)[number]['id'];

// ============================================================
// Status dot
// ============================================================

function StatusDot({ status }: { status: string }) {
  const color = status === 'active' ? 'bg-green' : status === 'configured' ? 'bg-blue' : status === 'not-running' ? 'bg-yellow' : 'bg-text-quaternary/30';
  return <span className={`w-2 h-2 rounded-full ${color} ${status === 'active' ? 'animate-pulse' : ''}`} />;
}

// ============================================================
// Provider type icons
// ============================================================

function ProviderIcon({ type }: { type: string }) {
  const icons: Record<string, ReactNode> = {
    harness: <Zap className="w-4 h-4" />,
    api: <Cloud className="w-4 h-4" />,
    gateway: <Globe className="w-4 h-4" />,
    local: <HardDrive className="w-4 h-4" />,
  };
  return <span className="text-text-quaternary">{icons[type] ?? <Server className="w-4 h-4" />}</span>;
}

// ============================================================
// Provider card
// ============================================================

function ProviderCard({ provider }: { provider: Provider }) {
  return (
    <div className="rounded-lg border border-border/50 p-4 hover:border-border-secondary transition-colors" style={{ transitionDuration: '80ms' }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-bg-tertiary flex items-center justify-center shrink-0">
          <ProviderIcon type={provider.type} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[14px] font-[560] text-text">{provider.display_name}</span>
            <StatusDot status={provider.status} />
            {provider.is_default && (
              <span className="text-[9px] font-[510] text-accent/70 bg-accent/8 px-1.5 py-0.5 rounded">default</span>
            )}
          </div>
          <p className="text-[11px] text-text-quaternary leading-[1.4] mb-2">{provider.description}</p>
          <div className="flex items-center gap-3 text-[10px] text-text-quaternary">
            <span className="font-mono">{provider.type}</span>
            {provider.models.length > 0 && <span>{provider.models.length} models</span>}
            {provider.credential && (
              <span className={`flex items-center gap-1 ${provider.credential_ok ? 'text-green/70' : 'text-red/70'}`}>
                <KeyRound className="w-2.5 h-2.5" />
                {provider.credential}
              </span>
            )}
          </div>
          {provider.models.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {provider.models.map(m => (
                <span key={m} className="text-[10px] font-mono text-text-tertiary bg-[rgba(255,245,235,0.04)] rounded px-1.5 py-0.5">{m}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Connector card
// ============================================================

const SCOPE_COLORS: Record<string, string> = {
  global: 'text-green/70 bg-green/8',
  project: 'text-blue/70 bg-blue/8',
  agent: 'text-purple/70 bg-purple/8',
};

function ConnectorCard({ connector }: { connector: Connector }) {
  return (
    <div className={`rounded-lg border p-4 transition-colors ${connector.is_configured ? 'border-border/50 hover:border-border-secondary' : 'border-border/20 opacity-60'}`}
      style={{ transitionDuration: '80ms' }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-bg-tertiary flex items-center justify-center shrink-0">
          <Plug className="w-4 h-4 text-text-quaternary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[14px] font-[560] text-text">{connector.display_name}</span>
            {connector.is_configured && <StatusDot status={connector.status} />}
            <span className={`text-[9px] font-[510] px-1.5 py-0.5 rounded ${SCOPE_COLORS[connector.scope] ?? 'text-text-quaternary bg-bg-tertiary'}`}>
              {connector.scope}
            </span>
          </div>
          <p className="text-[11px] text-text-quaternary leading-[1.4] mb-2">{connector.description}</p>
          <div className="flex items-center gap-2">
            {connector.tags.map(t => (
              <span key={t} className="text-[9px] text-text-quaternary/60 bg-[rgba(255,245,235,0.03)] rounded px-1.5 py-0.5">{t}</span>
            ))}
          </div>
          {!connector.is_configured && (
            <p className="text-[10px] text-text-quaternary/50 mt-2 italic">Not configured — needs command and credential</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Credential row
// ============================================================

function CredentialRow({ credential }: { credential: Credential }) {
  const providers = credential.used_by.providers ?? [];
  const connectors = credential.used_by.connectors ?? [];
  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-[rgba(255,245,235,0.03)] transition-colors" style={{ transitionDuration: '80ms' }}>
      <div className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center shrink-0">
        <KeyRound className="w-3.5 h-3.5 text-text-quaternary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-[560] font-mono text-text">{credential.name}</span>
          {credential.present
            ? <span className="flex items-center gap-1 text-[10px] text-green/70"><Check className="w-2.5 h-2.5" /> In keychain</span>
            : <span className="flex items-center gap-1 text-[10px] text-red/70"><AlertCircle className="w-2.5 h-2.5" /> Missing</span>
          }
        </div>
        <p className="text-[11px] text-text-quaternary">{credential.description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0 text-[10px] text-text-quaternary">
        {providers.length > 0 && <span>{providers.join(', ')}</span>}
        {connectors.length > 0 && <span>{connectors.join(', ')}</span>}
      </div>
    </div>
  );
}

// ============================================================
// Scope group header
// ============================================================

function ScopeGroup({ label, description, children, count }: { label: string; description: string; children: ReactNode; count: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-[590] uppercase tracking-[0.06em] text-text-quaternary">{label}</span>
        <span className="text-[10px] text-text-quaternary/50">({count})</span>
        <span className="text-[10px] text-text-quaternary/40 ml-1">{description}</span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {children}
      </div>
    </div>
  );
}

// ============================================================
// Main page
// ============================================================

export default function IntegrationsPage() {
  const [tab, setTab] = useState<TabId>('providers');
  const { data: providers = [], isLoading: pLoading } = useProviders();
  const { data: connectorData, isLoading: cLoading } = useConnectors();
  const { data: credentials = [], isLoading: crLoading } = useCredentials();
  const syncMut = useSyncConnectors();

  const globalC = (connectorData?.global ?? []) as Connector[];
  const projectC = (connectorData?.project ?? []) as Connector[];
  const agentC = (connectorData?.agent ?? []) as Connector[];

  const isLoading = (tab === 'providers' && pLoading) || (tab === 'connectors' && cLoading) || (tab === 'credentials' && crLoading);

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Tab pills */}
      <div className="shrink-0 flex justify-center pt-3 pb-2 pointer-events-none">
        <div className="flex items-center gap-1 h-8 px-1 rounded-full border pointer-events-auto" style={GLASS}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 h-6 rounded-full text-[11px] font-[510] cursor-pointer transition-all duration-150 ${
                tab === t.id ? 'bg-[rgba(255,245,235,0.10)] text-text' : 'text-text-tertiary hover:text-text-secondary'
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-8">
        <div className="max-w-[680px] mx-auto pt-2">

          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 text-text-quaternary animate-spin" />
            </div>
          )}

          {/* Providers */}
          {tab === 'providers' && !pLoading && (
            <div className="space-y-3">
              {providers.map(p => <ProviderCard key={p.id} provider={p} />)}
              {providers.length === 0 && (
                <p className="text-[13px] text-text-tertiary text-center py-12">No providers configured</p>
              )}
            </div>
          )}

          {/* Connectors */}
          {tab === 'connectors' && !cLoading && (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] text-text-quaternary">
                  {connectorData?.configured ?? 0} of {connectorData?.total ?? 0} configured
                </span>
                <button onClick={() => syncMut.mutate()}
                  className="flex items-center gap-1.5 h-7 px-3 rounded-md text-[11px] font-[510] text-text-quaternary hover:text-text-secondary hover:bg-hover cursor-pointer transition-colors"
                  style={{ transitionDuration: '80ms' }}>
                  <RefreshCw className={`w-3 h-3 ${syncMut.isPending ? 'animate-spin' : ''}`} /> Sync to harness
                </button>
              </div>

              {globalC.length > 0 && (
                <ScopeGroup label="Global" description="Every session" count={globalC.length}>
                  {globalC.map(c => <ConnectorCard key={c.id} connector={c} />)}
                </ScopeGroup>
              )}
              {projectC.length > 0 && (
                <ScopeGroup label="Project" description="This directory" count={projectC.length}>
                  {projectC.map(c => <ConnectorCard key={c.id} connector={c} />)}
                </ScopeGroup>
              )}
              {agentC.length > 0 && (
                <ScopeGroup label="Agent" description="When agent declares it" count={agentC.length}>
                  {agentC.map(c => <ConnectorCard key={c.id} connector={c} />)}
                </ScopeGroup>
              )}
            </>
          )}

          {/* Credentials */}
          {tab === 'credentials' && !crLoading && (
            <div>
              {credentials.map(c => <CredentialRow key={c.name} credential={c} />)}
              {credentials.length === 0 && (
                <p className="text-[13px] text-text-tertiary text-center py-12">No credentials in manifest</p>
              )}
              <p className="text-[10px] text-text-quaternary/50 mt-6 text-center">
                Values stored in macOS Keychain — manage with <span className="font-mono">agent-secret get/set</span>
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
