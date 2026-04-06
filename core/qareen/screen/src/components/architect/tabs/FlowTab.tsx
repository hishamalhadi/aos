/**
 * FlowTab — Interactive vertical step card flow.
 *
 * Three-layer step cards:
 *   Layer 1: Natural language summary (collapsed) — readable one-liner from params
 *   Layer 2: Template variable chips (expanded) — {{refs}} as colored pills
 *   Layer 3: Completeness indicator — green/amber/red dot per required field coverage
 */
import { useCallback, useState } from 'react';
import { Check, ChevronRight, GripVertical, Trash2, Workflow, AlertTriangle } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getStepIcon, STEP_COLORS } from '../constants';
import { getNodeDef, getNodeDefOrDefault } from '@/components/flow-editor/constants';
import type { FieldSchema } from '@/components/flow-editor/types';
import { useArchitectStore } from '@/store/architect';
import { useConnectorStatus, getNodeConnectionStatus, type NodeTypeStatus } from '@/hooks/useConnectorStatus';
import { StepInsertButton } from '../steps/StepInsertButton';
import { ConnectorSetupPopover } from '../ConnectorSetupPopover';

type NodeTypesMap = Record<string, NodeTypeStatus>;

// ── Helpers ──

/** Resolve a dotted key like "rule.interval[0].expression" from a params object */
function resolveParam(params: Record<string, unknown>, key: string): unknown {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  let val: unknown = params;
  for (const p of parts) {
    if (val == null || typeof val !== 'object') return undefined;
    val = (val as Record<string, unknown>)[p];
  }
  return val;
}

/** Get display value for a parameter — truncate long strings */
function displayValue(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val.length > 60 ? val.slice(0, 57) + '...' : val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return JSON.stringify(val).slice(0, 60);
}

/** Build a natural-language summary from step params + node definition */
function buildSummary(step: any, n8nType: string): string {
  const params = step.parameters || {};
  const def = getNodeDef(n8nType);

  // Special cases for common types
  if (n8nType === 'aos.agentDispatch') {
    const agent = step.agent_id || params.agent_id || '?';
    const task = params.task ? String(params.task).slice(0, 40) : '';
    return task ? `Ask @${agent}: "${task}${String(params.task).length > 40 ? '...' : ''}"` : `Dispatch @${agent}`;
  }
  if (n8nType === 'n8n-nodes-base.gmail') {
    const op = params.operation || 'getAll';
    if (op === 'send') return `Send email${params.subject ? ` — "${params.subject}"` : ''}`;
    return `Gmail: ${op}${params.limit ? ` (limit ${params.limit})` : ''}`;
  }
  if (n8nType === 'n8n-nodes-base.telegram') {
    const chatId = params.chatId ? String(params.chatId).slice(0, 20) : '';
    return chatId ? `Message → ${chatId}` : 'Send Telegram message';
  }
  if (n8nType === 'n8n-nodes-base.httpRequest') {
    const method = params.method || 'GET';
    const url = params.url ? String(params.url).slice(0, 40) : '';
    return url ? `${method} ${url}` : `HTTP ${method} request`;
  }
  if (n8nType === 'n8n-nodes-base.code') {
    return 'Run JavaScript';
  }
  if (n8nType === 'n8n-nodes-base.scheduleTrigger') {
    const expr = resolveParam(params, 'rule.interval[0].expression') as string;
    return expr ? `Schedule: ${expr}` : 'Scheduled trigger';
  }

  // Generic: show first required field value, or description
  if (def?.fields.length) {
    const requiredField = def.fields.find(f => f.required);
    if (requiredField) {
      const val = resolveParam(params, requiredField.key);
      if (val) return `${def.label}: ${displayValue(val)}`;
    }
  }
  return def?.description || step.label;
}

/** Detect {{template}} vars in a string and split into segments */
type Segment = { type: 'text'; value: string } | { type: 'var'; value: string };

function parseTemplateVars(text: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /\{\{(.+?)\}\}/g;
  let last = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) segments.push({ type: 'text', value: text.slice(last, match.index) });
    segments.push({ type: 'var', value: match[1].trim() });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  return segments;
}

