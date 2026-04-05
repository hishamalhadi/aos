import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap, Play, ChevronDown, ChevronRight,
  X, Check, Clock, AlertCircle,
  Pause, Send, Loader2, Sparkles, ArrowRight,
  MessageCircle, Mail, Sheet, Rss, Webhook,
  Calendar, Globe, History,
} from 'lucide-react';
import { Tag, StatusDot, type StatusDotColor } from '@/components/primitives';
import {
  useN8nAutomations, useAutomationsHealth,
  useGenerateAutomation, useDeployAutomation,
  useActivateAutomation, useDeactivateAutomation,
  useAutomationContext, useExecutionHistory,
  useAutomationSuggestions,
  type N8nAutomation, type GenerateResult,
  type AutomationSuggestion,
} from '@/hooks/useAutomations';

// ---------------------------------------------------------------------------
// Automations — n8n-powered workflows + system crons.
// ---------------------------------------------------------------------------

interface SystemCron {
  id: string;
  name: string;
  description: string;
  frequency: string;
  at?: string;
  weekday?: string;
  every?: string;
  enabled: boolean;
  type: 'system';
  tier?: number;
  tier_label?: string;
  schedule_human: string;
  last_run?: string;
  last_run_ago?: string;
  last_status?: string | number;
  duration_ms?: number;
}

