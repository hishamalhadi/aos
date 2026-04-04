/**
 * AutomationEditor — Page wrapper for the visual workflow editor.
 *
 * Routes:
 *   /automations/:id       → View mode (read-only)
 *   /automations/:id/edit  → Edit mode (full editor)
 *   /automations/new/edit  → Create new (empty canvas)
 */
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import FlowEditor from '@/components/flow-editor/FlowEditor';
import { useWorkflowDetail } from '@/hooks/useAutomations';
import type { N8nWorkflow } from '@/components/flow-editor/types';
import type { EditorMode } from '@/components/flow-editor/types';

export default function AutomationEditor() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();

  const isNew = id === 'new';
  const modeParam = searchParams.get('mode');
  const initialMode: EditorMode = modeParam === 'edit' || isNew ? 'edit' : 'view';

  // Fetch workflow if editing existing
  const { data: workflowData, isLoading } = useWorkflowDetail(isNew ? null : (id ?? null));

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (workflow: N8nWorkflow) => {
      if (!id || isNew) return; // TODO: handle create new
      const res = await fetch(`/api/automations/${id}/workflow`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['n8n-automations'] });
    },
  });

  // Build meta from available data
  const meta = id && !isNew ? {
    automationId: id,
    n8nWorkflowId: workflowData?.id || '',
    name: workflowData?.name || 'Automation',
  } : null;

  return (
    <FlowEditor
      workflow={workflowData ?? null}
      meta={meta}
      initialMode={initialMode}
      isLoading={!isNew && isLoading}
      onSave={(wf) => saveMutation.mutate(wf)}
      isSaving={saveMutation.isPending}
    />
  );
}