/** Compute completeness: fields + connector status */
function computeCompleteness(step: any, n8nType: string, nodeTypes?: NodeTypesMap): 'complete' | 'partial' | 'empty' | null {
  const def = getNodeDef(n8nType);
  if (!def) return null;
  const required = def.fields.filter(f => f.required);
  const params = step.parameters || {};
  const filled = required.filter(f => {
    const val = resolveParam(params, f.key);
    return val != null && val !== '';
  });

  const fieldStatus: 'complete' | 'partial' | 'empty' =
    required.length === 0 ? 'complete'
    : filled.length === required.length ? 'complete'
    : filled.length > 0 ? 'partial'
    : 'empty';

  // Factor in connector status
  if (nodeTypes) {
    const connStatus = getNodeConnectionStatus(nodeTypes, n8nType);
    if (connStatus === 'available' || connStatus === 'broken' || connStatus === 'unknown') {
      return fieldStatus === 'empty' ? 'empty' : 'partial';
    }
    if (connStatus === 'partial') {
      return fieldStatus === 'empty' ? 'empty' : 'partial';
    }
  }

  return fieldStatus;
}

const COMPLETENESS_COLORS = {
  complete: '#34D399',
  partial: '#F59E0B',
  empty: '#EF4444',
};

// ── Template Variable Chip ──

function VarChip({ value }: { value: string }) {
  // Parse "step1.output.email" into a friendly label
  const parts = value.split('.');
  const label = parts.length > 1 ? `${parts[0]} → ${parts[parts.length - 1]}` : value;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-[560] mx-0.5"
      style={{ background: 'rgba(217, 115, 13, 0.15)', color: '#D9730D' }}
    >
      {label}
    </span>
  );
}

/** Render a parameter value with template variable chips inline */
function ParamValue({ value }: { value: string }) {
  const segments = parseTemplateVars(value);
  if (segments.length === 1 && segments[0].type === 'text') {
    return <span className="text-text-tertiary">{segments[0].value}</span>;
  }
  return (
    <span>
      {segments.map((seg, i) =>
        seg.type === 'var'
          ? <VarChip key={i} value={seg.value} />
          : <span key={i} className="text-text-tertiary">{seg.value}</span>
      )}
    </span>
  );
}

// ── Interactive Step Card ──

// ── Editable field input ──

const fieldInputStyle: React.CSSProperties = {
  background: 'rgba(21, 18, 16, 0.6)',
  border: '1px solid rgba(255, 245, 235, 0.08)',
};

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldSchema;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const strVal = value != null ? String(value) : '';

  if (field.type === 'select' && field.options) {
    return (
      <select
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
        className="text-[10px] text-text-secondary rounded-[4px] px-1.5 py-1 w-full focus:outline-none focus:border-accent/40"
        style={fieldInputStyle}
      >
        {!strVal && <option value="">Select...</option>}
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  if (field.type === 'textarea') {
    return (
      <textarea
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        rows={2}
        className="text-[10px] text-text-secondary rounded-[4px] px-1.5 py-1 w-full resize-none focus:outline-none focus:border-accent/40"
        style={fieldInputStyle}
      />
    );
  }

  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={strVal}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
        placeholder={field.placeholder}
        className="text-[10px] text-text-secondary rounded-[4px] px-1.5 py-1 w-full focus:outline-none focus:border-accent/40"
        style={fieldInputStyle}
      />
    );
  }

  if (field.type === 'toggle') {
    return (
      <button
        onClick={() => onChange(!value)}
        className="w-7 h-4 rounded-full relative cursor-pointer transition-colors"
        style={{ background: value ? '#D9730D' : 'rgba(255,245,235,0.1)' }}
      >
        <div
          className="w-3 h-3 rounded-full bg-white absolute top-0.5 transition-[left]"
          style={{ left: value ? 12 : 2 }}
        />
      </button>
    );
  }

  // Default: text input
  return (
    <input
      type="text"
      value={strVal}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      className="text-[10px] text-text-secondary rounded-[4px] px-1.5 py-1 w-full focus:outline-none focus:border-accent/40"
      style={fieldInputStyle}
    />
  );
}

// ── Interactive Step Card ──

