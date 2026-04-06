import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  Shield,
  Users,
  Globe,
  Wrench,
  AlertTriangle,
  Code,
  Loader2,
} from 'lucide-react';
import TransitionLink from '@/components/primitives/TransitionLink';
import ConfigSection from '@/components/agents/ConfigSection';
import TagPicker from '@/components/agents/TagPicker';
import TrustSlider from '@/components/agents/TrustSlider';
import SelectField from '@/components/agents/SelectField';
import NumberField from '@/components/agents/NumberField';
import KeyValueEditor from '@/components/agents/KeyValueEditor';
import {
  useAgentConfig,
  useSaveConfig,
  useAgentOptions,
  type AgentConfig,
} from '@/hooks/useAgentConfig';

// ── Model options ──

const MODEL_OPTIONS = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'claude-sonnet-4-20250514', label: 'Sonnet 4' },
  { value: 'claude-opus-4-20250514', label: 'Opus 4' },
];

const PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'bypassPermissions', label: 'Bypass Permissions' },
  { value: 'plan', label: 'Plan' },
];

const EFFORT_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

const ISOLATION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'worktree', label: 'Worktree' },
];

const MEMORY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'user', label: 'User' },
  { value: 'project', label: 'Project' },
  { value: 'local', label: 'Local' },
];

const SCOPE_OPTIONS = [
  { value: 'global', label: 'Global' },
  { value: 'project', label: 'Project' },
];

const FAILURE_OPTIONS = [
  { value: 'escalate', label: 'Escalate' },
  { value: 'retry', label: 'Retry' },
  { value: 'degrade', label: 'Degrade' },
];

// ── Tools field — smart mode: allowlist vs blocklist ──

type ToolMode = 'all' | 'allow' | 'block';