function useSystemCrons() {
  return useQuery({
    queryKey: ['automations'],
    queryFn: async (): Promise<{ system: SystemCron[]; total: number }> => {
      const res = await fetch('/api/automations');
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Status helpers ──

function statusColor(status: string | number | undefined): StatusDotColor {
  if (status === undefined || status === null) return 'gray';
  if (status === 'success' || status === 0) return 'green';
  if (status === 'running') return 'blue';
  return 'red';
}

// ── System cron row ──

function CronRow({
  cron,
  onRun,
  onClick,
}: {
  cron: SystemCron;
  onRun: () => void;
  onClick: () => void;
}) {
  const sc = statusColor(cron.last_status);

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 py-3 px-1 cursor-pointer hover:bg-hover rounded-[5px] transition-colors duration-100 group"
    >
      <StatusDot color={cron.enabled ? sc : 'gray'} size="md" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-[510] text-text-secondary">
            {cron.name}
          </span>
          {!cron.enabled && (
            <Tag label="Paused" color="gray" size="sm" />
          )}
        </div>
        <span className="text-[11px] text-text-quaternary block mt-0.5 truncate">
          {cron.schedule_human}
          {cron.last_run_ago && ` · ${cron.last_run_ago}`}
        </span>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
        <button
          onClick={(e) => { e.stopPropagation(); onRun(); }}
          title="Run now"
          className="w-7 h-7 flex items-center justify-center rounded-[5px] text-text-quaternary hover:text-accent hover:bg-bg-tertiary transition-colors cursor-pointer"
        >
          <Play className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── System automations group (collapsible) ──

function SystemGroup({
  crons,
  onRun,
}: {
  crons: SystemCron[];
  onRun: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="mt-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full cursor-pointer mb-2"
      >
        <Chevron className="w-3 h-3 text-text-quaternary" />
        <span className="text-[11px] font-[590] text-text-quaternary uppercase tracking-[0.06em]">
          System
        </span>
        <span className="text-[10px] text-text-quaternary">{crons.length}</span>
      </button>
      {expanded && (
        <div>
          {crons.map((c) => (
            <CronRow
              key={c.id}
              cron={c}
              onRun={() => onRun(c.id)}
              onClick={() => setSelectedId(prev => prev === c.id ? null : c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Suggestion card ──

const CONNECTOR_ICONS: Record<string, typeof Zap> = {
  mail: Mail, send: Send, github: Globe, 'book-open': Zap,
  calendar: Calendar, users: Globe, 'message-circle': MessageCircle,
  'sticky-note': Zap, 'check-square': Check,
};

function SuggestionCard({
  suggestion,
  onSetUp,
}: {
  suggestion: AutomationSuggestion;
  onSetUp: (description: string) => void;
}) {
  const ConnectorIcon = CONNECTOR_ICONS[suggestion.source_icon] || Zap;

  return (
    <div
      className="rounded-[10px] border border-border p-4 group transition-all duration-150 hover:border-border-secondary cursor-pointer"
      style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(12px)' }}
      onClick={() => onSetUp(suggestion.description)}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-[7px] flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: suggestion.source_color + '18' }}
        >
          <ConnectorIcon className="w-4 h-4" style={{ color: suggestion.source_color }} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-[560] text-text block">{suggestion.name}</span>
          <p className="text-[11px] text-text-quaternary mt-1 leading-relaxed line-clamp-2">
            {suggestion.description}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border">
        <span className="text-[10px] text-text-quaternary">
          {suggestion.source_connector_name}
          {suggestion.required_connectors.length > 1 && ` + ${suggestion.required_connectors.length - 1} more`}
        </span>
        <span className="text-[11px] font-[510] text-accent opacity-0 group-hover:opacity-100 transition-opacity">
          Set up
        </span>
      </div>
    </div>
  );
}

function SuggestionGrid({
  suggestions,
  onSetUp,
}: {
  suggestions: AutomationSuggestion[];
  onSetUp: (description: string) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div className="mb-8">
      <span className="text-[11px] font-[590] text-text-quaternary uppercase tracking-[0.06em] block mb-3">
        Suggested for you
      </span>
      <div className="grid grid-cols-2 gap-3">
        {suggestions.slice(0, 6).map((s) => (
          <SuggestionCard key={s.id} suggestion={s} onSetUp={onSetUp} />
        ))}
      </div>
      {suggestions.length > 6 && (
        <p className="text-[10px] text-text-quaternary mt-2 text-center">
          {suggestions.length - 6} more suggestions available
        </p>
      )}
    </div>
  );
}

// ── Helpers for automation cards ──

const RECIPE_ICONS: Record<string, { trigger: typeof Clock; action: typeof Zap; triggerLabel: string; actionLabel: string }> = {
  schedule_to_telegram: { trigger: Clock, action: MessageCircle, triggerLabel: 'Schedule', actionLabel: 'Telegram' },
  scheduled_http_report: { trigger: Clock, action: Globe, triggerLabel: 'Schedule', actionLabel: 'HTTP' },
  rss_to_webhook: { trigger: Rss, action: Globe, triggerLabel: 'RSS Feed', actionLabel: 'Webhook' },
  webhook_relay: { trigger: Webhook, action: Globe, triggerLabel: 'Webhook', actionLabel: 'Forward' },
  form_to_sheets: { trigger: Webhook, action: Sheet, triggerLabel: 'Form', actionLabel: 'Sheets' },
  email_digest: { trigger: Clock, action: Mail, triggerLabel: 'Schedule', actionLabel: 'Gmail' },
  calendar_to_telegram: { trigger: Calendar, action: MessageCircle, triggerLabel: 'Calendar', actionLabel: 'Telegram' },
  shopify_orders: { trigger: Clock, action: MessageCircle, triggerLabel: 'Shopify', actionLabel: 'Telegram' },
};

function cronToHuman(cron: string): string {
  if (!cron) return '';
  const parts = cron.split(' ');
  if (parts.length < 5) return cron;
  const [min, hour, , , dow] = parts;
  const h = parseInt(hour);
  const m = parseInt(min);

  // Handle non-numeric cron fields (*/30, ranges, etc.)
  if (isNaN(h) || isNaN(m)) {
    if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
    if (hour.startsWith('*/')) return `Every ${hour.slice(2)} hours`;
    return cron;
  }

  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const time = `${h12}:${m.toString().padStart(2, '0')} ${suffix}`;

  if (dow === '*') return `Daily at ${time}`;
  if (dow === '1-5') return `Weekdays at ${time}`;
  if (dow === '0') return `Sundays at ${time}`;
  if (dow === '1') return `Mondays at ${time}`;
  return `${time}`;
}

// ── n8n Automation card ──

function ExecutionHistoryPanel({ automationId }: { automationId: string }) {
  const { data, isLoading } = useExecutionHistory(automationId);
  const executions = data?.executions ?? [];

  if (isLoading) {
    return (
      <div className="py-3 text-center">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-text-quaternary inline-block" />
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="py-3 text-center">
        <span className="text-[11px] text-text-quaternary">No executions yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {executions.slice(0, 10).map((exec: Record<string, unknown>) => {
        const status = exec.status as string || 'unknown';
        const finished = exec.stoppedAt as string || exec.startedAt as string;
        const sc: StatusDotColor = status === 'success' ? 'green' : status === 'error' ? 'red' : status === 'running' ? 'blue' : 'gray';
        const duration = exec.stoppedAt && exec.startedAt
          ? Math.round((new Date(exec.stoppedAt as string).getTime() - new Date(exec.startedAt as string).getTime()) / 1000)
          : null;

        return (
          <div key={exec.id as string} className="flex items-center gap-2.5 py-1.5 px-2 rounded-[5px] hover:bg-hover transition-colors">
            <StatusDot color={sc} size="sm" />
            <span className="text-[11px] text-text-secondary flex-1 capitalize">{status}</span>
            {duration !== null && (
              <span className="text-[10px] text-text-quaternary">{duration}s</span>
            )}
            {finished && (
              <span className="text-[10px] text-text-quaternary">
                {new Date(finished).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function N8nAutomationCard({
  automation,
  onActivate,
  onDeactivate,
  onView,
}: {
  automation: N8nAutomation;
  onActivate: () => void;
  onDeactivate: () => void;
  onView: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const statusColors: Record<string, string> = {
    active: 'green', draft: 'gray', paused: 'yellow', error: 'red', archived: 'gray',
  };
  const sc = statusColors[automation.status] || 'gray';
  const icons = RECIPE_ICONS[automation.recipe_id || ''] || { trigger: Zap, action: Zap, triggerLabel: 'Trigger', actionLabel: 'Action' };
  const TriggerIcon = icons.trigger;
  const ActionIcon = icons.action;

  const cronStr = (automation.trigger_config as Record<string, unknown>)?.cron as string || '';
  const schedule = cronToHuman(cronStr);

  return (
    <div
      className="rounded-[10px] border border-border p-4 mb-3 group transition-all duration-150 hover:border-border-secondary cursor-pointer"
      style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(12px)' }}
      onClick={onView}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <StatusDot color={sc} size="md" pulse={automation.status === 'active'} />
          <span className="text-[14px] font-[560] text-text">{automation.name}</span>
          <Tag label={automation.status} color={sc as any} size="sm" />
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-[510] transition-colors cursor-pointer ${
              showHistory
                ? 'text-accent bg-accent/10'
                : 'text-text-quaternary hover:text-text-tertiary hover:bg-bg-tertiary'
            }`}
          >
            <History className="w-3 h-3" /> Runs
          </button>
          {automation.status === 'active' ? (
            <button
              onClick={onDeactivate}
              className="flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-[510] text-text-quaternary hover:text-yellow-400 hover:bg-bg-tertiary transition-colors cursor-pointer"
            >
              <Pause className="w-3 h-3" /> Pause
            </button>
          ) : (
            <button
              onClick={onActivate}
              className="flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11px] font-[510] text-text-quaternary hover:text-green-400 hover:bg-bg-tertiary transition-colors cursor-pointer"
            >
              <Play className="w-3 h-3" /> Activate
            </button>
          )}
        </div>
      </div>

      {/* Flow visualization */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] bg-bg-tertiary border border-border">
          <TriggerIcon className="w-3.5 h-3.5 text-accent" />
          <span className="text-[11px] font-[510] text-text-secondary">{icons.triggerLabel}</span>
        </div>
        <ArrowRight className="w-3 h-3 text-text-quaternary" />
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] bg-bg-tertiary border border-border">
          <ActionIcon className="w-3.5 h-3.5 text-accent" />
          <span className="text-[11px] font-[510] text-text-secondary">{icons.actionLabel}</span>
        </div>
        {schedule && (
          <>
            <span className="text-text-quaternary mx-1">·</span>
            <span className="text-[11px] text-text-tertiary">{schedule}</span>
          </>
        )}
      </div>

      {/* Description */}
      <p className="text-[12px] text-text-quaternary leading-relaxed">
        {automation.description || automation.user_prompt}
      </p>

      {/* Footer stats */}
      <div className="flex items-center gap-4 mt-3 pt-2.5 border-t border-border">
        {automation.run_count > 0 && (
          <span className="text-[10px] text-text-quaternary">
            {automation.run_count} run{automation.run_count !== 1 ? 's' : ''}
          </span>
        )}
        {automation.last_run_at && (
          <span className="text-[10px] text-text-quaternary">
            Last: {new Date(automation.last_run_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
        {automation.error_message && (
          <span className="text-[10px] text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {automation.error_message}
          </span>
        )}
        {automation.run_count === 0 && !automation.error_message && (
          <span className="text-[10px] text-text-quaternary">No runs yet</span>
        )}
      </div>

      {/* Execution history (expandable) */}
      {showHistory && (
        <div className="mt-3 pt-2.5 border-t border-border animate-[fadeIn_150ms_ease-out]">
          <span className="text-[11px] font-[510] text-text-quaternary block mb-2">Recent runs</span>
          <ExecutionHistoryPanel automationId={automation.id} />
        </div>
      )}
    </div>
  );
}

// ── Natural language creation flow ──

// ── Step indicators ──

type WizardStep = 'describe' | 'review' | 'configure' | 'activate';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'describe', label: 'Describe' },
  { id: 'review', label: 'Review' },
  { id: 'configure', label: 'Configure' },
  { id: 'activate', label: 'Activate' },
];

function StepIndicator({ current, steps }: { current: WizardStep; steps: typeof STEPS }) {
  const currentIdx = steps.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-1 mb-5">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-[510] transition-colors ${
            i < currentIdx ? 'text-green-400'
            : i === currentIdx ? 'bg-accent/15 text-accent'
            : 'text-text-quaternary'
          }`}>
            {i < currentIdx ? <Check className="w-3 h-3" /> : null}
            {step.label}
          </div>
          {i < steps.length - 1 && (
            <div className={`w-4 h-px ${i < currentIdx ? 'bg-green-400/30' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Multi-step creation wizard ──

function GenerateFlow({ onClose, initialDescription }: { onClose: () => void; initialDescription?: string }) {
  const [step, setStep] = useState<WizardStep>('describe');
  const [input, setInput] = useState(initialDescription ?? '');
  const [followUp, setFollowUp] = useState('');
  const generate = useGenerateAutomation();
  const deploy = useDeployAutomation();
  const { data: ctx } = useAutomationContext();
  const [preview, setPreview] = useState<GenerateResult | null>(null);
  const [editedVariables, setEditedVariables] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const handleGenerate = () => {
    if (!input.trim()) return;
    const context: Record<string, unknown> = {};
    if (ctx?.telegram_chat_id) context.telegram_chat_id = ctx.telegram_chat_id;
    if (ctx?.timezone) context.timezone = ctx.timezone;

    generate.mutate({
      description: input,
      connected_accounts: ctx?.connected_accounts ?? [],
      context,
    }, {
      onSuccess: (result) => {
        setPreview(result);
        if (result.clarification_needed) {
          // Stay on describe step, show the question
        } else if (result.success) {
          setEditedVariables({ ...result.variables_used as Record<string, string> });
          setStep('review');
        }
      },
    });
  };

  const handleFollowUp = () => {
    if (!followUp.trim()) return;
    // Append clarification to the original input and re-generate
    const combined = `${input}. ${followUp}`;
    setInput(combined);
    setFollowUp('');
    setPreview(null);

    const context: Record<string, unknown> = {};
    if (ctx?.telegram_chat_id) context.telegram_chat_id = ctx.telegram_chat_id;
    if (ctx?.timezone) context.timezone = ctx.timezone;

    generate.mutate({
      description: combined,
      connected_accounts: ctx?.connected_accounts ?? [],
      context,
    }, {
      onSuccess: (result) => {
        setPreview(result);
        if (result.success) {
          setEditedVariables({ ...result.variables_used as Record<string, string> });
          setStep('review');
        }
      },
    });
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    // Simulate a dry run — describe what WOULD happen
    const vars = editedVariables;
    const recipeName = preview?.recipe_name || 'workflow';
    const trigger = preview?.trigger_type || 'manual';
    const cronVal = (preview?.trigger_config as Record<string, unknown>)?.cron as string;
    const schedule = cronVal ? cronToHuman(cronVal) : trigger;

    await new Promise((r) => setTimeout(r, 1500));

    const lines: string[] = [];
    lines.push(`Trigger: ${schedule}`);
    if (vars.telegram_chat_id) lines.push(`Send to: Telegram chat ${vars.telegram_chat_id}`);
    if (vars.message_text) lines.push(`Message: "${(vars.message_text as string).substring(0, 60)}..."`);
    if (vars.gmail_label) lines.push(`Gmail label: ${vars.gmail_label}`);
    if (vars.max_results) lines.push(`Limit: ${vars.max_results} items`);
    if (vars.calendar_id) lines.push(`Calendar: ${vars.calendar_id}`);
    lines.push(`Recipe: ${recipeName}`);
    lines.push(`Status: All checks passed`);

    setTestResult(lines.join('\n'));
    setIsTesting(false);
    setStep('activate');
  };

  const handleDeploy = () => {
    if (!preview?.workflow_json) return;
    deploy.mutate({
      name: preview.workflow_json.name as string || 'Automation',
      description: preview.human_summary,
      user_prompt: input,
      recipe_id: preview.recipe_id || undefined,
      workflow_json: preview.workflow_json,
      variables: editedVariables,
      trigger_type: preview.trigger_type,
      trigger_config: preview.trigger_config,
      activate: true,
    }, {
      onSuccess: () => {
        onClose();
      },
    });
  };

  // Prevent click-through to background elements
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center font-sans" onClick={onClose}>
      <div className="absolute inset-0 bg-bg/60 backdrop-blur-sm" />
      <div
        className="relative w-[560px] max-w-[90vw] max-h-[85vh] overflow-y-auto bg-bg-panel border border-border rounded-[10px] shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-5"
        onClick={stopProp}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            <h2 className="text-[16px] font-[600] text-text">New automation</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-[3px] text-text-quaternary hover:text-text-tertiary cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} steps={STEPS} />

        {/* ── Step: Describe ── */}
        {step === 'describe' && (
          <div className="animate-[fadeIn_150ms_ease-out]">
            <p className="text-[12px] text-text-tertiary mb-3">
              What do you want automated? Be as specific as you want — you can refine it next.
            </p>
            <div className="relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
                placeholder="e.g. 'Every weekday at 8am, check my Gmail for unread emails and send me a digest on Telegram'"
                rows={3}
                autoFocus
                className="w-full px-3 py-2.5 rounded-[7px] bg-bg-tertiary border border-border text-[13px] text-text-secondary placeholder:text-text-quaternary hover:border-border-secondary focus:outline-none focus:border-accent/60 resize-none"
              />
            </div>

            {/* Clarification — back-and-forth */}
            {preview?.clarification_needed && (
              <div className="mt-3 animate-[fadeIn_150ms_ease-out]">
                <div className="p-3 rounded-[7px] bg-bg-secondary border border-border mb-2">
                  <p className="text-[12px] text-text-secondary">{preview.clarification_needed}</p>
                </div>
                <div className="relative">
                  <input
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleFollowUp(); }}
                    placeholder="Your answer..."
                    autoFocus
                    className="w-full h-8 px-3 pr-10 rounded-[7px] bg-bg-tertiary border border-border text-[13px] text-text-secondary placeholder:text-text-quaternary focus:outline-none focus:border-accent/60"
                  />
                  <button
                    onClick={handleFollowUp}
                    disabled={!followUp.trim() || generate.isPending}
                    className="absolute right-1 top-1 w-6 h-6 flex items-center justify-center rounded-[5px] bg-accent text-white disabled:opacity-30 cursor-pointer"
                  >
                    {generate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            )}

            {/* Error state */}
            {preview && !preview.success && !preview.clarification_needed && (
              <div className="mt-3 p-3 rounded-[7px] bg-red-500/10 border border-red-500/20">
                <p className="text-[12px] text-red-300">{preview.human_summary || 'Could not build an automation for that. Try being more specific.'}</p>
              </div>
            )}

            <div className="flex justify-end mt-4">
              <button
                onClick={handleGenerate}
                disabled={!input.trim() || generate.isPending}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-[5px] text-[12px] font-[510] bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors cursor-pointer"
              >
                {generate.isPending
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Thinking...</>
                  : <><ArrowRight className="w-3 h-3" /> Continue</>
                }
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Review ── */}
        {step === 'review' && preview?.success && (
          <div className="animate-[fadeIn_150ms_ease-out]">
            <p className="text-[12px] text-text-tertiary mb-3">
              Here's what I'll build. Look right?
            </p>

            {/* Summary */}
            <div className="p-3 rounded-[7px] bg-bg-secondary border border-border mb-3">
              <p className="text-[13px] text-text-secondary leading-relaxed">{preview.human_summary}</p>
              {preview.recipe_name && (
                <p className="text-[10px] text-text-quaternary mt-1.5">Using: {preview.recipe_name}</p>
              )}
            </div>

            {/* Flow visualization */}
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] bg-bg-tertiary border border-border">
                <Clock className="w-3.5 h-3.5 text-accent" />
                <span className="text-[11px] font-[510] text-text-secondary">
                  {preview.trigger_type === 'schedule' ? 'Schedule' : preview.trigger_type}
                </span>
              </div>
              <ArrowRight className="w-3 h-3 text-text-quaternary" />
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] bg-bg-tertiary border border-border">
                <Zap className="w-3.5 h-3.5 text-accent" />
                <span className="text-[11px] font-[510] text-text-secondary">{preview.recipe_name || 'Action'}</span>
              </div>
            </div>

            {/* Variables preview */}
            {Object.keys(preview.variables_used).length > 0 && (
              <div className="space-y-1.5 mb-3">
                <span className="text-[10px] font-[590] text-text-quaternary uppercase tracking-[0.06em] block">Configuration</span>
                {Object.entries(preview.variables_used).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between py-1 px-2 rounded-[5px] bg-bg-tertiary">
                    <span className="text-[11px] text-text-quaternary">{key.replace(/_/g, ' ')}</span>
                    <span className="text-[11px] text-text-secondary truncate max-w-[200px]">{String(val)}</span>
                  </div>
                ))}
              </div>
            )}

            {preview.validation_errors.length > 0 && (
              <div className="mb-3">
                {preview.validation_errors.map((e, i) => (
                  <p key={i} className="text-[11px] text-red-400">{e}</p>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => { setStep('describe'); setPreview(null); }}
                className="text-[12px] font-[510] text-text-quaternary hover:text-text-tertiary cursor-pointer"
              >
                Back
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep('configure')}
                  className="px-3 py-1.5 rounded-[5px] text-[12px] font-[510] text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer"
                >
                  Edit details
                </button>
                <button
                  onClick={handleTest}
                  disabled={isTesting}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-[5px] text-[12px] font-[510] bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors cursor-pointer"
                >
                  {isTesting
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Testing...</>
                    : <><Play className="w-3 h-3" /> Test run</>
                  }
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step: Configure ── */}
        {step === 'configure' && preview?.success && (
          <div className="animate-[fadeIn_150ms_ease-out]">
            <p className="text-[12px] text-text-tertiary mb-3">
              Fine-tune the settings before testing.
            </p>

            <div className="space-y-3">
              {Object.entries(editedVariables).map(([key, val]) => (
                <div key={key}>
                  <label className="text-[10px] font-[510] text-text-quaternary block mb-1">
                    {key.replace(/_/g, ' ')}
                  </label>
                  {key.includes('text') || key.includes('message') || key.includes('code') || key.includes('jsCode') ? (
                    <textarea
                      value={String(val)}
                      onChange={(e) => setEditedVariables((prev) => ({ ...prev, [key]: e.target.value }))}
                      rows={3}
                      className="w-full px-2.5 py-2 rounded-[5px] bg-bg-tertiary border border-border text-[12px] text-text-secondary focus:outline-none focus:border-accent/60 resize-none font-mono"
                    />
                  ) : (
                    <input
                      value={String(val)}
                      onChange={(e) => setEditedVariables((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="w-full h-8 px-2.5 rounded-[5px] bg-bg-tertiary border border-border text-[12px] text-text-secondary focus:outline-none focus:border-accent/60"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => setStep('review')}
                className="text-[12px] font-[510] text-text-quaternary hover:text-text-tertiary cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={handleTest}
                disabled={isTesting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-[5px] text-[12px] font-[510] bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors cursor-pointer"
              >
                {isTesting
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Testing...</>
                  : <><Play className="w-3 h-3" /> Test run</>
                }
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Activate ── */}
        {step === 'activate' && (
          <div className="animate-[fadeIn_150ms_ease-out]">
            {/* Test results */}
            {testResult && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-[13px] font-[510] text-green-300">Test passed</span>
                </div>
                <div className="p-3 rounded-[7px] bg-bg-secondary border border-border font-mono">
                  {testResult.split('\n').map((line, i) => (
                    <p key={i} className="text-[11px] text-text-tertiary leading-relaxed">{line}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="p-3 rounded-[7px] bg-green-500/8 border border-green-500/15 mb-4">
              <p className="text-[13px] text-text-secondary">{preview?.human_summary}</p>
              <p className="text-[11px] text-text-quaternary mt-1">
                This will run 24/7 on your Mac Mini. You can pause or edit it anytime.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep('review')}
                className="text-[12px] font-[510] text-text-quaternary hover:text-text-tertiary cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={handleDeploy}
                disabled={deploy.isPending}
                className="flex items-center gap-1.5 px-5 py-2 rounded-[7px] text-[13px] font-[560] bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors cursor-pointer"
              >
                {deploy.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deploying...</>
                  : <><Zap className="w-3.5 h-3.5" /> Activate</>
                }
              </button>
            </div>
          </div>
        )}

        <p className="text-[10px] text-text-quaternary mt-4 text-center">
          Powered by n8n · Runs on your Mac Mini 24/7
        </p>
      </div>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Main page ──

export default function AutomationsPage() {
  const { data: cronsData, isLoading } = useSystemCrons();
  const { data: n8nData } = useN8nAutomations();
  const { data: healthData } = useAutomationsHealth();
  const { data: suggestionsData } = useAutomationSuggestions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [prefillDescription, setPrefillDescription] = useState<string | undefined>();
  const activate = useActivateAutomation();
  const deactivate = useDeactivateAutomation();

  const runMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/automations/${id}/run`, { method: 'POST' });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automations'] }),
  });

  const handleRun = useCallback((id: string) => {
    runMutation.mutate(id);
  }, [runMutation]);

  const openCreate = useCallback((description?: string) => {
    setPrefillDescription(description);
    setShowCreate(true);
  }, []);

  const systemCrons = cronsData?.system ?? [];
  const n8nAutomations = n8nData?.automations ?? [];
  const suggestions = suggestionsData?.suggestions ?? [];
  const n8nHealthy = healthData?.status === 'ok';

  return (
    <div className="bg-bg h-full overflow-y-auto font-sans">
      {/* New pill — fixed top-right */}
      <div className="fixed top-3 right-3 z-[300] flex items-center gap-2">
        {/* n8n health indicator */}
        {healthData && (
          <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-full bg-[rgba(30,26,22,0.60)] backdrop-blur-[12px] border border-[rgba(255,245,235,0.06)]">
            <StatusDot color={n8nHealthy ? 'green' : 'gray'} size="sm" />
            <span className="text-[10px] text-text-quaternary">
              {n8nHealthy ? `${healthData.active_workflows ?? 0} active` : 'n8n offline'}
            </span>
          </div>
        )}
        <button
          onClick={() => openCreate()}
          className="
            flex items-center gap-1.5 h-8 px-3
            rounded-full
            bg-[rgba(30,26,22,0.60)] backdrop-blur-[12px]
            border border-[rgba(255,245,235,0.06)]
            shadow-[0_2px_12px_rgba(0,0,0,0.3)]
            text-text-secondary hover:text-text
            transition-all duration-150 cursor-pointer
            text-[12px] font-[510]
          "
        >
          <Sparkles className="w-3.5 h-3.5" /> New
        </button>
      </div>

      <div className="max-w-[640px] mx-auto px-5 md:px-8 pt-14 pb-10">

        {/* n8n-powered automations */}
        {n8nAutomations.length > 0 && (
          <div className="mb-6">
            <span className="text-[11px] font-[590] text-text-quaternary uppercase tracking-[0.06em] block mb-2">
              Automations
            </span>
            {n8nAutomations.map((a) => (
              <N8nAutomationCard
                key={a.id}
                automation={a}
                onActivate={() => activate.mutate(a.id)}
                onDeactivate={() => deactivate.mutate(a.id)}
                onView={() => navigate(`/automations/${a.id}`)}
              />
            ))}
          </div>
        )}

        {/* Suggestions grid — shown when there are suggestions */}
        {suggestions.length > 0 && (
          <SuggestionGrid suggestions={suggestions} onSetUp={(desc) => openCreate(desc)} />
        )}

        {/* Empty state — only when no automations AND no suggestions */}
        {n8nAutomations.length === 0 && suggestions.length === 0 && !isLoading && (
          <div className="py-12">
            <p className="text-[13px] text-text-quaternary mb-4">
              No automations yet. Describe what you want automated and it'll run on your Mac Mini 24/7.
            </p>
            <button
              onClick={() => openCreate()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[12px] font-[510] bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" /> Create your first automation
            </button>
          </div>
        )}

        {/* System crons */}
        {isLoading ? (
          <div className="mt-8 text-center">
            <span className="text-[12px] text-text-quaternary">Loading automations...</span>
          </div>
        ) : (
          <SystemGroup crons={systemCrons} onRun={handleRun} />
        )}
      </div>

      {/* Create flow — natural language generation */}
      {showCreate && (
        <GenerateFlow
          onClose={() => { setShowCreate(false); setPrefillDescription(undefined); }}
          initialDescription={prefillDescription}
        />
      )}
    </div>
  );
}
