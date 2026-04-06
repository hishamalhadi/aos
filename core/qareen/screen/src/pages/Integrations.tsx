import { useState } from 'react';
import {
  Cpu, Plug, KeyRound, Loader2, Check, X, AlertCircle, Plus, RefreshCw,
  Globe, Zap, Server, Cloud, HardDrive, ChevronDown, ChevronRight, Shield,
  Activity,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  useProviders, useConnectors, useCredentials, useSyncConnectors,
  useAddConnector, useAddProvider,
  type Provider, type Connector, type Credential,
} from '@/hooks/useIntegrations';
import { useExecutions, useExecutionSummary, type Execution } from '@/hooks/useExecutions';
import KeyValueEditor from '@/components/agents/KeyValueEditor';

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
  { id: 'activity', label: 'Activity', icon: <Activity className="w-3 h-3" /> },
] as const;
type TabId = (typeof TABS)[number]['id'];

// ============================================================
// Status dot
// ============================================================

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'active' || status === 'connected' ? 'bg-green' :
    status === 'configured' || status === 'partial' ? 'bg-yellow' :
    status === 'broken' || status === 'not-running' ? 'bg-red' :
    'bg-text-quaternary/30';
  const pulse = status === 'active' || status === 'connected';
  return <span className={`w-2 h-2 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`} />;
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
  const [healthOpen, setHealthOpen] = useState(false);
  const hasHealth = connector.health && connector.health.length > 0;
  const capCount = connector.capabilities?.length ?? 0;

  const statusLabel =
    connector.status === 'connected' ? 'Connected' :
    connector.status === 'partial' ? 'Partial' :
    connector.status === 'available' ? 'Available' :
    connector.status === 'not-configured' ? 'Not configured' :
    connector.status === 'broken' ? 'Broken' :
    connector.status;

  const borderLeft = connector.color ? { borderLeftWidth: '3px', borderLeftColor: connector.color } : {};

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        connector.status === 'connected' ? 'border-border/50 hover:border-border-secondary' :
        connector.status === 'partial' ? 'border-border/40 hover:border-border-secondary' :
        'border-border/20 opacity-70'
      }`}
      style={{ transitionDuration: '80ms', ...borderLeft }}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-bg-tertiary flex items-center justify-center shrink-0 text-[14px] font-[600] text-text-quaternary">
          {connector.display_name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[14px] font-[560] text-text">{connector.display_name}</span>
            <StatusDot status={connector.status} />
            <span className={`text-[9px] font-[510] px-1.5 py-0.5 rounded ${SCOPE_COLORS[connector.scope] ?? 'text-text-quaternary bg-bg-tertiary'}`}>
              {connector.scope}
            </span>
            {capCount > 0 && (
              <span className="text-[9px] font-[510] text-accent/60 bg-accent/8 px-1.5 py-0.5 rounded">
                {capCount} cap{capCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-quaternary leading-[1.4] mb-1">{connector.description}</p>
          {connector.status_detail && (
            <p className="text-[10px] text-text-quaternary/60 leading-[1.4] mb-2">{connector.status_detail}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] font-[510] px-1.5 py-0.5 rounded ${
              connector.status === 'connected' ? 'text-green/70 bg-green/8' :
              connector.status === 'partial' ? 'text-yellow/70 bg-yellow/8' :
              connector.status === 'broken' ? 'text-red/70 bg-red/8' :
              'text-text-quaternary/50 bg-[rgba(255,245,235,0.03)]'
            }`}>
              {statusLabel}
            </span>
            {connector.tags.map(t => (
              <span key={t} className="text-[9px] text-text-quaternary/60 bg-[rgba(255,245,235,0.03)] rounded px-1.5 py-0.5">{t}</span>
            ))}
          </div>

          {/* Health checks expandable */}
          {hasHealth && (
            <div className="mt-2">
              <button
                onClick={() => setHealthOpen(!healthOpen)}
                className="flex items-center gap-1 text-[10px] text-text-quaternary/70 hover:text-text-tertiary cursor-pointer transition-colors"
                style={{ transitionDuration: '80ms' }}
              >
                {healthOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <Shield className="w-3 h-3" />
                {connector.health!.length} health check{connector.health!.length !== 1 ? 's' : ''}
              </button>
              {healthOpen && (
                <div className="mt-1.5 space-y-1 pl-1">
                  {connector.health!.map((h, i) => (
                    <div key={i} className="flex items-start gap-2">
                      {h.status === 'ok' || h.status === 'pass'
                        ? <Check className="w-3 h-3 text-green/70 mt-px shrink-0" />
                        : <X className="w-3 h-3 text-red/70 mt-px shrink-0" />
                      }
                      <div>
                        <span className="text-[10px] font-[510] text-text-secondary">{h.name}</span>
                        <span className="text-[10px] text-text-quaternary/60 ml-1.5">{h.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {connector.status === 'not-configured' && !hasHealth && (
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

function CredentialRow({ credential }: { credential: Credential & { category?: string } }) {
  const providers = credential.used_by.providers ?? [];
  const connectors = credential.used_by.connectors ?? [];
  const usages = [...providers, ...connectors];
  const catColors: Record<string, string> = {
    api: 'text-accent/60 bg-accent/8',
    oauth: 'text-blue/60 bg-blue/8',
    messaging: 'text-teal/60 bg-teal/8',
    account: 'text-purple/60 bg-purple/8',
    other: 'text-text-quaternary bg-bg-tertiary',
  };
  const cat = (credential as any).category ?? 'other';
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[rgba(255,245,235,0.03)] transition-colors" style={{ transitionDuration: '80ms' }}>
      <div className="w-7 h-7 rounded-md bg-bg-tertiary flex items-center justify-center shrink-0">
        <KeyRound className="w-3 h-3 text-text-quaternary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-[560] font-mono text-text">{credential.name}</span>
          <span className={`text-[8px] font-[510] px-1 py-px rounded ${catColors[cat] ?? catColors.other}`}>{cat}</span>
          {credential.present
            ? <Check className="w-2.5 h-2.5 text-green/60" />
            : <AlertCircle className="w-2.5 h-2.5 text-red/50" />
          }
        </div>
        {usages.length > 0 && (
          <span className="text-[10px] text-text-quaternary/60">{usages.join(', ')}</span>
        )}
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
// Shared form styles
// ============================================================

const INPUT_CLASS = 'w-full h-8 px-2.5 rounded border border-border-secondary bg-bg-secondary text-[12px] font-mono text-text-secondary placeholder:text-text-quaternary outline-none transition-colors focus:border-border-tertiary';
const LABEL_CLASS = 'block text-[11px] font-[510] text-text-quaternary mb-1';
const SELECT_CLASS = 'w-full h-8 px-2 rounded border border-border-secondary bg-bg-secondary text-[12px] text-text-secondary outline-none transition-colors focus:border-border-tertiary cursor-pointer appearance-none';

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      {children}
    </div>
  );
}

// ============================================================
// Connector Form Modal
// ============================================================

function ConnectorFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addConnector = useAddConnector();
  const [form, setForm] = useState({
    id: '',
    display_name: '',
    type: 'mcp-stdio',
    command: '',
    args: '',
    scope: 'global',
    credential: '',
  });
  const [env, setEnv] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id.trim()) { setError('ID is required'); return; }
    setError('');

    const payload: Record<string, unknown> = {
      id: form.id.trim(),
      display_name: form.display_name.trim() || form.id.trim(),
      type: form.type,
      command: form.command.trim() || undefined,
      args: form.args.trim() ? form.args.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
      scope: form.scope,
      credential: form.credential.trim() || undefined,
    };

    addConnector.mutate(payload, {
      onSuccess: () => {
        onClose();
        setForm({ id: '', display_name: '', type: 'mcp-stdio', command: '', args: '', scope: 'global', credential: '' });
        setEnv({});
      },
      onError: (err) => setError(err.message),
    });
  };

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center font-sans" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-[480px] max-w-[90vw] max-h-[85vh] overflow-y-auto bg-bg-secondary border border-border rounded-lg shadow-2xl p-5"
        onClick={stopProp}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 text-accent" />
            <h2 className="text-[14px] font-[600] text-text">Add connector</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-text-quaternary hover:text-text-tertiary cursor-pointer transition-colors" style={{ transitionDuration: '80ms' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <FormField label="ID *">
            <input type="text" value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
              placeholder="my-connector" className={INPUT_CLASS} style={{ transitionDuration: '150ms' }} />
          </FormField>
          <FormField label="Display name">
            <input type="text" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
              placeholder="My Connector" className={INPUT_CLASS} style={{ transitionDuration: '150ms' }} />
          </FormField>
          <FormField label="Type">
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className={SELECT_CLASS} style={{ transitionDuration: '150ms' }}>
              <option value="mcp-stdio">mcp-stdio</option>
              <option value="mcp-sse">mcp-sse</option>
              <option value="api">api</option>
              <option value="service">service</option>
              <option value="cli">cli</option>
            </select>
          </FormField>
          <FormField label="Command">
            <input type="text" value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))}
              placeholder="npx @anthropic/some-mcp" className={INPUT_CLASS} style={{ transitionDuration: '150ms' }} />
          </FormField>
          <FormField label="Args (comma-separated)">
            <input type="text" value={form.args} onChange={e => setForm(f => ({ ...f, args: e.target.value }))}
              placeholder="--port, 3000, --verbose" className={INPUT_CLASS} style={{ transitionDuration: '150ms' }} />
          </FormField>
          <FormField label="Environment variables">
            <KeyValueEditor entries={env} onChange={setEnv} />
          </FormField>
          <FormField label="Scope">
            <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
              className={SELECT_CLASS} style={{ transitionDuration: '150ms' }}>
              <option value="global">global</option>
              <option value="project">project</option>
              <option value="agent">agent</option>
            </select>
          </FormField>
          <FormField label="Credential (keychain key)">
            <input type="text" value={form.credential} onChange={e => setForm(f => ({ ...f, credential: e.target.value }))}
              placeholder="MY_API_KEY" className={INPUT_CLASS} style={{ transitionDuration: '150ms' }} />
          </FormField>

          {error && <p className="text-[11px] text-red">{error}</p>}

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={addConnector.isPending}
              className="h-8 px-4 rounded-md text-[12px] font-[560] bg-accent/90 text-bg hover:bg-accent cursor-pointer transition-colors disabled:opacity-50"
              style={{ transitionDuration: '150ms' }}>
              {addConnector.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add connector'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Provider Form Modal
// ============================================================

function ProviderFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addProvider = useAddProvider();
  const [form, setForm] = useState({
    id: '',
    display_name: '',
    type: 'api',
    endpoint: '',
    credential: '',
    models: '',
  });
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id.trim()) { setError('ID is required'); return; }
    setError('');

    const payload: Record<string, unknown> = {
      id: form.id.trim(),
      display_name: form.display_name.trim() || form.id.trim(),
      type: form.type,
      endpoint: form.endpoint.trim() || undefined,
      credential: form.credential.trim() || undefined,
      models: form.models.trim() ? form.models.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    };

    addProvider.mutate(payload, {
      onSuccess: () => {
        onClose();
        setForm({ id: '', display_name: '', type: 'api', endpoint: '', credential: '', models: '' });
      },
      onError: (err) => setError(err.message),
    });
  };

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center font-sans" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-[480px] max-w-[90vw] max-h-[85vh] overflow-y-auto bg-bg-secondary border border-border rounded-lg shadow-2xl p-5"
        onClick={stopProp}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-accent" />
            <h2 className="text-[14px] font-[600] text-text">Add provider</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-text-quaternary hover:text-text-tertiary cursor-pointer transition-colors" style={{ transitionDuration: '80ms' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <FormField label="ID *">
            <input type="text" value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
              placeholder="my-openrouter" className={INPUT_CLASS} style={{ transitionDuration: '150ms' }} />
          </FormField>
          <FormField label="Display name">
            <input type="text" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
              placeholder="My Provider" className={INPUT_CLASS} style={{ transitionDuration: '150ms' }} />
          </FormField>
          <FormField label="Type">
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className={SELECT_CLASS} style={{ transitionDuration: '150ms' }}>
              <option value="api">api</option>
              <option value="gateway">gateway</option>
              <option value="local">local</option>
              <option value="harness">harness</option>
              <option value="service">service</option>
            </select>
          </FormField>
          <FormField label="Endpoint">
            <input type="text" value={form.endpoint} onChange={e => setForm(f => ({ ...f, endpoint: e.target.value }))}
              placeholder="https://api.example.com/v1" className={INPUT_CLASS} style={{ transitionDuration: '150ms' }} />
          </FormField>
          <FormField label="Credential (keychain key)">
            <input type="text" value={form.credential} onChange={e => setForm(f => ({ ...f, credential: e.target.value }))}
              placeholder="OPENROUTER_API_KEY" className={INPUT_CLASS} style={{ transitionDuration: '150ms' }} />
          </FormField>
          <FormField label="Models (comma-separated)">
            <input type="text" value={form.models} onChange={e => setForm(f => ({ ...f, models: e.target.value }))}
              placeholder="gpt-4, claude-3-opus, gemini-pro" className={INPUT_CLASS} style={{ transitionDuration: '150ms' }} />
          </FormField>

          {error && <p className="text-[11px] text-red">{error}</p>}

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={addProvider.isPending}
              className="h-8 px-4 rounded-md text-[12px] font-[560] bg-accent/90 text-bg hover:bg-accent cursor-pointer transition-colors disabled:opacity-50"
              style={{ transitionDuration: '150ms' }}>
              {addProvider.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add provider'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Relative time
// ============================================================

function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ============================================================
// Activity tab
// ============================================================

function ActivityTab() {
  const [period, setPeriod] = useState<string>('today');
  const { data: execData, isLoading } = useExecutions({ limit: 50 });
  const { data: summary } = useExecutionSummary(period);

  const executions = execData?.executions ?? [];

  return (
    <div>
      {/* Summary row */}
      {summary && summary.total_executions > 0 && (
        <div className="rounded-lg border border-border/50 p-4 mb-4" style={{ transitionDuration: '80ms' }}>
          <div className="flex items-center gap-2 mb-3">
            <select value={period} onChange={e => setPeriod(e.target.value)}
              className="h-6 px-2 rounded text-[11px] font-[510] bg-bg-tertiary border border-border/30 text-text-secondary outline-none cursor-pointer">
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="all">All time</option>
            </select>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <span className="block text-[20px] font-[600] text-text tabular-nums">{summary.total_executions}</span>
              <span className="text-[10px] text-text-quaternary">executions</span>
            </div>
            <div>
              <span className="block text-[20px] font-[600] text-text tabular-nums">{formatTokens(summary.total_tokens_in + summary.total_tokens_out)}</span>
              <span className="text-[10px] text-text-quaternary">tokens</span>
            </div>
            <div>
              <span className="block text-[20px] font-[600] text-text tabular-nums">{summary.avg_duration_ms > 0 ? `${(summary.avg_duration_ms / 1000).toFixed(1)}s` : '—'}</span>
              <span className="text-[10px] text-text-quaternary">avg duration</span>
            </div>
            <div>
              <span className="block text-[20px] font-[600] text-text tabular-nums">{summary.total_cost_usd > 0 ? `$${summary.total_cost_usd.toFixed(2)}` : '—'}</span>
              <span className="text-[10px] text-text-quaternary">cost</span>
            </div>
          </div>
          {summary.by_provider.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border/30">
              {summary.by_provider.map(p => (
                <span key={p.provider} className="text-[10px] font-mono text-text-quaternary bg-[rgba(255,245,235,0.04)] px-2 py-0.5 rounded">
                  {p.provider}: {p.count}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Execution list */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-text-quaternary animate-spin" />
        </div>
      )}

      {!isLoading && executions.length === 0 && (
        <div className="text-center py-16">
          <Activity className="w-8 h-8 text-text-quaternary/30 mx-auto mb-3" />
          <p className="text-[13px] text-text-tertiary mb-1">No executions recorded yet</p>
          <p className="text-[11px] text-text-quaternary">Executions are logged when agents run via the execution router</p>
        </div>
      )}

      {!isLoading && executions.length > 0 && (
        <div className="space-y-1">
          {executions.map(exec => (
            <ExecutionRow key={exec.id} exec={exec} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExecutionRow({ exec }: { exec: Execution }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[rgba(255,245,235,0.03)] transition-colors" style={{ transitionDuration: '80ms' }}>
      <StatusDot status={exec.status === 'ok' ? 'connected' : exec.status === 'error' ? 'broken' : 'partial'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-[510] text-text">{exec.agent_id ?? 'direct'}</span>
          <span className="text-[10px] font-mono text-text-quaternary">{exec.provider}/{exec.model}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-[10px] tabular-nums text-text-quaternary shrink-0">
        {(exec.tokens_in > 0 || exec.tokens_out > 0) && (
          <span>{formatTokens(exec.tokens_in)}→{formatTokens(exec.tokens_out)}</span>
        )}
        {exec.duration_ms > 0 && (
          <span>{(exec.duration_ms / 1000).toFixed(1)}s</span>
        )}
        {exec.cost_usd != null && exec.cost_usd > 0 && (
          <span className="text-accent/70">${exec.cost_usd.toFixed(4)}</span>
        )}
        <span className="w-12 text-right">{relativeTime(exec.timestamp)}</span>
      </div>
    </div>
  );
}

// ============================================================
// Main page
// ============================================================

export default function IntegrationsPage() {
  const [tab, setTab] = useState<TabId>('providers');
  const [showConnectorForm, setShowConnectorForm] = useState(false);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const { data: providers = [], isLoading: pLoading } = useProviders();
  const { data: connectorData, isLoading: cLoading } = useConnectors();
  const { data: credentials = [], isLoading: crLoading } = useCredentials();
  const syncMut = useSyncConnectors();

  const globalC = (connectorData?.global ?? []) as Connector[];
  const projectC = (connectorData?.project ?? []) as Connector[];
  const agentC = (connectorData?.agent ?? []) as Connector[];

  const isLoading = (tab === 'providers' && pLoading) || (tab === 'connectors' && cLoading) || (tab === 'credentials' && crLoading);
  // Activity tab manages its own loading state internally

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
            <>
              <div className="flex items-center justify-end mb-3">
                <button onClick={() => setShowProviderForm(true)}
                  className="flex items-center gap-1.5 h-7 px-3 rounded-md text-[11px] font-[510] text-text-quaternary hover:text-text-secondary hover:bg-hover cursor-pointer transition-colors"
                  style={{ transitionDuration: '80ms' }}>
                  <Plus className="w-3 h-3" /> Add provider
                </button>
              </div>
              <div className="space-y-3">
                {providers.map(p => <ProviderCard key={p.id} provider={p} />)}
                {providers.length === 0 && (
                  <p className="text-[13px] text-text-tertiary text-center py-12">No providers configured</p>
                )}
              </div>
              <ProviderFormModal open={showProviderForm} onClose={() => setShowProviderForm(false)} />
            </>
          )}

          {/* Connectors */}
          {tab === 'connectors' && !cLoading && (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] text-text-quaternary">
                  {connectorData?.configured ?? 0} of {connectorData?.total ?? 0} configured
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowConnectorForm(true)}
                    className="flex items-center gap-1.5 h-7 px-3 rounded-md text-[11px] font-[510] text-text-quaternary hover:text-text-secondary hover:bg-hover cursor-pointer transition-colors"
                    style={{ transitionDuration: '80ms' }}>
                    <Plus className="w-3 h-3" />
                  </button>
                  <button onClick={() => syncMut.mutate()}
                    className="flex items-center gap-1.5 h-7 px-3 rounded-md text-[11px] font-[510] text-text-quaternary hover:text-text-secondary hover:bg-hover cursor-pointer transition-colors"
                    style={{ transitionDuration: '80ms' }}>
                    <RefreshCw className={`w-3 h-3 ${syncMut.isPending ? 'animate-spin' : ''}`} /> Sync to harness
                  </button>
                </div>
              </div>
              <ConnectorFormModal open={showConnectorForm} onClose={() => setShowConnectorForm(false)} />

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

          {/* Activity */}
          {tab === 'activity' && <ActivityTab />}

        </div>
      </div>
    </div>
  );
}