function ToolsField({ tools, disallowed, available, onToolsChange, onDisallowedChange, disabled }: {
  tools: string[];
  disallowed: string[];
  available: string[];
  onToolsChange: (v: string[]) => void;
  onDisallowedChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  // Detect current mode from data
  const hasWildcard = tools.includes('*');
  const hasAllowlist = tools.length > 0 && !hasWildcard;
  const hasBlocklist = disallowed.length > 0;

  const initialMode: ToolMode = hasWildcard ? (hasBlocklist ? 'block' : 'all')
    : hasAllowlist ? 'allow'
    : hasBlocklist ? 'block'
    : 'all';

  const [mode, setMode] = useState<ToolMode>(initialMode);

  const handleModeChange = (newMode: ToolMode) => {
    setMode(newMode);
    if (newMode === 'all') {
      onToolsChange(['*']);
      onDisallowedChange([]);
    } else if (newMode === 'allow') {
      // Switch to allowlist — start with current tools if any, else empty
      if (hasWildcard) onToolsChange([]);
      onDisallowedChange([]);
    } else {
      // Switch to blocklist — inherit all, block specific
      onToolsChange(['*']);
      // Keep existing blocklist
    }
  };

  return (
    <div>
      <label className="block text-[11px] font-[510] text-text-quaternary mb-2">
        Tool access
      </label>

      {/* Mode toggle */}
      <div className="flex items-center gap-0.5 mb-3 bg-[rgba(255,245,235,0.03)] rounded-lg p-0.5 w-fit">
        {([
          ['all', 'All tools'],
          ['allow', 'Allow specific'],
          ['block', 'Block specific'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => !disabled && handleModeChange(key)}
            className={`h-6 px-2.5 rounded-md text-[11px] font-[510] cursor-pointer transition-all duration-100 ${
              mode === key
                ? 'bg-[rgba(255,245,235,0.08)] text-text'
                : 'text-text-quaternary hover:text-text-tertiary'
            } ${disabled ? 'opacity-50 cursor-default' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Context-dependent picker */}
      {mode === 'all' && (
        <p className="text-[12px] text-text-tertiary">
          This agent can use all available tools.
        </p>
      )}
      {mode === 'allow' && (
        <div>
          <p className="text-[11px] text-text-quaternary mb-2">Only these tools are available:</p>
          <TagPicker
            selected={hasWildcard ? [] : tools}
            available={available}
            onChange={onToolsChange}
            disabled={disabled}
          />
        </div>
      )}
      {mode === 'block' && (
        <div>
          <p className="text-[11px] text-text-quaternary mb-2">All tools except:</p>
          <TagPicker
            selected={disallowed}
            available={available}
            onChange={onDisallowedChange}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

// ── Helper: deep compare for dirty state ──

function formDiffers(form: Partial<AgentConfig>, original: AgentConfig): boolean {
  for (const key of Object.keys(form) as (keyof AgentConfig)[]) {
    const a = form[key];
    const b = original[key];
    if (a === b) continue;
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) return true;
    } else if (a !== b) {
      return true;
    }
  }
  return false;
}

// ── Agent avatar (inline to avoid circular import) ──

function AgentAvatar({ name, initials, color }: { name: string; initials: string; color: string }) {
  return (
    <div
      className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 text-[18px] font-[600]"
      style={{ backgroundColor: (color || '#6B6560') + '15', color: color || '#6B6560' }}
    >
      {initials || name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ── Main page ──

export default function AgentConfigPage() {
  const { id } = useParams<{ id: string }>();
  const { data: config, isLoading, error } = useAgentConfig(id ?? null);
  const options = useAgentOptions();
  const saveMutation = useSaveConfig();

  // Editable form state — mirrors the config shape
  const [form, setForm] = useState<Partial<AgentConfig>>({});
  const [initialized, setInitialized] = useState(false);

  // Populate form when config loads
  useEffect(() => {
    if (config && !initialized) {
      setForm({
        model: config.model,
        tools: config.tools,
        disallowed_tools: config.disallowed_tools,
        skills: config.skills,
        mcp_servers: config.mcp_servers,
        default_trust: config.default_trust,
        permission_mode: config.permission_mode,
        max_turns: config.max_turns,
        effort: config.effort,
        reports_to: config.reports_to,
        can_spawn: config.can_spawn,
        isolation: config.isolation,
        background: config.background,
        memory: config.memory,
        scope: config.scope,
        rules: config.rules,
        services: config.services,
        parameters: config.parameters,
        on_failure: config.on_failure,
        max_retries: config.max_retries,
        body: config.body,
      });
      setInitialized(true);
    }
  }, [config, initialized]);

  // Reset initialized when id changes
  useEffect(() => {
    setInitialized(false);
    setForm({});
  }, [id]);

  const isDirty = useMemo(() => {
    if (!config || !initialized) return false;
    return formDiffers(form, config);
  }, [form, config, initialized]);

  const isSystem = config?.is_system ?? false;
  const disabled = isSystem;

  // Build reports_to options
  const reportsToOptions = useMemo(() => {
    const opts = [{ value: '', label: '(none)' }];
    for (const agentId of options.agents) {
      if (agentId !== id) {
        opts.push({ value: agentId, label: agentId });
      }
    }
    return opts;
  }, [options.agents, id]);

  const updateField = useCallback(
    <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (!id || !isDirty || isSystem) return;
    saveMutation.mutate({ id, patch: form });
  }, [id, isDirty, isSystem, form, saveMutation]);

  const handleCancel = useCallback(() => {
    if (!config) return;
    setForm({
      model: config.model,
      tools: config.tools,
      disallowed_tools: config.disallowed_tools,
      skills: config.skills,
      mcp_servers: config.mcp_servers,
      default_trust: config.default_trust,
      permission_mode: config.permission_mode,
      max_turns: config.max_turns,
      effort: config.effort,
      reports_to: config.reports_to,
      can_spawn: config.can_spawn,
      isolation: config.isolation,
      background: config.background,
      memory: config.memory,
      scope: config.scope,
      rules: config.rules,
      services: config.services,
      parameters: config.parameters,
      on_failure: config.on_failure,
      max_retries: config.max_retries,
      body: config.body,
    });
  }, [config]);

  // ── Loading / error states ──

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-text-quaternary animate-spin" />
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <AlertTriangle className="w-6 h-6 text-red/60" />
        <p className="text-[13px] text-text-tertiary">
          {error ? `Failed to load config: ${(error as Error).message}` : 'Agent not found'}
        </p>
        <TransitionLink
          href="/agents"
          className="text-[12px] font-[510] text-accent hover:text-accent-hover transition-colors"
        >
          Back to Agents
        </TransitionLink>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[640px] mx-auto px-6 pt-8 pb-20">
        {/* Back link */}
        <TransitionLink
          href="/agents"
          className="inline-flex items-center gap-1.5 text-[12px] font-[510] text-text-quaternary hover:text-text-tertiary transition-colors mb-6 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Agents
        </TransitionLink>

        {/* Identity header */}
        <div className="flex items-start gap-4 mb-6">
          <AgentAvatar
            name={config.name}
            initials={config.initials}
            color={config.color}
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-[20px] font-[650] text-text tracking-[-0.02em] mb-0.5">
              {config.name}
            </h2>
            <p className="text-[13px] text-text-tertiary mb-1">{config.role}</p>
            <div className="flex items-center gap-3 text-[11px] text-text-quaternary">
              <span className="font-mono">{config.model}</span>
              <span>·</span>
              <span className="capitalize">{config.source}</span>
              {config.version && (
                <>
                  <span>·</span>
                  <span className="font-mono">v{config.version}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* System agent banner */}
        {isSystem && (
          <div className="rounded-lg border border-purple/20 bg-purple-muted px-4 py-3 mb-6">
            <p className="text-[12px] font-[510] text-purple/80">
              System agent — configuration is read-only. System agents are managed by the framework.
            </p>
          </div>
        )}

        {/* Divider */}
        <div className="h-px bg-border/40 mb-2" />

        {/* === Sections === */}

        {/* 1. Capabilities */}
        <ConfigSection
          title="Capabilities"
          icon={<Brain className="w-3.5 h-3.5" />}
          defaultOpen
          disabled={disabled}
        >
          <div className="space-y-5">
            <SelectField
              label="Model"
              value={form.model ?? config.model}
              options={MODEL_OPTIONS}
              onChange={(v) => updateField('model', v)}
              disabled={disabled}
            />

            <ToolsField
              tools={form.tools ?? config.tools}
              disallowed={form.disallowed_tools ?? config.disallowed_tools}
              available={options.tools}
              onToolsChange={(v) => updateField('tools', v)}
              onDisallowedChange={(v) => updateField('disallowed_tools', v)}
              disabled={disabled}
            />

            <div>
              <label className="block text-[11px] font-[510] text-text-quaternary mb-1.5">
                Skills
              </label>
              <TagPicker
                selected={form.skills ?? config.skills}
                available={options.skills}
                onChange={(v) => updateField('skills', v)}
                disabled={disabled}
              />
            </div>

            <div>
              <label className="block text-[11px] font-[510] text-text-quaternary mb-1.5">
                MCP servers
              </label>
              <TagPicker
                selected={form.mcp_servers ?? config.mcp_servers}
                available={options.mcpServers}
                onChange={(v) => updateField('mcp_servers', v)}
                disabled={disabled}
              />
            </div>
          </div>
        </ConfigSection>

        {/* 2. Permissions */}
        <ConfigSection
          title="Permissions"
          icon={<Shield className="w-3.5 h-3.5" />}
          defaultOpen
          disabled={disabled}
        >
          <div className="space-y-5">
            <div>
              <label className="block text-[11px] font-[510] text-text-quaternary mb-2">
                Trust level
              </label>
              <TrustSlider
                value={form.default_trust ?? config.default_trust}
                onChange={(v) => updateField('default_trust', v)}
                disabled={disabled}
              />
            </div>

            <SelectField
              label="Permission mode"
              value={form.permission_mode ?? config.permission_mode}
              options={PERMISSION_MODE_OPTIONS}
              onChange={(v) => updateField('permission_mode', v)}
              disabled={disabled}
            />

            <NumberField
              label="Max turns"
              value={form.max_turns !== undefined ? form.max_turns : config.max_turns}
              onChange={(v) => updateField('max_turns', v)}
              min={1}
              max={1000}
              disabled={disabled}
            />

            <SelectField
              label="Effort"
              value={form.effort ?? config.effort}
              options={EFFORT_OPTIONS}
              onChange={(v) => updateField('effort', v)}
              disabled={disabled}
            />
          </div>
        </ConfigSection>

        {/* 3. Orchestration */}
        <ConfigSection
          title="Orchestration"
          icon={<Users className="w-3.5 h-3.5" />}
          defaultOpen
          disabled={disabled}
        >
          <div className="space-y-5">
            <SelectField
              label="Reports to"
              value={form.reports_to ?? config.reports_to ?? ''}
              options={reportsToOptions}
              onChange={(v) => updateField('reports_to', v || null)}
              disabled={disabled}
            />

            <div>
              <label className="block text-[11px] font-[510] text-text-quaternary mb-1.5">
                Can spawn
              </label>
              <TagPicker
                selected={form.can_spawn ?? config.can_spawn}
                available={options.agents.filter((a) => a !== id)}
                onChange={(v) => updateField('can_spawn', v)}
                disabled={disabled}
              />
            </div>

            <SelectField
              label="Isolation"
              value={form.isolation ?? config.isolation}
              options={ISOLATION_OPTIONS}
              onChange={(v) => updateField('isolation', v)}
              disabled={disabled}
            />

            <div className="flex items-center justify-between">
              <label className="text-[11px] font-[510] text-text-quaternary">
                Background
              </label>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  updateField('background', !(form.background ?? config.background))
                }
                className={`w-9 h-5 rounded-full transition-colors cursor-pointer disabled:cursor-default ${
                  (form.background ?? config.background)
                    ? 'bg-accent'
                    : 'bg-[rgba(255,245,235,0.10)]'
                }`}
                style={{ transitionDuration: '80ms' }}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                    (form.background ?? config.background)
                      ? 'translate-x-[18px]'
                      : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>

            <SelectField
              label="Memory"
              value={form.memory ?? config.memory}
              options={MEMORY_OPTIONS}
              onChange={(v) => updateField('memory', v)}
              disabled={disabled}
            />
          </div>
        </ConfigSection>

        {/* 4. Context */}
        <ConfigSection
          title="Context"
          icon={<Globe className="w-3.5 h-3.5" />}
          defaultOpen
          disabled={disabled}
        >
          <div className="space-y-5">
            <SelectField
              label="Scope"
              value={form.scope ?? config.scope}
              options={SCOPE_OPTIONS}
              onChange={(v) => updateField('scope', v)}
              disabled={disabled}
            />

            <div>
              <label className="block text-[11px] font-[510] text-text-quaternary mb-1.5">
                Rules
              </label>
              <TagPicker
                selected={form.rules ?? config.rules}
                available={options.rules}
                onChange={(v) => updateField('rules', v)}
                disabled={disabled}
              />
            </div>

            <div>
              <label className="block text-[11px] font-[510] text-text-quaternary mb-1.5">
                Services
              </label>
              <TagPicker
                selected={form.services ?? config.services}
                available={options.services}
                onChange={(v) => updateField('services', v)}
                disabled={disabled}
              />
            </div>
          </div>
        </ConfigSection>

        {/* 5. Parameters */}
        <ConfigSection
          title="Parameters"
          icon={<Wrench className="w-3.5 h-3.5" />}
          disabled={disabled}
        >
          <KeyValueEditor
            entries={(form.parameters ?? config.parameters) as Record<string, string>}
            onChange={(v) => updateField('parameters', v)}
            disabled={disabled}
          />
        </ConfigSection>

        {/* 6. Failure */}
        <ConfigSection
          title="Failure"
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          disabled={disabled}
        >
          <div className="space-y-5">
            <SelectField
              label="On failure"
              value={form.on_failure ?? config.on_failure}
              options={FAILURE_OPTIONS}
              onChange={(v) => updateField('on_failure', v)}
              disabled={disabled}
            />

            <NumberField
              label="Max retries"
              value={
                form.max_retries !== undefined ? form.max_retries : config.max_retries
              }
              onChange={(v) => updateField('max_retries', v ?? 0)}
              min={0}
              max={10}
              disabled={disabled}
            />
          </div>
        </ConfigSection>

        {/* 7. Prompt */}
        <ConfigSection
          title="Prompt"
          icon={<Code className="w-3.5 h-3.5" />}
          defaultOpen
          disabled={disabled}
        >
          <textarea
            value={form.body ?? config.body}
            onChange={(e) => updateField('body', e.target.value)}
            disabled={disabled}
            className="w-full min-h-[300px] px-4 py-3 rounded-lg border border-border-secondary bg-bg-secondary text-[12px] font-mono leading-[1.6] text-text-secondary placeholder:text-text-quaternary outline-none resize-y disabled:opacity-50 disabled:cursor-default transition-colors focus:border-border-tertiary"
            style={{ transitionDuration: '80ms' }}
          />
        </ConfigSection>
      </div>

      {/* Sticky save bar */}
      {isDirty && !isSystem && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pb-4 pointer-events-none">
          <div
            className="pointer-events-auto flex items-center gap-4 h-12 px-5 rounded-full border border-border"
            style={{
              background: 'rgba(30, 26, 22, 0.60)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            }}
          >
            <span className="text-[12px] font-[510] text-text-secondary">
              Unsaved changes
            </span>
            <button
              type="button"
              onClick={handleCancel}
              className="h-7 px-3 rounded-md text-[12px] font-[510] text-text-tertiary hover:text-text-secondary hover:bg-hover cursor-pointer transition-colors"
              style={{ transitionDuration: '80ms' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="h-7 px-4 rounded-md bg-accent hover:bg-accent-hover text-[12px] font-[510] text-white cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ transitionDuration: '80ms' }}
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
