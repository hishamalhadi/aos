/**
 * FlowEditor — Main 3-panel workflow editor.
 *
 * Layout:
 * - Left: Node palette (edit mode only)
 * - Center: React Flow canvas
 * - Right: Node config panel (when a node is selected)
 * - Top: Toolbar with name, save, mode toggle, back
 */
import { useEffect, useCallback } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ArrowLeft, Save, Eye, Edit3, Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import FlowCanvas from './FlowCanvas';
import NodePalette from './panels/NodePalette';
import NodeConfigPanel from './panels/NodeConfigPanel';
import { ConnectorProvider } from './ConnectorContext';
import { useFlowEditor } from './hooks/useFlowEditor';
import type { N8nWorkflow, EditorMode, WorkflowMeta } from './types';

interface FlowEditorProps {
  workflow: N8nWorkflow | null;
  meta: WorkflowMeta | null;
  initialMode?: EditorMode;
  isLoading?: boolean;
  onSave?: (workflow: N8nWorkflow) => void;
  isSaving?: boolean;
}

export default function FlowEditor({
  workflow,
  meta,
  initialMode = 'view',
  isLoading,
  onSave,
  isSaving,
}: FlowEditorProps) {
  const navigate = useNavigate();
  const {
    mode, setMode, isDirty,
    selectedNodeId, loadWorkflow,
    serializeToN8n, resetDirty,
    workflowMeta,
  } = useFlowEditor();

  // Load workflow when data arrives
  useEffect(() => {
    if (workflow && meta) {
      loadWorkflow(workflow, meta);
      setMode(initialMode);
    }
  }, [workflow, meta, initialMode, loadWorkflow, setMode]);

  // Warn on unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const handleSave = useCallback(() => {
    if (!onSave) return;
    const n8nWorkflow = serializeToN8n();
    onSave(n8nWorkflow);
    resetDirty();
  }, [onSave, serializeToN8n, resetDirty]);

  const handleBack = useCallback(() => {
    if (isDirty && !confirm('You have unsaved changes. Leave anyway?')) return;
    navigate('/automations');
  }, [isDirty, navigate]);

  const toggleMode = useCallback(() => {
    setMode(mode === 'view' ? 'edit' : 'view');
  }, [mode, setMode]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-bg">
        <Loader2 className="w-5 h-5 text-text-quaternary animate-spin" />
      </div>
    );
  }

  return (
    <ConnectorProvider>
    <div className="h-full flex flex-col bg-bg font-sans">
      {/* Toolbar */}
      <div className="flex items-center gap-3 h-12 px-4 border-b border-border flex-shrink-0">
        <button
          onClick={handleBack}
          className="w-7 h-7 flex items-center justify-center rounded-[5px] text-text-quaternary hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <span className="text-[14px] font-[560] text-text truncate flex-1">
          {workflowMeta?.name || 'New Automation'}
        </span>

        {isDirty && (
          <span className="text-[10px] text-text-quaternary">Unsaved changes</span>
        )}

        {/* Mode toggle */}
        <button
          onClick={toggleMode}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11px] font-[510] transition-colors cursor-pointer ${
            mode === 'edit'
              ? 'bg-accent/15 text-accent'
              : 'text-text-quaternary hover:text-text-tertiary hover:bg-hover'
          }`}
        >
          {mode === 'edit' ? <Edit3 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {mode === 'edit' ? 'Editing' : 'Viewing'}
        </button>

        {/* Save button */}
        {mode === 'edit' && onSave && (
          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[11px] font-[510] bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors cursor-pointer"
          >
            {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        )}
      </div>

      {/* Main area — 3 panels */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Node palette (edit mode only) */}
        {mode === 'edit' && (
          <div className="w-[220px] border-r border-border flex-shrink-0 overflow-y-auto">
            <NodePalette />
          </div>
        )}

        {/* Center: Canvas */}
        <ReactFlowProvider>
          <FlowCanvas />
        </ReactFlowProvider>

        {/* Right: Config panel (when node selected) */}
        {selectedNodeId && (
          <div className="w-[280px] border-l border-border flex-shrink-0 overflow-y-auto">
            <NodeConfigPanel />
          </div>
        )}
      </div>
    </div>
    </ConnectorProvider>
  );
}