function SortableStepCard({
  step,
  pipelineId,
  isExpanded,
  onToggle,
  nodeTypes,
  onConnect,
}: {
  step: any;
  pipelineId: string;
  isExpanded: boolean;
  onToggle: () => void;
  nodeTypes: NodeTypesMap;
  onConnect: (connectorId: string) => void;
}) {
  const updateStepParam = useArchitectStore((s) => s.updateStepParam);
  const removeStep = useArchitectStore((s) => s.removeStep);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const n8nType = step.n8n_type || (step.type === 'agent_dispatch' ? 'aos.agentDispatch' : '');
  const Icon = getStepIcon(n8nType);
  const color = STEP_COLORS[n8nType] || '#6B6560';
  const summary = buildSummary(step, n8nType);
  const completeness = computeCompleteness(step, n8nType, nodeTypes);
  const connStatus = getNodeConnectionStatus(nodeTypes, n8nType);
  const connEntry = nodeTypes[n8nType];
  const needsConnect = connStatus === 'available' || connStatus === 'broken' || connStatus === 'partial';
  const def = getNodeDef(n8nType);
  const params = step.parameters || {};

  const fields: FieldSchema[] = def?.fields || [];
  const paramEntries = Object.entries(params).filter(
    ([k]) => !['additionalFields', 'options'].includes(k)
  );

  const handleParamChange = useCallback((key: string, value: unknown) => {
    updateStepParam(pipelineId, step.id, key, value);
  }, [updateStepParam, pipelineId, step.id]);

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-3 group/step">
      {/* Icon column + connector */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className="w-7 h-7 rounded-[7px] flex items-center justify-center relative"
          style={{ background: `${color}20` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color }} />
          {completeness && (
            <div
              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-bg"
              style={{ background: COMPLETENESS_COLORS[completeness] }}
            />
          )}
        </div>
        <div className="w-px flex-1 min-h-[16px] bg-border-secondary" />
      </div>

      {/* Content */}
      <div className="pb-4 min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {/* Drag handle */}
          <button
            {...attributes}
            {...listeners}
            className="opacity-0 group-hover/step:opacity-100 transition-opacity cursor-grab active:cursor-grabbing shrink-0 -ml-1"
            tabIndex={-1}
          >
            <GripVertical className="w-3 h-3 text-text-quaternary" />
          </button>

          {/* Expand toggle */}
          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 flex-1 text-left cursor-pointer min-w-0"
          >
            <ChevronRight
              className="w-3 h-3 text-text-quaternary transition-transform shrink-0"
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            />
            <span className="text-[12px] font-[560] text-text truncate">{step.label}</span>
          </button>

          {/* Delete button */}
          <button
            onClick={() => removeStep(pipelineId, step.id)}
            className="opacity-0 group-hover/step:opacity-100 transition-opacity cursor-pointer shrink-0 p-0.5 rounded hover:bg-red-500/10"
            title="Remove step"
          >
            <Trash2 className="w-3 h-3 text-text-quaternary hover:text-red-400" />
          </button>
        </div>

        {/* Layer 1: Summary */}
        <p className="text-[10px] text-text-quaternary mt-0.5 ml-[18px] leading-[1.4]">
          {summary}
        </p>

        {/* Connector status banner */}
        {needsConnect && connEntry && (
          <button
            onClick={() => onConnect(connEntry.connector_id)}
            className="flex items-center gap-1.5 mt-1.5 ml-[18px] px-2 py-1 rounded-[6px] text-left cursor-pointer transition-colors hover:brightness-110"
            style={{
              background: connStatus === 'broken' ? 'rgba(255, 69, 58, 0.08)' : 'rgba(255, 214, 10, 0.06)',
              border: `1px solid ${connStatus === 'broken' ? 'rgba(255, 69, 58, 0.12)' : 'rgba(255, 214, 10, 0.10)'}`,
            }}
          >
            <AlertTriangle className="w-2.5 h-2.5 shrink-0" style={{ color: connStatus === 'broken' ? '#FF453A' : '#FFD60A' }} />
            <span className="text-[9px] text-text-tertiary">
              {connEntry.connector_name} {connStatus === 'partial' ? 'partially configured' : 'not connected'}
            </span>
            <span className="text-[9px] font-[560] text-accent ml-auto">Connect</span>
          </button>
        )}

        {/* Layer 2: Editable parameters */}
        {isExpanded && (
          <div
            className="mt-2 ml-[18px] rounded-[8px] px-3 py-2 space-y-2"
            style={{
              background: 'rgba(30, 26, 22, 0.5)',
              border: '1px solid rgba(255, 245, 235, 0.04)',
            }}
          >
            {fields.length > 0 ? (
              fields.map(field => {
                const val = resolveParam(params, field.key);
                return (
                  <div key={field.key}>
                    <label className="text-[10px] font-[560] text-text-quaternary block mb-0.5">
                      {field.label}
                      {field.required && <span className="text-red-400 ml-0.5">*</span>}
                    </label>
                    <FieldInput
                      field={field}
                      value={val}
                      onChange={(v) => handleParamChange(field.key, v)}
                    />
                  </div>
                );
              })
            ) : paramEntries.length > 0 ? (
              paramEntries.map(([key, val]) => (
                <div key={key} className="flex items-start gap-2">
                  <span className="text-[10px] font-[560] text-text-quaternary shrink-0 w-[80px]">{key}</span>
                  <span className="text-[10px] min-w-0 break-all">
                    <ParamValue value={displayValue(val)} />
                  </span>
                </div>
              ))
            ) : (
              <span className="text-[10px] text-text-quaternary/50 italic">No parameters</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Flow Tab ──

/** Generate a unique step ID */
let stepCounter = 0;
function newStepId(): string {
  return `step_${Date.now()}_${++stepCounter}`;
}

export function FlowTab() {
  const spec = useArchitectStore((s) => s.spec);
  const expandedId = useArchitectStore((s) => s.expandedStepId);
  const toggleExpanded = useArchitectStore((s) => s.toggleExpandedStep);
  const reorderStep = useArchitectStore((s) => s.reorderStep);
  const addStep = useArchitectStore((s) => s.addStep);
  const { nodeTypes } = useConnectorStatus();
  const [setupConnector, setSetupConnector] = useState<string | null>(null);

  const handleDragEnd = useCallback((event: DragEndEvent, pipelineId: string, steps: any[]) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = steps.findIndex((s: any) => s.id === active.id);
    const toIndex = steps.findIndex((s: any) => s.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) {
      reorderStep(pipelineId, fromIndex, toIndex);
    }
  }, [reorderStep]);

  const handleInsert = useCallback((pipelineId: string, afterIndex: number, n8nType: string, label: string) => {
    const def = getNodeDefOrDefault(n8nType, label);
    const step = {
      id: newStepId(),
      type: n8nType.startsWith('aos.') ? (n8nType === 'aos.agentDispatch' ? 'agent_dispatch' : 'hitl_approval') : 'n8n_node',
      n8n_type: n8nType,
      label,
      parameters: { ...def.defaultParameters },
    };
    addStep(pipelineId, afterIndex, step);
  }, [addStep]);

  if (!spec || !spec.pipelines?.length) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center opacity-30">
          <Workflow className="w-8 h-8 text-text-quaternary mx-auto mb-2" />
          <p className="text-[11px] text-text-quaternary">Steps appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      {spec.pipelines.map(pipeline => {
        const triggerType = pipeline.trigger?.type || 'n8n-nodes-base.scheduleTrigger';
        const TriggerIcon = getStepIcon(triggerType);
        const triggerColor = STEP_COLORS[triggerType] || '#D9730D';
        const stepIds = pipeline.steps.map((s: any) => s.id);

        return (
          <div key={pipeline.id}>
            <span className="text-[10px] font-[590] text-text-quaternary uppercase tracking-[0.06em] block mb-3">
              {pipeline.name}
            </span>

            {/* Trigger */}
            <div className="flex items-start gap-3 mb-0">
              <div className="flex flex-col items-center shrink-0">
                <div
                  className="w-7 h-7 rounded-[7px] flex items-center justify-center"
                  style={{ background: `${triggerColor}20` }}
                >
                  <TriggerIcon className="w-3.5 h-3.5" style={{ color: triggerColor }} />
                </div>
                <div className="w-px flex-1 min-h-[16px] bg-border-secondary" />
              </div>
              <div className="pb-4">
                <span className="text-[12px] font-[560] text-text">Trigger</span>
              </div>
            </div>

            {/* Insert before first step */}
            <StepInsertButton onInsert={(type, label) => handleInsert(pipeline.id, -1, type, label)} />

            {/* Sortable steps */}
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={(e) => handleDragEnd(e, pipeline.id, pipeline.steps)}
            >
              <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
                {pipeline.steps.map((step: any, i: number) => (
                  <div key={step.id}>
                    <SortableStepCard
                      step={step}
                      pipelineId={pipeline.id}
                      isExpanded={expandedId === step.id}
                      onToggle={() => toggleExpanded(step.id)}
                      nodeTypes={nodeTypes}
                      onConnect={setSetupConnector}
                    />
                    {/* Insert after each step */}
                    <StepInsertButton onInsert={(type, label) => handleInsert(pipeline.id, i, type, label)} />
                  </div>
                ))}
              </SortableContext>
            </DndContext>

            {/* Done */}
            <div className="flex items-center gap-3 mt-1">
              <div className="w-7 h-7 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                <Check className="w-3.5 h-3.5 text-green-400" />
              </div>
              <span className="text-[11px] text-text-quaternary">Done</span>
            </div>
          </div>
        );
      })}

      {/* Setup popover for inline connect actions */}
      {setupConnector && (
        <ConnectorSetupPopover
          connectorId={setupConnector}
          onClose={() => setSetupConnector(null)}
        />
      )}
    </div>
  );
}
